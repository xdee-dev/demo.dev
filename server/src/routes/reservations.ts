import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import { reservations } from '../db/schema.js';
import { perm } from '../auth/middleware.js';
import { body, parse, query, listQuery, paged, zUuid, zMoney, zOptDate, likeTerm, zText } from '../lib/http.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { nextNumber } from '../lib/numbering.js';
import { getSettings } from '../lib/settings.js';
import { bookingInput, priceBooking } from '../services/booking.js';
import { assertAvailable, upsertBlock, setBlockActive } from '../services/schedule.js';
import { companySnapshot } from '../services/company.js';
import { createRentalFromReservation } from '../services/rental.js';
import { D } from '../lib/money.js';

export const reservationsRouter = Router();

type RStatus = 'DRAFT' | 'PENDING' | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
const blocks = (status: RStatus, draftBlocks: boolean) => status === 'PENDING' || status === 'CONFIRMED' || (draftBlocks && status === 'DRAFT');

const reservationInput = bookingInput.and(z.object({
  dpAmount: zMoney.default('0'),
  status: z.enum(['DRAFT', 'PENDING', 'CONFIRMED']).default('PENDING'),
}));

reservationsRouter.get('/reservations', perm('reservation.view'), async (req, res) => {
  const q = query(req, listQuery.extend({
    status: z.string().max(80).optional(), // comma separated
    from: zOptDate, to: zOptDate, vehicleId: z.uuid().optional(), customerId: z.uuid().optional(),
  }));
  const { companyId, timezone } = req.ctx!;
  const statuses = q.status?.split(',').filter((s) => ['DRAFT', 'PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'].includes(s));
  const sortCols: Record<string, string> = { number: 'r.number', startAt: 'r.start_at', total: 'r.total', createdAt: 'r.created_at' };
  const result = await withTenant(companyId, async (tx) => {
    const where = sql`r.company_id = ${companyId}
      ${statuses?.length ? sql`and r.status::text in (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})` : sql``}
      ${q.from ? sql`and r.end_at >= (${q.from}::date)::timestamp at time zone ${timezone}` : sql``}
      ${q.to ? sql`and r.start_at < ((${q.to}::date + 1)::timestamp at time zone ${timezone})` : sql``}
      ${q.vehicleId ? sql`and r.vehicle_id = ${q.vehicleId}` : sql``}
      ${q.customerId ? sql`and r.customer_id = ${q.customerId}` : sql``}
      ${q.q ? sql`and (r.number ilike ${likeTerm(q.q)} or r.customer_snapshot->>'name' ilike ${likeTerm(q.q)} or r.vehicle_snapshot->>'plateNumber' ilike ${likeTerm(q.q)})` : sql``}`;
    const total = await tx.execute<{ n: number }>(sql`select count(*)::int as n from reservations r where ${where}`);
    const rows = await tx.execute(sql`
      select r.id, r.number, r.status, r.start_at as "startAt", r.end_at as "endAt", r.rental_type as "rentalType", r.with_driver as "withDriver",
        r.total, r.dp_amount as "dpAmount", b.paid, r.rental_id as "rentalId", r.customer_id as "customerId", r.vehicle_id as "vehicleId",
        r.customer_snapshot->>'name' as "customerName", r.customer_snapshot->>'phone' as "customerPhone",
        r.vehicle_snapshot->>'plateNumber' as "plateNumber", (r.vehicle_snapshot->>'brand') || ' ' || (r.vehicle_snapshot->>'model') as "vehicleName",
        r.created_at as "createdAt"
      from reservations r join reservation_balances b on b.reservation_id = r.id
      where ${where}
      order by ${sql.raw(sortCols[q.sort ?? ''] ?? 'r.start_at')} ${sql.raw(q.dir)}, r.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return paged(rows.rows, total.rows[0].n, q);
  });
  res.json(result);
});

reservationsRouter.get('/reservations/:id', perm('reservation.view'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const r = await tx.query.reservations.findFirst({ where: and(eq(reservations.id, id), eq(reservations.companyId, companyId)) });
    if (!r) throw notFound('Reservasi');
    const bal = await tx.execute(sql`select paid, balance from reservation_balances where reservation_id = ${id}`);
    const payments = await tx.execute(sql`select id, number, kind, amount, paid_at as "paidAt", method, reference, is_down_payment as "isDownPayment"
      from payments where reservation_id = ${id} order by paid_at`);
    const rental = r.rentalId ? (await tx.execute(sql`select id, number, status from rental_transactions where id = ${r.rentalId}`)).rows[0] : null;
    return { reservation: r, balance: bal.rows[0], payments: payments.rows, rental };
  });
  res.json(data);
});

reservationsRouter.post('/reservations', perm('reservation.manage'), async (req, res) => {
  const input = body(req, reservationInput);
  const { companyId, timezone } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const settings = await getSettings(tx, companyId);
    const priced = await priceBooking(tx, req, companyId, input, settings);
    if (D(input.dpAmount).gt(priced.quote.total)) throw badRequest('Uang muka melebihi total');
    const willBlock = blocks(input.status, settings.reservationBlocksDraft);
    if (willBlock) await assertAvailable(tx, input.vehicleId, input.startAt, input.endAt);
    const number = await nextNumber(tx, companyId, 'RESERVATION', settings, timezone);
    const q = priced.quote;
    const [r] = await tx.insert(reservations).values({
      companyId, number, customerId: input.customerId, vehicleId: input.vehicleId, driverId: input.driverId ?? null,
      startAt: input.startAt, endAt: input.endAt, pickupLocation: input.pickupLocation, returnLocation: input.returnLocation,
      rentalType: input.rentalType, withDriver: input.withDriver, unitPrice: q.unitPrice, quantity: q.quantity, subtotal: q.subtotal,
      discount: q.discount, extraCharges: q.extraCharges, extraChargesNote: input.extraChargesNote, taxPercent: q.taxPercent, taxAmount: q.taxAmount,
      total: q.total, dpAmount: input.dpAmount, notes: input.notes, status: input.status,
      customerSnapshot: priced.customerSnapshot, vehicleSnapshot: priced.vehicleSnapshot, companySnapshot: await companySnapshot(tx, companyId),
      createdBy: req.user!.id, updatedBy: req.user!.id,
    }).returning();
    await upsertBlock(tx, companyId, { vehicleId: r.vehicleId, type: 'RESERVATION', id: r.id, start: r.startAt, end: r.endAt, active: willBlock });
    await audit(tx, req, { action: 'reservation.create', entityType: 'reservation', entityId: r.id, summary: `${r.number} — ${priced.customerSnapshot.name}`,
      after: { total: r.total, status: r.status, overridden: priced.overridden } });
    return r;
  });
  res.status(201).json(row);
});

reservationsRouter.put('/reservations/:id', perm('reservation.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, reservationInput);
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.reservations.findFirst({ where: and(eq(reservations.id, id), eq(reservations.companyId, companyId)) });
    if (!before) throw notFound('Reservasi');
    if (!['DRAFT', 'PENDING', 'CONFIRMED'].includes(before.status)) throw badRequest('Reservasi dengan status ini tidak dapat diubah');
    await tx.execute(sql`select 1 from reservations where id = ${id} for update`);
    const settings = await getSettings(tx, companyId);
    const priced = await priceBooking(tx, req, companyId, input, settings, before);
    if (D(input.dpAmount).gt(priced.quote.total)) throw badRequest('Uang muka melebihi total');
    const willBlock = blocks(input.status, settings.reservationBlocksDraft);
    if (willBlock) await assertAvailable(tx, input.vehicleId, input.startAt, input.endAt, { type: 'RESERVATION', id });
    const q = priced.quote;
    const patch = {
      customerId: input.customerId, vehicleId: input.vehicleId, driverId: input.driverId ?? null, startAt: input.startAt, endAt: input.endAt,
      pickupLocation: input.pickupLocation ?? null, returnLocation: input.returnLocation ?? null, rentalType: input.rentalType, withDriver: input.withDriver,
      unitPrice: q.unitPrice, quantity: q.quantity, subtotal: q.subtotal, discount: q.discount, extraCharges: q.extraCharges,
      extraChargesNote: input.extraChargesNote ?? null, taxPercent: q.taxPercent, taxAmount: q.taxAmount, total: q.total, dpAmount: input.dpAmount,
      notes: input.notes ?? null, status: input.status, customerSnapshot: priced.customerSnapshot, vehicleSnapshot: priced.vehicleSnapshot,
    };
    const [r] = await tx.update(reservations).set({ ...patch, updatedBy: req.user!.id }).where(eq(reservations.id, id)).returning();
    await upsertBlock(tx, companyId, { vehicleId: r.vehicleId, type: 'RESERVATION', id: r.id, start: r.startAt, end: r.endAt, active: willBlock });
    const d = diff(before as Record<string, unknown>, patch as Record<string, unknown>);
    if (d.changed) await audit(tx, req, { action: 'reservation.update', entityType: 'reservation', entityId: id, summary: r.number, before: d.before, after: d.after });
    return r;
  });
  res.json(row);
});

reservationsRouter.post('/reservations/:id/status', perm('reservation.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, z.object({ status: z.enum(['DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED']), reason: zText(500).optional() }));
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.reservations.findFirst({ where: and(eq(reservations.id, id), eq(reservations.companyId, companyId)) });
    if (!before) throw notFound('Reservasi');
    if (!['DRAFT', 'PENDING', 'CONFIRMED'].includes(before.status)) throw badRequest('Status reservasi tidak dapat diubah lagi');
    if (input.status === 'CANCELLED' && !input.reason) throw badRequest('Alasan pembatalan wajib diisi', { fields: { reason: 'Wajib diisi' } });
    const settings = await getSettings(tx, companyId);
    const willBlock = blocks(input.status, settings.reservationBlocksDraft);
    if (willBlock && !blocks(before.status, settings.reservationBlocksDraft)) {
      await assertAvailable(tx, before.vehicleId, before.startAt, before.endAt, { type: 'RESERVATION', id });
    }
    const [r] = await tx.update(reservations).set({
      status: input.status, updatedBy: req.user!.id,
      ...(input.status === 'CANCELLED' ? { cancelledReason: input.reason, cancelledAt: new Date() } : {}),
    }).where(eq(reservations.id, id)).returning();
    await setBlockActive(tx, 'RESERVATION', id, willBlock);
    await audit(tx, req, { action: input.status === 'CANCELLED' ? 'reservation.cancel' : 'reservation.status', entityType: 'reservation', entityId: id,
      summary: `${r.number}: ${before.status} → ${input.status}${input.reason ? ` (${input.reason})` : ''}`, before: { status: before.status }, after: { status: input.status } });
    return r;
  });
  res.json(row);
});

/** Turn a reservation into a rental transaction; schedule block and payments move with it. */
reservationsRouter.post('/reservations/:id/convert', perm('reservation.manage', 'rental.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  const rental = await withTenant(companyId, (tx) => createRentalFromReservation(tx, req, companyId, id));
  res.status(201).json(rental);
});
