import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql, isNull, isNotNull } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import type { Tx } from '../db/client.js';
import { vehicles, vehicleRates, drivers } from '../db/schema.js';
import { perm, can } from '../auth/middleware.js';
import { body, parse, query, listQuery, paged, zOptText, zText, zUuid, zMoney, zOptMoney, zOptDate, zDateTime, likeTerm } from '../lib/http.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { normalizePlate } from '../lib/normalize.js';
import { nextNumber } from '../lib/numbering.js';
import { getSettings } from '../lib/settings.js';
import { vehicleStatusSql } from '../services/schedule.js';

export const vehiclesRouter = Router();

const rateItem = z.object({ rentalType: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']), withDriver: z.boolean(), price: zMoney });

export const vehicleInput = z.object({
  plateNumber: zText(20).min(3, 'Nomor polisi wajib diisi'),
  brand: zText(60).min(1, 'Merek wajib diisi'),
  model: zText(80).min(1, 'Model/tipe wajib diisi'),
  year: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(1950, 'Tahun tidak valid').max(new Date().getFullYear() + 1, 'Tahun tidak valid').nullable().optional()),
  color: zOptText(40),
  transmission: z.enum(['MANUAL', 'AUTOMATIC']).default('MANUAL'),
  fuelType: z.enum(['BENSIN', 'SOLAR', 'LISTRIK', 'HYBRID', 'LAINNYA']).default('BENSIN'),
  seats: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(1).max(100).nullable().optional()),
  chassisNumber: zOptText(40),
  engineNumber: zOptText(40),
  purchaseDate: zOptDate,
  purchasePrice: zOptMoney,
  currentKm: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(0).max(9_999_999).nullable().optional()),
  isActive: z.boolean().default(true),
  photoFileId: z.uuid().nullable().optional(),
  notes: zOptText(2000),
});
export type VehicleInput = z.infer<typeof vehicleInput>;

export function prepareVehicle(input: VehicleInput) {
  const plate = normalizePlate(input.plateNumber);
  if (!plate) throw badRequest('Nomor polisi tidak valid', { fields: { plateNumber: 'Format nomor polisi tidak valid (contoh: B 1234 XYZ)' } });
  return { ...input, plateNumber: plate.display, plateNormalized: plate.normalized };
}

export async function saveRates(tx: Tx, req: Parameters<typeof audit>[1], companyId: string, vehicleId: string, rates: z.infer<typeof rateItem>[]) {
  const existing = await tx.select().from(vehicleRates).where(eq(vehicleRates.vehicleId, vehicleId));
  const changes: { key: string; before: string | null; after: string }[] = [];
  for (const r of rates) {
    const cur = existing.find((e) => e.rentalType === r.rentalType && e.withDriver === r.withDriver);
    if (cur && cur.price === r.price) continue;
    changes.push({ key: `${r.rentalType}${r.withDriver ? '+sopir' : ''}`, before: cur?.price ?? null, after: r.price });
    await tx.insert(vehicleRates).values({ companyId, vehicleId, rentalType: r.rentalType, withDriver: r.withDriver, price: r.price, updatedBy: req?.user?.id })
      .onConflictDoUpdate({ target: [vehicleRates.vehicleId, vehicleRates.rentalType, vehicleRates.withDriver], set: { price: r.price, updatedBy: req?.user?.id } });
  }
  if (changes.length) {
    await audit(tx, req, {
      action: 'rate.update', entityType: 'vehicle', entityId: vehicleId, summary: `Perubahan ${changes.length} tarif`,
      before: Object.fromEntries(changes.map((c) => [c.key, c.before])), after: Object.fromEntries(changes.map((c) => [c.key, c.after])),
    });
  }
}

async function assertPhoto(tx: Tx, companyId: string, fileId: string | null | undefined) {
  if (!fileId) return;
  const f = await tx.execute(sql`select 1 from file_attachments where id = ${fileId} and company_id = ${companyId} and kind = 'VEHICLE_PHOTO'`);
  if (!f.rows.length) throw badRequest('Foto kendaraan tidak valid');
}

const ratesJson = sql`coalesce((select json_agg(json_build_object('rentalType', r.rental_type, 'withDriver', r.with_driver, 'price', r.price::text) order by r.rental_type, r.with_driver)
  from vehicle_rates r where r.vehicle_id = v.id), '[]'::json)`;

vehiclesRouter.get('/vehicles', perm('vehicle.view'), async (req, res) => {
  const q = query(req, listQuery.extend({
    status: z.enum(['AVAILABLE', 'BOOKED', 'RENTED', 'MAINTENANCE', 'INACTIVE', 'OVERDUE']).optional(),
    archived: z.enum(['true', 'false']).default('false'),
  }));
  const { companyId } = req.ctx!;
  const sortCols: Record<string, string> = { plateNumber: 'plate_number', brand: 'brand', year: 'year', createdAt: 'created_at', code: 'code' };
  const sortCol = sortCols[q.sort ?? ''] ?? 'plate_number';
  const dir = q.sort ? q.dir : 'asc';
  const result = await withTenant(companyId, async (tx) => {
    const inner = sql`
      select v.*, ${vehicleStatusSql} as status,
        exists (select 1 from rental_transactions r where r.vehicle_id = v.id and r.status = 'ONGOING' and r.end_at < now()) as overdue
      from vehicles v
      where v.company_id = ${companyId}
        ${q.archived === 'true' ? sql`and v.archived_at is not null` : sql`and v.archived_at is null`}
        ${q.q ? sql`and (v.plate_number ilike ${likeTerm(q.q)} or v.plate_normalized ilike ${likeTerm(q.q.replace(/\s/g, '').toUpperCase())} or v.brand ilike ${likeTerm(q.q)} or v.model ilike ${likeTerm(q.q)} or v.code ilike ${likeTerm(q.q)})` : sql``}`;
    const filter = q.status === 'OVERDUE' ? sql`where overdue` : q.status ? sql`where status = ${q.status}` : sql``;
    const total = await tx.execute<{ n: number }>(sql`select count(*)::int as n from (${inner}) x ${filter}`);
    const rows = await tx.execute(sql`
      select x.id, x.code, x.plate_number as "plateNumber", x.brand, x.model, x.year, x.color, x.transmission, x.fuel_type as "fuelType",
        x.seats, x.is_active as "isActive", x.photo_file_id as "photoFileId", x.current_km as "currentKm", x.archived_at as "archivedAt",
        x.status, x.overdue,
        (select json_agg(json_build_object('rentalType', r.rental_type, 'withDriver', r.with_driver, 'price', r.price::text) order by r.rental_type, r.with_driver)
           from vehicle_rates r where r.vehicle_id = x.id) as rates,
        (select min(lower(b.period)) from vehicle_schedule_blocks b where b.vehicle_id = x.id and b.active and lower(b.period) > now()) as "nextBookingAt"
      from (${inner}) x ${filter}
      order by ${sql.raw(sortCol)} ${sql.raw(dir)} nulls last, x.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return paged(rows.rows, total.rows[0].n, q);
  });
  res.json(result);
});

/**
 * Vehicles free for the whole requested period (used by reservation/rental forms).
 * `excludeType/excludeId` lets an edit ignore its own block.
 */
vehiclesRouter.get('/vehicles/available', perm('vehicle.view'), async (req, res) => {
  const q = query(req, z.object({
    start: zDateTime, end: zDateTime, q: z.string().max(60).optional(),
    excludeType: z.enum(['RESERVATION', 'RENTAL']).optional(), excludeId: z.uuid().optional(),
    includeUnavailable: z.enum(['true', 'false']).default('false'),
  }));
  if (q.end <= q.start) throw badRequest('Tanggal selesai harus setelah tanggal mulai');
  const { companyId } = req.ctx!;
  const rows = await withTenant(companyId, (tx) => tx.execute(sql`
    select v.id, v.code, v.plate_number as "plateNumber", v.brand, v.model, v.year, v.color, v.transmission, v.seats, v.photo_file_id as "photoFileId",
      ${ratesJson} as rates,
      not exists (
        select 1 from vehicle_schedule_blocks b
        where b.vehicle_id = v.id and b.active
          and b.period && tstzrange(${q.start.toISOString()}::timestamptz, ${q.end.toISOString()}::timestamptz, '[)')
          ${q.excludeType && q.excludeId ? sql`and not (b.source_type = ${q.excludeType} and b.source_id = ${q.excludeId})` : sql``}
      ) and not exists (
        select 1 from rental_transactions t where t.vehicle_id = v.id and t.status = 'ONGOING' and t.end_at < now()
          and ${q.start.toISOString()}::timestamptz < now() + interval '1 hour'
          ${q.excludeType === 'RENTAL' && q.excludeId ? sql`and t.id <> ${q.excludeId}` : sql``}
      ) as available
    from vehicles v
    where v.company_id = ${companyId} and v.archived_at is null and v.is_active
      ${q.q ? sql`and (v.plate_number ilike ${likeTerm(q.q)} or v.brand ilike ${likeTerm(q.q)} or v.model ilike ${likeTerm(q.q)})` : sql``}
    order by v.brand, v.model, v.plate_number`));
  const list = q.includeUnavailable === 'true' ? rows.rows : rows.rows.filter((r) => r.available);
  res.json(list);
});

vehiclesRouter.get('/vehicles/:id', perm('vehicle.view'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  const showFinance = can(req, 'report.financial');
  const data = await withTenant(companyId, async (tx) => {
    const v = await tx.execute(sql`select v.*, ${vehicleStatusSql} as status, ${ratesJson} as rates from vehicles v where v.id = ${id} and v.company_id = ${companyId}`);
    if (!v.rows.length) throw notFound('Kendaraan');
    const r = v.rows[0] as Record<string, unknown>;
    const vehicle = {
      id: r.id, code: r.code, plateNumber: r.plate_number, brand: r.brand, model: r.model, year: r.year, color: r.color, transmission: r.transmission,
      fuelType: r.fuel_type, seats: r.seats, chassisNumber: r.chassis_number, engineNumber: r.engine_number, purchaseDate: r.purchase_date,
      purchasePrice: showFinance ? r.purchase_price : null, currentKm: r.current_km, isActive: r.is_active, photoFileId: r.photo_file_id, notes: r.notes,
      archivedAt: r.archived_at, createdAt: r.created_at, status: r.status, rates: r.rates,
    };
    const schedule = await tx.execute(sql`
      select b.source_type as "sourceType", b.source_id as "sourceId", lower(b.period) as "startAt", upper(b.period) as "endAt",
        coalesce(rs.number, t.number, m.number) as number,
        coalesce(rs.customer_snapshot->>'name', t.customer_snapshot->>'name', m.service_type) as label,
        coalesce(rs.status::text, t.status::text, m.status::text) as status
      from vehicle_schedule_blocks b
      left join reservations rs on b.source_type = 'RESERVATION' and rs.id = b.source_id
      left join rental_transactions t on b.source_type = 'RENTAL' and t.id = b.source_id
      left join maintenance_records m on b.source_type = 'MAINTENANCE' and m.id = b.source_id
      where b.vehicle_id = ${id} and b.active and (upper(b.period) is null or upper(b.period) > now() - interval '30 days')
      order by lower(b.period) limit 30`);
    const stats = showFinance ? (await tx.execute(sql`
      select
        (select coalesce(sum(case when t.status = 'CANCELLED' then t.cancellation_fee else t.total end),0) from rental_transactions t where t.vehicle_id = ${id}) as revenue,
        (select coalesce(sum(e.amount),0) from expenses e where e.vehicle_id = ${id} and e.status = 'POSTED') as expenses,
        (select count(*)::int from rental_transactions t where t.vehicle_id = ${id} and t.status <> 'CANCELLED') as "rentalCount"`)).rows[0] : null;
    const maintenance = await tx.execute(sql`
      select id, number, start_at as "startAt", completed_at as "completedAt", status, service_type as "serviceType", km, workshop, cost,
        next_service_date as "nextServiceDate", next_service_km as "nextServiceKm"
      from maintenance_records where vehicle_id = ${id} order by start_at desc limit 20`);
    return { vehicle, schedule: schedule.rows, stats, maintenance: maintenance.rows };
  });
  res.json(data);
});

vehiclesRouter.post('/vehicles', perm('vehicle.manage'), async (req, res) => {
  const raw = body(req, vehicleInput.extend({ rates: z.array(rateItem).max(6).default([]) }));
  const { rates, ...rest } = raw;
  if (rates.length && !can(req, 'rate.manage')) throw forbidden('Anda tidak memiliki izin mengubah tarif');
  const input = prepareVehicle(rest);
  const { companyId, timezone } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    await assertPhoto(tx, companyId, input.photoFileId);
    const settings = await getSettings(tx, companyId);
    const code = await nextNumber(tx, companyId, 'VEHICLE', settings, timezone);
    const [v] = await tx.insert(vehicles).values({ ...input, companyId, code, createdBy: req.user!.id, updatedBy: req.user!.id }).returning();
    await audit(tx, req, { action: 'vehicle.create', entityType: 'vehicle', entityId: v.id, summary: `${v.plateNumber} ${v.brand} ${v.model}` });
    if (rates.length) await saveRates(tx, req, companyId, v.id, rates);
    return v;
  });
  res.status(201).json(row);
});

vehiclesRouter.put('/vehicles/:id', perm('vehicle.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const raw = body(req, vehicleInput.extend({ rates: z.array(rateItem).max(6).optional() }));
  const { rates, ...rest } = raw;
  const input = prepareVehicle(rest);
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.vehicles.findFirst({ where: and(eq(vehicles.id, id), eq(vehicles.companyId, companyId)) });
    if (!before) throw notFound('Kendaraan');
    await assertPhoto(tx, companyId, input.photoFileId);
    if (!can(req, 'report.financial')) delete (input as Partial<typeof input>).purchasePrice;
    const [v] = await tx.update(vehicles).set({ ...input, updatedBy: req.user!.id }).where(eq(vehicles.id, id)).returning();
    const d = diff(before as Record<string, unknown>, input);
    if (d.changed) await audit(tx, req, { action: 'vehicle.update', entityType: 'vehicle', entityId: id, summary: v.plateNumber, before: d.before, after: d.after });
    if (rates?.length) {
      if (!can(req, 'rate.manage')) {
        const existing = await tx.select().from(vehicleRates).where(eq(vehicleRates.vehicleId, id));
        const changed = rates.some((r) => existing.find((e) => e.rentalType === r.rentalType && e.withDriver === r.withDriver)?.price !== r.price);
        if (changed) throw forbidden('Anda tidak memiliki izin mengubah tarif');
      } else {
        await saveRates(tx, req, companyId, id, rates);
      }
    }
    return v;
  });
  res.json(row);
});

vehiclesRouter.post('/vehicles/:id/archive', perm('vehicle.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  await withTenant(companyId, async (tx) => {
    const open = await tx.execute(sql`select 1 from vehicle_schedule_blocks where vehicle_id = ${id} and active and (upper(period) is null or upper(period) > now())
      union all select 1 from rental_transactions where vehicle_id = ${id} and status in ('ONGOING','RETURNED') limit 1`);
    if (open.rows.length) throw badRequest('Kendaraan masih memiliki jadwal/transaksi aktif');
    const [v] = await tx.update(vehicles).set({ archivedAt: sql`now()`, updatedBy: req.user!.id })
      .where(and(eq(vehicles.id, id), eq(vehicles.companyId, companyId), isNull(vehicles.archivedAt))).returning();
    if (!v) throw notFound('Kendaraan');
    await audit(tx, req, { action: 'vehicle.archive', entityType: 'vehicle', entityId: id, summary: v.plateNumber });
  });
  res.json({ ok: true });
});

vehiclesRouter.post('/vehicles/:id/restore', perm('vehicle.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  await withTenant(companyId, async (tx) => {
    const [v] = await tx.update(vehicles).set({ archivedAt: null, updatedBy: req.user!.id })
      .where(and(eq(vehicles.id, id), eq(vehicles.companyId, companyId), isNotNull(vehicles.archivedAt))).returning();
    if (!v) throw notFound('Kendaraan');
    await audit(tx, req, { action: 'vehicle.restore', entityType: 'vehicle', entityId: id, summary: v.plateNumber });
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ rates */

vehiclesRouter.get('/rates', perm('vehicle.view'), async (req, res) => {
  const { companyId } = req.ctx!;
  const rows = await withTenant(companyId, (tx) => tx.execute(sql`
    select v.id, v.code, v.plate_number as "plateNumber", v.brand, v.model, v.is_active as "isActive", ${ratesJson} as rates
    from vehicles v where v.company_id = ${companyId} and v.archived_at is null order by v.brand, v.model, v.plate_number`));
  res.json(rows.rows);
});

vehiclesRouter.put('/rates/:vehicleId', perm('rate.manage'), async (req, res) => {
  const vehicleId = parse(zUuid, req.params.vehicleId);
  const { rates } = body(req, z.object({ rates: z.array(rateItem).min(1).max(6) }));
  const { companyId } = req.ctx!;
  await withTenant(companyId, async (tx) => {
    const v = await tx.query.vehicles.findFirst({ where: and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId)) });
    if (!v) throw notFound('Kendaraan');
    await saveRates(tx, req, companyId, vehicleId, rates);
  });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- drivers */

const driverInput = z.object({
  name: zText(100).min(2), phone: zOptText(30), licenseNumber: zOptText(40), dailyFee: zMoney.default('0'),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'), notes: zOptText(1000),
});

vehiclesRouter.get('/drivers', perm('driver.view'), async (req, res) => {
  const q = query(req, listQuery.extend({ archived: z.enum(['true', 'false']).default('false'), active: z.enum(['true']).optional() }));
  const { companyId } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    const where = and(
      eq(drivers.companyId, companyId),
      q.archived === 'true' ? isNotNull(drivers.archivedAt) : isNull(drivers.archivedAt),
      q.active ? eq(drivers.status, 'ACTIVE') : undefined,
      q.q ? sql`(${drivers.name} ilike ${likeTerm(q.q)} or ${drivers.phone} ilike ${likeTerm(q.q)})` : undefined,
    );
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(drivers).where(where);
    const rows = await tx.select().from(drivers).where(where).orderBy(drivers.name).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    return paged(rows, n, q);
  });
  res.json(result);
});

vehiclesRouter.post('/drivers', perm('driver.manage'), async (req, res) => {
  const input = body(req, driverInput);
  const { companyId, timezone } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const code = await nextNumber(tx, companyId, 'DRIVER', await getSettings(tx, companyId), timezone);
    const [d] = await tx.insert(drivers).values({ ...input, companyId, code }).returning();
    await audit(tx, req, { action: 'driver.create', entityType: 'driver', entityId: d.id, summary: d.name });
    return d;
  });
  res.status(201).json(row);
});

vehiclesRouter.put('/drivers/:id', perm('driver.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, driverInput);
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.drivers.findFirst({ where: and(eq(drivers.id, id), eq(drivers.companyId, companyId)) });
    if (!before) throw notFound('Sopir');
    const [d] = await tx.update(drivers).set(input).where(eq(drivers.id, id)).returning();
    const df = diff(before as Record<string, unknown>, input);
    if (df.changed) await audit(tx, req, { action: 'driver.update', entityType: 'driver', entityId: id, before: df.before, after: df.after });
    return d;
  });
  res.json(row);
});

vehiclesRouter.post('/drivers/:id/archive', perm('driver.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  await withTenant(companyId, async (tx) => {
    const [d] = await tx.update(drivers).set({ archivedAt: sql`now()` }).where(and(eq(drivers.id, id), eq(drivers.companyId, companyId))).returning();
    if (!d) throw notFound('Sopir');
    await audit(tx, req, { action: 'driver.archive', entityType: 'driver', entityId: id, summary: d.name });
  });
  res.json({ ok: true });
});
