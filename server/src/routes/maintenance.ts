import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import type { Tx } from '../db/client.js';
import { expenses, maintenanceRecords, vehicles } from '../db/schema.js';
import { perm, can } from '../auth/middleware.js';
import { body, parse, query, listQuery, paged, zUuid, zOptDate, zDateTime, zOptDateTime, zMoney, zOptText, zOptUuid, zText, likeTerm } from '../lib/http.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { nextNumber } from '../lib/numbering.js';
import { getSettings } from '../lib/settings.js';
import { localDate } from '../lib/dates.js';
import { D, formatIDR } from '../lib/money.js';
import { assertAvailable, upsertBlock, setBlockActive, upsertBlockLenient } from '../services/schedule.js';

export const maintenanceRouter = Router();

const maintenanceInput = z.object({
  vehicleId: zUuid,
  startAt: zDateTime,
  endAt: zOptDateTime,
  status: z.enum(['SCHEDULED', 'IN_PROGRESS']).default('SCHEDULED'),
  serviceType: zText(120).min(2, 'Jenis servis wajib diisi'),
  km: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(0).max(9_999_999).nullable().optional()),
  workshop: zOptText(120),
  cost: zMoney.default('0'),
  nextServiceDate: zOptDate,
  nextServiceKm: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(0).max(9_999_999).nullable().optional()),
  notes: zOptText(2000),
  proofFileId: zOptUuid,
  // how the cost is paid → recorded as an operational expense (category Servis)
  paymentMethod: z.string().trim().max(20).default('CASH'),
  cashAccountId: zOptUuid,
}).refine((v) => v.status === 'IN_PROGRESS' || !!v.endAt, { message: 'Perkiraan selesai wajib diisi untuk perawatan terjadwal', path: ['endAt'] })
  .refine((v) => !v.endAt || v.endAt > v.startAt, { message: 'Waktu selesai harus setelah waktu mulai', path: ['endAt'] });

type MInput = z.infer<typeof maintenanceInput>;

/** Keeps the linked expense in sync with the maintenance cost (cost > 0 ⇒ posted expense). */
async function syncExpense(tx: Tx, req: Request, companyId: string, m: typeof maintenanceRecords.$inferSelect, input: { paymentMethod: string; cashAccountId?: string | null }) {
  const existing = await tx.query.expenses.findFirst({ where: and(eq(expenses.maintenanceId, m.id), eq(expenses.companyId, companyId)) });
  const plate = (await tx.query.vehicles.findFirst({ where: eq(vehicles.id, m.vehicleId) }))?.plateNumber ?? '';
  const tz = req.ctx!.timezone;
  const date = localDate(m.completedAt ?? m.startAt, tz);
  const cancelled = m.status === 'CANCELLED';
  if (existing) {
    if (existing.status === 'VOID') return;
    if (cancelled || D(m.cost).eq(0)) {
      await tx.update(expenses).set({ status: 'VOID', voidReason: cancelled ? 'Perawatan dibatalkan' : 'Biaya perawatan diubah menjadi 0', voidedAt: new Date(), voidedBy: req.user!.id }).where(eq(expenses.id, existing.id));
      return;
    }
    if (!D(existing.amount).eq(m.cost) || existing.expenseDate !== date || existing.vehicleId !== m.vehicleId) {
      await tx.update(expenses).set({ amount: m.cost, expenseDate: date, vehicleId: m.vehicleId, description: `${m.serviceType} — ${plate} (${m.number})`, updatedBy: req.user!.id })
        .where(eq(expenses.id, existing.id));
    }
    return;
  }
  if (cancelled || D(m.cost).eq(0)) return;
  if (!can(req, 'expense.manage')) return; // cost visible on the record; finance can post the expense later
  const settings = await getSettings(tx, companyId);
  if (!settings.paymentMethods.some((x) => x.code === input.paymentMethod)) throw badRequest('Metode pembayaran tidak dikenal');
  const cat = await tx.execute<{ id: string }>(sql`select id from expense_categories where company_id = ${companyId} and code = 'SERVIS' limit 1`);
  const categoryId = cat.rows[0]?.id ?? (await tx.execute<{ id: string }>(sql`select id from expense_categories where company_id = ${companyId} order by code limit 1`)).rows[0].id;
  const number = await nextNumber(tx, companyId, 'EXPENSE', settings, tz);
  const [e] = await tx.insert(expenses).values({
    companyId, number, expenseDate: date, categoryId, vehicleId: m.vehicleId, maintenanceId: m.id, description: `${m.serviceType} — ${plate} (${m.number})`,
    amount: m.cost, method: input.paymentMethod, cashAccountId: input.cashAccountId ?? null, proofFileId: m.proofFileId, createdBy: req.user!.id, updatedBy: req.user!.id,
  }).returning();
  await audit(tx, req, { action: 'expense.create', entityType: 'expense', entityId: e.id, summary: `${e.number} ${formatIDR(e.amount)} dari perawatan ${m.number}` });
}

function blockEnd(m: { status: string; endAt: Date | null; completedAt: Date | null }) {
  if (m.status === 'DONE') return m.completedAt;
  return m.endAt; // null ⇒ open-ended (in progress, unknown finish)
}

maintenanceRouter.get('/maintenance', perm('maintenance.view'), async (req, res) => {
  const q = query(req, listQuery.extend({ vehicleId: z.uuid().optional(), status: z.string().max(60).optional(), from: zOptDate, to: zOptDate }));
  const { companyId, timezone } = req.ctx!;
  const statuses = q.status?.split(',').filter((s) => ['SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(s));
  const result = await withTenant(companyId, async (tx) => {
    const where = sql`m.company_id = ${companyId}
      ${q.vehicleId ? sql`and m.vehicle_id = ${q.vehicleId}` : sql``}
      ${statuses?.length ? sql`and m.status::text in (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})` : sql``}
      ${q.from ? sql`and m.start_at >= (${q.from}::date)::timestamp at time zone ${timezone}` : sql``}
      ${q.to ? sql`and m.start_at < ((${q.to}::date + 1)::timestamp at time zone ${timezone})` : sql``}
      ${q.q ? sql`and (m.number ilike ${likeTerm(q.q)} or m.service_type ilike ${likeTerm(q.q)} or m.workshop ilike ${likeTerm(q.q)} or v.plate_number ilike ${likeTerm(q.q)})` : sql``}`;
    const agg = await tx.execute<{ n: number; total: string }>(sql`select count(*)::int as n, coalesce(sum(m.cost) filter (where m.status <> 'CANCELLED'),0) as total
      from maintenance_records m join vehicles v on v.id = m.vehicle_id where ${where}`);
    const rows = await tx.execute(sql`
      select m.id, m.number, m.vehicle_id as "vehicleId", v.plate_number as "plateNumber", v.brand || ' ' || v.model as "vehicleName",
        m.start_at as "startAt", m.end_at as "endAt", m.completed_at as "completedAt", m.status, m.service_type as "serviceType", m.km, m.workshop,
        m.cost, m.next_service_date as "nextServiceDate", m.next_service_km as "nextServiceKm", m.notes, m.proof_file_id as "proofFileId",
        (select e.number from expenses e where e.maintenance_id = m.id and e.status = 'POSTED') as "expenseNumber"
      from maintenance_records m join vehicles v on v.id = m.vehicle_id where ${where}
      order by m.start_at ${sql.raw(q.dir)} limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return { ...paged(rows.rows, agg.rows[0].n, q), sum: agg.rows[0].total };
  });
  res.json(result);
});

/** Service reminders: per vehicle, the latest "next service" plan vs. today / current km. */
maintenanceRouter.get('/maintenance/reminders', perm('maintenance.view'), async (req, res) => {
  const q = query(req, z.object({ days: z.coerce.number().int().min(1).max(365).default(14), km: z.coerce.number().int().min(0).max(100000).default(1000) }));
  const { companyId, timezone } = req.ctx!;
  const rows = await withTenant(companyId, (tx) => tx.execute(sql`
    with last_plan as (
      select distinct on (m.vehicle_id) m.vehicle_id, m.next_service_date, m.next_service_km, m.start_at as last_service_at, m.service_type
      from maintenance_records m where m.company_id = ${companyId} and m.status = 'DONE'
      order by m.vehicle_id, coalesce(m.completed_at, m.start_at) desc
    )
    select v.id as "vehicleId", v.plate_number as "plateNumber", v.brand || ' ' || v.model as "vehicleName", v.current_km as "currentKm",
      lp.last_service_at as "lastServiceAt", lp.service_type as "lastServiceType", lp.next_service_date as "nextServiceDate", lp.next_service_km as "nextServiceKm",
      (select coalesce(sum(cost),0) from maintenance_records x where x.vehicle_id = v.id and x.status <> 'CANCELLED') as "totalCost",
      (select count(*)::int from maintenance_records x where x.vehicle_id = v.id and x.status in ('SCHEDULED','IN_PROGRESS')) as "openCount",
      case
        when lp.next_service_date is not null and lp.next_service_date < (now() at time zone ${timezone})::date then 'OVERDUE'
        when lp.next_service_km is not null and v.current_km is not null and v.current_km >= lp.next_service_km then 'OVERDUE'
        when lp.next_service_date is not null and lp.next_service_date <= (now() at time zone ${timezone})::date + ${q.days}::int then 'DUE_SOON'
        when lp.next_service_km is not null and v.current_km is not null and v.current_km >= lp.next_service_km - ${q.km}::int then 'DUE_SOON'
        when lp.vehicle_id is null then 'NO_DATA'
        else 'OK' end as "reminderStatus"
    from vehicles v left join last_plan lp on lp.vehicle_id = v.id
    where v.company_id = ${companyId} and v.archived_at is null
    order by case
        when lp.next_service_date < (now() at time zone ${timezone})::date or (v.current_km >= lp.next_service_km) then 0
        when lp.next_service_date is not null then 1 else 2 end, lp.next_service_date nulls last, v.plate_number`));
  res.json(rows.rows);
});

maintenanceRouter.get('/maintenance/:id', perm('maintenance.view'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const m = await tx.query.maintenanceRecords.findFirst({ where: and(eq(maintenanceRecords.id, id), eq(maintenanceRecords.companyId, companyId)) });
    if (!m) throw notFound('Perawatan');
    const v = await tx.query.vehicles.findFirst({ where: eq(vehicles.id, m.vehicleId) });
    const e = await tx.query.expenses.findFirst({ where: eq(expenses.maintenanceId, id) });
    return { maintenance: m, vehicle: v ? { id: v.id, plateNumber: v.plateNumber, brand: v.brand, model: v.model } : null, expense: e ?? null };
  });
  res.json(data);
});

async function assertProof(tx: Tx, companyId: string, id?: string | null) {
  if (!id) return;
  if (!(await tx.execute(sql`select 1 from file_attachments where id = ${id} and company_id = ${companyId} and kind = 'MAINTENANCE_PROOF'`)).rows.length) throw badRequest('Bukti servis tidak valid');
}

maintenanceRouter.post('/maintenance', perm('maintenance.manage'), async (req, res) => {
  const input = body(req, maintenanceInput);
  const { companyId, timezone } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const v = await tx.query.vehicles.findFirst({ where: and(eq(vehicles.id, input.vehicleId), eq(vehicles.companyId, companyId)) });
    if (!v || v.archivedAt) throw notFound('Kendaraan');
    await assertProof(tx, companyId, input.proofFileId);
    await assertAvailable(tx, input.vehicleId, input.startAt, input.endAt ?? null);
    const number = await nextNumber(tx, companyId, 'MAINTENANCE', await getSettings(tx, companyId), timezone);
    const { paymentMethod, cashAccountId, ...data } = input;
    const [m] = await tx.insert(maintenanceRecords).values({ ...data, endAt: data.endAt ?? null, companyId, number, createdBy: req.user!.id, updatedBy: req.user!.id }).returning();
    await upsertBlock(tx, companyId, { vehicleId: m.vehicleId, type: 'MAINTENANCE', id: m.id, start: m.startAt, end: blockEnd(m), active: true });
    await syncExpense(tx, req, companyId, m, { paymentMethod, cashAccountId });
    await audit(tx, req, { action: 'maintenance.create', entityType: 'maintenance', entityId: m.id, summary: `${m.number} ${v.plateNumber} — ${m.serviceType}` });
    return m;
  });
  res.status(201).json(row);
});

maintenanceRouter.put('/maintenance/:id', perm('maintenance.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, maintenanceInput);
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.maintenanceRecords.findFirst({ where: and(eq(maintenanceRecords.id, id), eq(maintenanceRecords.companyId, companyId)) });
    if (!before) throw notFound('Perawatan');
    if (before.status === 'CANCELLED') throw badRequest('Perawatan yang dibatalkan tidak dapat diubah');
    if (!D(before.cost).eq(input.cost) && !can(req, 'expense.manage') && (await tx.query.expenses.findFirst({ where: eq(expenses.maintenanceId, id) }))) {
      throw forbidden('Perubahan biaya yang sudah tercatat sebagai pengeluaran memerlukan izin pengeluaran');
    }
    await assertProof(tx, companyId, input.proofFileId);
    const { paymentMethod, cashAccountId, ...data } = input;
    const status = before.status === 'DONE' ? 'DONE' : data.status;
    const patch = { ...data, status, endAt: data.endAt ?? null } as const;
    const end = blockEnd({ status, endAt: patch.endAt, completedAt: before.completedAt });
    await assertAvailable(tx, data.vehicleId, data.startAt, end, { type: 'MAINTENANCE', id });
    const [m] = await tx.update(maintenanceRecords).set({ ...patch, updatedBy: req.user!.id }).where(eq(maintenanceRecords.id, id)).returning();
    await upsertBlock(tx, companyId, { vehicleId: m.vehicleId, type: 'MAINTENANCE', id, start: m.startAt, end, active: true });
    await syncExpense(tx, req, companyId, m, { paymentMethod, cashAccountId });
    const d = diff(before as Record<string, unknown>, patch as Record<string, unknown>);
    if (d.changed) await audit(tx, req, { action: 'maintenance.update', entityType: 'maintenance', entityId: id, summary: m.number, before: d.before, after: d.after });
    return m;
  });
  res.json(row);
});

maintenanceRouter.post('/maintenance/:id/complete', perm('maintenance.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, z.object({
    completedAt: zDateTime.default(() => new Date()), cost: zMoney.optional(), km: z.coerce.number().int().min(0).max(9_999_999).optional().nullable(),
    nextServiceDate: zOptDate, nextServiceKm: z.coerce.number().int().min(0).optional().nullable(), paymentMethod: z.string().max(20).default('CASH'), cashAccountId: zOptUuid,
  }));
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.maintenanceRecords.findFirst({ where: and(eq(maintenanceRecords.id, id), eq(maintenanceRecords.companyId, companyId)) });
    if (!before) throw notFound('Perawatan');
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(before.status)) throw badRequest('Perawatan sudah selesai atau dibatalkan');
    if (input.completedAt <= before.startAt) throw badRequest('Waktu selesai harus setelah waktu mulai');
    const [m] = await tx.update(maintenanceRecords).set({
      status: 'DONE', completedAt: input.completedAt, ...(input.cost !== undefined ? { cost: input.cost } : {}), ...(input.km != null ? { km: input.km } : {}),
      ...(input.nextServiceDate !== undefined ? { nextServiceDate: input.nextServiceDate } : {}), ...(input.nextServiceKm !== undefined ? { nextServiceKm: input.nextServiceKm } : {}),
      updatedBy: req.user!.id,
    }).where(eq(maintenanceRecords.id, id)).returning();
    // shorten (never lengthen into other bookings) the block to the actual finish time
    const warning = await upsertBlockLenient(tx, companyId, { vehicleId: m.vehicleId, type: 'MAINTENANCE', id, start: m.startAt, end: input.completedAt, active: true }, before.endAt ?? input.completedAt);
    if (input.km != null) await tx.update(vehicles).set({ currentKm: sql`greatest(coalesce(${vehicles.currentKm},0), ${input.km})` }).where(eq(vehicles.id, m.vehicleId));
    await syncExpense(tx, req, companyId, m, { paymentMethod: input.paymentMethod, cashAccountId: input.cashAccountId });
    await audit(tx, req, { action: 'maintenance.complete', entityType: 'maintenance', entityId: id, summary: `${m.number} selesai — ${formatIDR(m.cost)}` });
    return { ...m, warning };
  });
  res.json(row);
});

maintenanceRouter.post('/maintenance/:id/cancel', perm('maintenance.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { reason } = body(req, z.object({ reason: zText(300).min(3) }));
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.maintenanceRecords.findFirst({ where: and(eq(maintenanceRecords.id, id), eq(maintenanceRecords.companyId, companyId)) });
    if (!before) throw notFound('Perawatan');
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(before.status)) throw badRequest('Perawatan sudah selesai atau dibatalkan');
    const [m] = await tx.update(maintenanceRecords).set({ status: 'CANCELLED', notes: [before.notes, `Dibatalkan: ${reason}`].filter(Boolean).join('\n'), updatedBy: req.user!.id })
      .where(eq(maintenanceRecords.id, id)).returning();
    await setBlockActive(tx, 'MAINTENANCE', id, false);
    await syncExpense(tx, req, companyId, m, { paymentMethod: 'CASH' });
    await audit(tx, req, { action: 'maintenance.cancel', entityType: 'maintenance', entityId: id, summary: `${m.number}: ${reason}` });
    return m;
  });
  res.json(row);
});

/* ---------------------------------------------------------------- calendar */

maintenanceRouter.get('/calendar', perm('reservation.view'), async (req, res) => {
  const q = query(req, z.object({ from: zDateTime, to: zDateTime, vehicleId: z.uuid().optional() }));
  if (q.to <= q.from) throw badRequest('Rentang tanggal tidak valid');
  if (q.to.getTime() - q.from.getTime() > 100 * 86400_000) throw badRequest('Rentang kalender maksimal 100 hari');
  const { companyId } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const events = await tx.execute(sql`
      select b.source_type as "sourceType", b.source_id as "sourceId", b.vehicle_id as "vehicleId",
        lower(b.period) as "startAt", upper(b.period) as "endAt",
        coalesce(rs.number, t.number, m.number) as number,
        coalesce(rs.customer_snapshot->>'name', t.customer_snapshot->>'name', m.service_type) as title,
        coalesce(rs.status::text, t.status::text, m.status::text) as status,
        (t.status = 'ONGOING' and t.end_at < now()) as overdue
      from vehicle_schedule_blocks b
      left join reservations rs on b.source_type = 'RESERVATION' and rs.id = b.source_id
      left join rental_transactions t on b.source_type = 'RENTAL' and t.id = b.source_id
      left join maintenance_records m on b.source_type = 'MAINTENANCE' and m.id = b.source_id
      where b.company_id = ${companyId} and b.active
        and b.period && tstzrange(${q.from.toISOString()}::timestamptz, ${q.to.toISOString()}::timestamptz, '[)')
        ${q.vehicleId ? sql`and b.vehicle_id = ${q.vehicleId}` : sql``}
      union all
      -- draft reservations (not blocking) are still shown, greyed out
      select 'RESERVATION', rs.id, rs.vehicle_id, rs.start_at, rs.end_at, rs.number, rs.customer_snapshot->>'name', rs.status::text, false
      from reservations rs
      where rs.company_id = ${companyId} and rs.status = 'DRAFT'
        and not exists (select 1 from vehicle_schedule_blocks b where b.source_type = 'RESERVATION' and b.source_id = rs.id and b.active)
        and tstzrange(rs.start_at, rs.end_at, '[)') && tstzrange(${q.from.toISOString()}::timestamptz, ${q.to.toISOString()}::timestamptz, '[)')
        ${q.vehicleId ? sql`and rs.vehicle_id = ${q.vehicleId}` : sql``}
      order by "startAt"`);
    const vehiclesRows = await tx.execute(sql`select id, plate_number as "plateNumber", brand || ' ' || model as name from vehicles
      where company_id = ${companyId} and archived_at is null ${q.vehicleId ? sql`and id = ${q.vehicleId}` : sql``} order by brand, model, plate_number`);
    return { events: events.rows, vehicles: vehiclesRows.rows };
  });
  res.json(data);
});
