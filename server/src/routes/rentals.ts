import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import { rentalTransactions, vehicleHandovers, vehicleReturns } from '../db/schema.js';
import { perm, anyPerm, can } from '../auth/middleware.js';
import { body, parse, query, listQuery, paged, zUuid, zOptDate, zDateTime, likeTerm, idempotencyKey } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getSettings } from '../lib/settings.js';
import { bookingInput, priceBooking } from '../services/booking.js';
import { findConflicts } from '../services/schedule.js';
import {
  createRental, rentalCreateInput, updateRental, handover, handoverInput, returnVehicle, returnInput, previewReturn,
  completeRental, cancelRental, cancelInput,
} from '../services/rental.js';

export const rentalsRouter = Router();

export const RENTAL_LIST_COLUMNS = sql`
  t.id, t.number, t.invoice_number as "invoiceNumber", t.status, t.start_at as "startAt", t.end_at as "endAt",
  t.actual_start_at as "actualStartAt", t.actual_end_at as "actualEndAt", t.rental_type as "rentalType", t.with_driver as "withDriver",
  t.total, b.amount_due as "amountDue", b.paid, b.balance, b.payment_status as "paymentStatus",
  t.customer_id as "customerId", t.vehicle_id as "vehicleId",
  t.customer_snapshot->>'name' as "customerName", t.customer_snapshot->>'phone' as "customerPhone",
  t.vehicle_snapshot->>'plateNumber' as "plateNumber", (t.vehicle_snapshot->>'brand') || ' ' || (t.vehicle_snapshot->>'model') as "vehicleName",
  (t.status = 'ONGOING' and t.end_at < now()) as overdue, t.created_at as "createdAt"`;

rentalsRouter.get('/rentals', perm('rental.view'), async (req, res) => {
  const q = query(req, listQuery.extend({
    status: z.string().max(80).optional(),
    paymentStatus: z.string().max(80).optional(),
    from: zOptDate, to: zOptDate,
    vehicleId: z.uuid().optional(), customerId: z.uuid().optional(),
    overdue: z.enum(['true']).optional(),
    dueToday: z.enum(['return', 'start']).optional(),
  }));
  const { companyId, timezone } = req.ctx!;
  const statuses = q.status?.split(',').filter((s) => ['SCHEDULED', 'ONGOING', 'RETURNED', 'COMPLETED', 'CANCELLED'].includes(s));
  const pstatuses = q.paymentStatus?.split(',').filter((s) => ['UNPAID', 'DP_PAID', 'PARTIAL', 'PAID', 'REFUND_DUE'].includes(s));
  const sortCols: Record<string, string> = { number: 't.number', startAt: 't.start_at', endAt: 't.end_at', total: 't.total', balance: 'b.balance', createdAt: 't.created_at' };
  const result = await withTenant(companyId, async (tx) => {
    const today = sql`(now() at time zone ${timezone})::date`;
    const where = sql`t.company_id = ${companyId}
      ${statuses?.length ? sql`and t.status::text in (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})` : sql``}
      ${pstatuses?.length ? sql`and b.payment_status in (${sql.join(pstatuses.map((s) => sql`${s}`), sql`, `)})` : sql``}
      ${q.from ? sql`and t.start_at >= (${q.from}::date)::timestamp at time zone ${timezone}` : sql``}
      ${q.to ? sql`and t.start_at < ((${q.to}::date + 1)::timestamp at time zone ${timezone})` : sql``}
      ${q.vehicleId ? sql`and t.vehicle_id = ${q.vehicleId}` : sql``}
      ${q.customerId ? sql`and t.customer_id = ${q.customerId}` : sql``}
      ${q.overdue ? sql`and t.status = 'ONGOING' and t.end_at < now()` : sql``}
      ${q.dueToday === 'return' ? sql`and t.status = 'ONGOING' and (t.end_at at time zone ${timezone})::date = ${today}` : sql``}
      ${q.dueToday === 'start' ? sql`and t.status = 'SCHEDULED' and (t.start_at at time zone ${timezone})::date = ${today}` : sql``}
      ${q.q ? sql`and (t.number ilike ${likeTerm(q.q)} or t.invoice_number ilike ${likeTerm(q.q)} or t.customer_snapshot->>'name' ilike ${likeTerm(q.q)} or t.vehicle_snapshot->>'plateNumber' ilike ${likeTerm(q.q)})` : sql``}`;
    const total = await tx.execute<{ n: number }>(sql`select count(*)::int as n from rental_transactions t join rental_balances b on b.rental_id = t.id where ${where}`);
    const rows = await tx.execute(sql`
      select ${RENTAL_LIST_COLUMNS}
      from rental_transactions t join rental_balances b on b.rental_id = t.id
      where ${where}
      order by ${sql.raw(sortCols[q.sort ?? ''] ?? 't.start_at')} ${sql.raw(q.dir)}, t.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return paged(rows.rows, total.rows[0].n, q);
  });
  res.json(result);
});

/** Live price + availability preview for the transaction/reservation form. Nothing is saved. */
rentalsRouter.post('/pricing/quote', anyPerm('rental.manage', 'reservation.manage'), async (req, res) => {
  const input = body(req, bookingInput.and(z.object({ excludeType: z.enum(['RESERVATION', 'RENTAL']).optional(), excludeId: z.uuid().optional() })));
  const { companyId } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const settings = await getSettings(tx, companyId);
    let existing;
    if (input.excludeType === 'RENTAL' && input.excludeId) existing = await tx.query.rentalTransactions.findFirst({ where: and(eq(rentalTransactions.id, input.excludeId), eq(rentalTransactions.companyId, companyId)) });
    if (input.excludeType === 'RESERVATION' && input.excludeId) existing = await tx.query.reservations.findFirst({ where: (r, { eq: e, and: a }) => a(e(r.id, input.excludeId!), e(r.companyId, companyId)) });
    let priced = null; let error: string | null = null;
    try { priced = await priceBooking(tx, req, companyId, input, settings, existing ?? undefined); } catch (e) { error = (e as Error).message; }
    const conflicts = await findConflicts(tx, input.vehicleId, input.startAt, input.endAt, input.excludeType && input.excludeId ? { type: input.excludeType, id: input.excludeId } : undefined);
    return { quote: priced?.quote ?? null, rate: priced?.rate ?? null, overridden: priced?.overridden ?? false, error, conflicts, canOverride: can(req, 'rental.price_override') };
  });
  res.json(data);
});

rentalsRouter.get('/rentals/:id', perm('rental.view'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const rental = await tx.query.rentalTransactions.findFirst({ where: and(eq(rentalTransactions.id, id), eq(rentalTransactions.companyId, companyId)) });
    if (!rental) throw notFound('Transaksi rental');
    const balance = (await tx.execute(sql`select amount_due as "amountDue", paid, balance, payment_status as "paymentStatus" from rental_balances where rental_id = ${id}`)).rows[0];
    const payments = can(req, 'payment.view') ? (await tx.execute(sql`
      select p.id, p.number, p.kind, p.amount, p.paid_at as "paidAt", p.method, p.reference, p.notes, p.is_down_payment as "isDownPayment",
        p.reverses_payment_id as "reversesPaymentId", p.proof_file_id as "proofFileId", ca.name as "cashAccountName",
        exists (select 1 from payments r where r.reverses_payment_id = p.id) as reversed, u.name as "createdByName"
      from payments p left join cash_accounts ca on ca.id = p.cash_account_id left join users u on u.id = p.created_by
      where p.rental_id = ${id} order by p.paid_at, p.created_at`)).rows : [];
    const handoverRow = await tx.query.vehicleHandovers.findFirst({ where: eq(vehicleHandovers.rentalId, id) });
    const returnRow = await tx.query.vehicleReturns.findFirst({ where: eq(vehicleReturns.rentalId, id) });
    const driver = rental.driverId ? (await tx.execute(sql`select id, name, phone, license_number as "licenseNumber" from drivers where id = ${rental.driverId}`)).rows[0] : null;
    const reservation = rental.reservationId ? (await tx.execute(sql`select id, number from reservations where id = ${rental.reservationId}`)).rows[0] : null;
    const expenses = can(req, 'expense.view') ? (await tx.execute(sql`select e.id, e.number, e.expense_date as "expenseDate", e.description, e.amount, e.status, c.name as "categoryName"
      from expenses e join expense_categories c on c.id = e.category_id where e.rental_id = ${id} order by e.expense_date`)).rows : [];
    return { rental, balance, payments, handover: handoverRow ?? null, return: returnRow ?? null, driver, reservation, expenses };
  });
  res.json(data);
});

rentalsRouter.post('/rentals', perm('rental.manage'), async (req, res) => {
  const input = body(req, rentalCreateInput);
  const key = idempotencyKey(req);
  const { companyId, timezone } = req.ctx!;
  const rental = await withTenant(companyId, (tx) => createRental(tx, req, companyId, timezone, input, key));
  res.status(201).json(rental);
});

rentalsRouter.put('/rentals/:id', perm('rental.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, bookingInput);
  const { companyId } = req.ctx!;
  const rental = await withTenant(companyId, (tx) => updateRental(tx, req, companyId, id, input));
  res.json(rental);
});

rentalsRouter.post('/rentals/:id/handover', perm('handover.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, handoverInput);
  const { companyId } = req.ctx!;
  res.json(await withTenant(companyId, (tx) => handover(tx, req, companyId, id, input)));
});

rentalsRouter.post('/rentals/:id/return-preview', perm('handover.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { returnedAt } = body(req, z.object({ returnedAt: zDateTime }));
  const { companyId } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const r = await tx.query.rentalTransactions.findFirst({ where: and(eq(rentalTransactions.id, id), eq(rentalTransactions.companyId, companyId)) });
    if (!r) throw notFound('Transaksi rental');
    if (r.status !== 'ONGOING') throw badRequest('Kendaraan tidak sedang disewa');
    const { lateMinutes, units, fee, settings } = await previewReturn(tx, companyId, r, returnedAt);
    return { lateMinutes, units, lateFee: fee, mode: settings.lateFeeMode, graceMinutes: settings.graceMinutes, dailyRate: r.dailyRateSnapshot };
  });
  res.json(data);
});

rentalsRouter.post('/rentals/:id/return', perm('handover.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, returnInput);
  const { companyId } = req.ctx!;
  res.json(await withTenant(companyId, (tx) => returnVehicle(tx, req, companyId, id, input)));
});

rentalsRouter.post('/rentals/:id/complete', perm('rental.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  res.json(await withTenant(companyId, (tx) => completeRental(tx, req, companyId, id)));
});

rentalsRouter.post('/rentals/:id/cancel', perm('rental.cancel'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, cancelInput);
  const { companyId } = req.ctx!;
  res.json(await withTenant(companyId, (tx) => cancelRental(tx, req, companyId, id, input)));
});
