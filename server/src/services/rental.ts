import type { Request } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { rentalTransactions, reservations, vehicleHandovers, vehicleReturns, vehicles } from '../db/schema.js';
import { bookingInput, priceBooking, type BookingInput } from './booking.js';
import { assertAvailable, upsertBlock, setBlockActive, upsertBlockLenient } from './schedule.js';
import { companySnapshot } from './company.js';
import { postPayment, syncRentalCompletion } from './payment.js';
import { nextNumber } from '../lib/numbering.js';
import { getSettings } from '../lib/settings.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { zDateTime, zMoney, zOptText, zOptUuid, zText } from '../lib/http.js';
import { D, formatIDR } from '../lib/money.js';
import { lateFee as computeLateFee, quote, type RentalType } from '../lib/pricing.js';
import { can } from '../auth/middleware.js';

type Rental = typeof rentalTransactions.$inferSelect;

export const rentalCreateInput = bookingInput.and(z.object({
  downPayment: z.object({
    amount: zMoney, method: z.string().trim().min(1).max(20), cashAccountId: zOptUuid, reference: zOptText(120),
  }).optional().nullable(),
}));
export type RentalCreateInput = z.infer<typeof rentalCreateInput>;

async function lockRental(tx: Tx, companyId: string, id: string): Promise<Rental> {
  await tx.execute(sql`select 1 from rental_transactions where id = ${id} and company_id = ${companyId} for update`);
  const r = await tx.query.rentalTransactions.findFirst({ where: and(eq(rentalTransactions.id, id), eq(rentalTransactions.companyId, companyId)) });
  if (!r) throw notFound('Transaksi rental');
  return r;
}

async function allocateNumbers(tx: Tx, companyId: string, timezone: string) {
  const settings = await getSettings(tx, companyId);
  return {
    settings,
    number: await nextNumber(tx, companyId, 'RENTAL', settings, timezone),
    invoiceNumber: await nextNumber(tx, companyId, 'INVOICE', settings, timezone),
    contractNumber: await nextNumber(tx, companyId, 'CONTRACT', settings, timezone),
  };
}

export async function createRental(tx: Tx, req: Request, companyId: string, timezone: string, input: RentalCreateInput, idempotencyKey: string | null) {
  if (idempotencyKey) {
    const existing = await tx.query.rentalTransactions.findFirst({ where: and(eq(rentalTransactions.companyId, companyId), eq(rentalTransactions.idempotencyKey, idempotencyKey)) });
    if (existing) return existing;
  }
  const { settings, number, invoiceNumber, contractNumber } = await allocateNumbers(tx, companyId, timezone);
  const priced = await priceBooking(tx, req, companyId, input, settings);
  await assertAvailable(tx, input.vehicleId, input.startAt, input.endAt);
  const q = priced.quote;
  if (input.downPayment && D(input.downPayment.amount).gt(q.total)) throw badRequest('Uang muka melebihi total tagihan');
  const [rental] = await tx.insert(rentalTransactions).values({
    companyId, number, invoiceNumber, contractNumber, customerId: input.customerId, vehicleId: input.vehicleId, driverId: input.driverId ?? null,
    startAt: input.startAt, endAt: input.endAt, pickupLocation: input.pickupLocation, returnLocation: input.returnLocation,
    rentalType: input.rentalType, withDriver: input.withDriver, unitPrice: q.unitPrice, quantity: q.quantity, subtotal: q.subtotal,
    discount: q.discount, extraCharges: q.extraCharges, extraChargesNote: input.extraChargesNote, taxPercent: q.taxPercent, taxAmount: q.taxAmount,
    dailyRateSnapshot: priced.dailyRate, total: q.total, notes: input.notes, status: 'SCHEDULED',
    customerSnapshot: priced.customerSnapshot, vehicleSnapshot: priced.vehicleSnapshot, companySnapshot: await companySnapshot(tx, companyId),
    idempotencyKey, createdBy: req.user!.id, updatedBy: req.user!.id,
  }).returning();
  await upsertBlock(tx, companyId, { vehicleId: rental.vehicleId, type: 'RENTAL', id: rental.id, start: rental.startAt, end: rental.endAt, active: true });
  await audit(tx, req, {
    action: 'rental.create', entityType: 'rental', entityId: rental.id, summary: `${rental.number} — ${priced.customerSnapshot.name} — ${formatIDR(rental.total)}`,
    after: { total: rental.total, unitPrice: rental.unitPrice, quantity: rental.quantity, discount: rental.discount, overridden: priced.overridden },
  });
  if (input.downPayment && D(input.downPayment.amount).gt(0)) {
    if (!can(req, 'payment.manage')) throw forbidden('Anda tidak memiliki izin mencatat pembayaran');
    await postPayment(tx, req, companyId, timezone, settings, {
      rentalId: rental.id, kind: 'PAYMENT', amount: input.downPayment.amount, isDownPayment: true, paidAt: new Date(),
      method: input.downPayment.method, cashAccountId: input.downPayment.cashAccountId, reference: input.downPayment.reference,
    }, idempotencyKey ? `${idempotencyKey}-dp` : null);
  }
  return rental;
}

export async function createRentalFromReservation(tx: Tx, req: Request, companyId: string, reservationId: string) {
  await tx.execute(sql`select 1 from reservations where id = ${reservationId} and company_id = ${companyId} for update`);
  const r = await tx.query.reservations.findFirst({ where: and(eq(reservations.id, reservationId), eq(reservations.companyId, companyId)) });
  if (!r) throw notFound('Reservasi');
  if (!['PENDING', 'CONFIRMED', 'DRAFT'].includes(r.status)) throw badRequest('Hanya reservasi aktif yang dapat dijadikan transaksi');
  const timezone = req.ctx!.timezone;
  const { settings, number, invoiceNumber, contractNumber } = await allocateNumbers(tx, companyId, timezone);
  const input: BookingInput = {
    customerId: r.customerId, vehicleId: r.vehicleId, driverId: r.driverId, startAt: r.startAt, endAt: r.endAt, rentalType: r.rentalType,
    withDriver: r.withDriver, pickupLocation: r.pickupLocation, returnLocation: r.returnLocation, unitPrice: r.unitPrice, quantity: r.quantity,
    discount: r.discount, extraCharges: r.extraCharges, extraChargesNote: r.extraChargesNote, notes: r.notes,
  };
  // Agreed reservation prices carry over without requiring the override permission.
  const priced = await priceBooking(tx, req, companyId, input, settings, { ...r, taxPercent: r.taxPercent });
  await assertAvailable(tx, r.vehicleId, r.startAt, r.endAt, { type: 'RESERVATION', id: r.id });
  const q = priced.quote;
  const [rental] = await tx.insert(rentalTransactions).values({
    companyId, number, invoiceNumber, contractNumber, reservationId: r.id, customerId: r.customerId, vehicleId: r.vehicleId, driverId: r.driverId,
    startAt: r.startAt, endAt: r.endAt, pickupLocation: r.pickupLocation, returnLocation: r.returnLocation, rentalType: r.rentalType,
    withDriver: r.withDriver, unitPrice: q.unitPrice, quantity: q.quantity, subtotal: q.subtotal, discount: q.discount, extraCharges: q.extraCharges,
    extraChargesNote: r.extraChargesNote, taxPercent: q.taxPercent, taxAmount: q.taxAmount, dailyRateSnapshot: priced.dailyRate, total: q.total,
    notes: r.notes, status: 'SCHEDULED', customerSnapshot: priced.customerSnapshot, vehicleSnapshot: priced.vehicleSnapshot,
    companySnapshot: await companySnapshot(tx, companyId), createdBy: req.user!.id, updatedBy: req.user!.id,
  }).returning();
  // Block moves from the reservation to the rental atomically (no window where the vehicle looks free).
  await setBlockActive(tx, 'RESERVATION', r.id, false);
  await upsertBlock(tx, companyId, { vehicleId: rental.vehicleId, type: 'RENTAL', id: rental.id, start: rental.startAt, end: rental.endAt, active: true });
  await tx.update(reservations).set({ status: 'ACTIVE', rentalId: rental.id, updatedBy: req.user!.id }).where(eq(reservations.id, r.id));
  const moved = await tx.execute(sql`update payments set rental_id = ${rental.id} where reservation_id = ${r.id} and rental_id is null`);
  await audit(tx, req, {
    action: 'reservation.convert', entityType: 'rental', entityId: rental.id,
    summary: `${r.number} → ${rental.number} (${moved.rowCount ?? 0} pembayaran dipindahkan)`, after: { total: rental.total },
  });
  return rental;
}

export const rentalUpdateInput = bookingInput;

export async function updateRental(tx: Tx, req: Request, companyId: string, id: string, input: BookingInput) {
  const before = await lockRental(tx, companyId, id);
  if (!['SCHEDULED', 'ONGOING'].includes(before.status)) throw badRequest('Transaksi yang sudah dikembalikan/selesai/batal tidak dapat diubah');
  if (before.status === 'ONGOING') {
    // vehicle is out: only the return plan, pricing and notes can change
    if (input.vehicleId !== before.vehicleId || input.customerId !== before.customerId || input.startAt.getTime() !== before.startAt.getTime()) {
      throw badRequest('Kendaraan sedang disewa: customer, kendaraan, dan waktu mulai tidak dapat diubah');
    }
  }
  const settings = await getSettings(tx, companyId);
  const priced = await priceBooking(tx, req, companyId, input, settings, before);
  const blockStart = before.actualStartAt && before.actualStartAt < input.startAt ? before.actualStartAt : input.startAt;
  await assertAvailable(tx, input.vehicleId, blockStart, input.endAt, { type: 'RENTAL', id });
  const q = priced.quote;
  const patch = {
    customerId: input.customerId, vehicleId: input.vehicleId, driverId: input.driverId ?? null, startAt: input.startAt, endAt: input.endAt,
    pickupLocation: input.pickupLocation ?? null, returnLocation: input.returnLocation ?? null, rentalType: input.rentalType, withDriver: input.withDriver,
    unitPrice: q.unitPrice, quantity: q.quantity, subtotal: q.subtotal, discount: q.discount, extraCharges: q.extraCharges,
    extraChargesNote: input.extraChargesNote ?? null, taxAmount: q.taxAmount, total: q.total, notes: input.notes ?? null,
    dailyRateSnapshot: input.vehicleId !== before.vehicleId || input.withDriver !== before.withDriver ? priced.dailyRate : before.dailyRateSnapshot,
    ...(input.customerId !== before.customerId ? { customerSnapshot: priced.customerSnapshot } : {}),
    ...(input.vehicleId !== before.vehicleId ? { vehicleSnapshot: priced.vehicleSnapshot } : {}),
  };
  const [after] = await tx.update(rentalTransactions).set({ ...patch, updatedBy: req.user!.id }).where(eq(rentalTransactions.id, id)).returning();
  await upsertBlock(tx, companyId, { vehicleId: after.vehicleId, type: 'RENTAL', id, start: blockStart, end: after.endAt, active: true });
  const d = diff(before as Record<string, unknown>, patch as Record<string, unknown>);
  if (d.changed) {
    const { customerSnapshot: _c, vehicleSnapshot: _v, ...b } = d.before; const { customerSnapshot: _c2, vehicleSnapshot: _v2, ...a } = d.after;
    await audit(tx, req, { action: 'rental.update', entityType: 'rental', entityId: id, summary: `${after.number}: total ${formatIDR(before.total)} → ${formatIDR(after.total)}`, before: b, after: a });
  }
  await syncRentalCompletion(tx, id);
  return after;
}

export const handoverInput = z.object({
  handedAt: zDateTime.default(() => new Date()),
  km: z.coerce.number().int().min(0).max(9_999_999).optional().nullable(),
  fuelLevel: zOptText(20),
  checklist: z.record(z.string().max(60), z.union([z.boolean(), z.string().max(200)])).default({}),
  conditionNotes: zOptText(2000),
  staffName: zOptText(100),
  receiverName: zOptText(100),
});

export async function handover(tx: Tx, req: Request, companyId: string, id: string, input: z.infer<typeof handoverInput>) {
  const r = await lockRental(tx, companyId, id);
  if (r.status !== 'SCHEDULED') throw badRequest('Serah terima hanya untuk transaksi berstatus Terjadwal');
  if (input.handedAt.getTime() > Date.now() + 10 * 60_000) throw badRequest('Waktu serah terima tidak boleh di masa depan');
  if (input.handedAt >= r.endAt) throw badRequest('Waktu serah terima melewati rencana pengembalian');
  const blockStart = input.handedAt < r.startAt ? input.handedAt : r.startAt;
  if (blockStart < r.startAt) await assertAvailable(tx, r.vehicleId, blockStart, r.endAt, { type: 'RENTAL', id });
  await tx.insert(vehicleHandovers).values({ companyId, rentalId: id, ...input, createdBy: req.user!.id });
  const [after] = await tx.update(rentalTransactions).set({ status: 'ONGOING', actualStartAt: input.handedAt, updatedBy: req.user!.id })
    .where(eq(rentalTransactions.id, id)).returning();
  await upsertBlock(tx, companyId, { vehicleId: r.vehicleId, type: 'RENTAL', id, start: blockStart, end: r.endAt, active: true });
  if (input.km != null) await tx.update(vehicles).set({ currentKm: sql`greatest(coalesce(${vehicles.currentKm}, 0), ${input.km})` }).where(eq(vehicles.id, r.vehicleId));
  await audit(tx, req, { action: 'rental.handover', entityType: 'rental', entityId: id, summary: `${r.number} diserahkan`, after: { handedAt: input.handedAt, km: input.km, fuelLevel: input.fuelLevel } });
  return after;
}

export const returnInput = z.object({
  returnedAt: zDateTime.default(() => new Date()),
  km: z.coerce.number().int().min(0).max(9_999_999).optional().nullable(),
  fuelLevel: zOptText(20),
  checklist: z.record(z.string().max(60), z.union([z.boolean(), z.string().max(200)])).default({}),
  conditionNotes: zOptText(2000),
  lateFee: zMoney.optional().nullable(),
  damageFee: zMoney.default('0'),
  damageNotes: zOptText(2000),
  staffName: zOptText(100),
  returnerName: zOptText(100),
});

export async function previewReturn(tx: Tx, companyId: string, r: Rental, returnedAt: Date) {
  const settings = await getSettings(tx, companyId);
  const lf = computeLateFee({
    plannedEnd: r.endAt, actualEnd: returnedAt, graceMinutes: settings.graceMinutes, mode: settings.lateFeeMode,
    dailyRate: r.dailyRateSnapshot, hourlyRate: settings.lateFeePerHour, decimals: settings.moneyDecimals,
  });
  return { ...lf, settings };
}

export async function returnVehicle(tx: Tx, req: Request, companyId: string, id: string, input: z.infer<typeof returnInput>) {
  const r = await lockRental(tx, companyId, id);
  if (r.status !== 'ONGOING') throw badRequest('Pengembalian hanya untuk kendaraan yang sedang disewa');
  if (input.returnedAt.getTime() > Date.now() + 10 * 60_000) throw badRequest('Waktu pengembalian tidak boleh di masa depan');
  const startedAt = r.actualStartAt ?? r.startAt;
  if (input.returnedAt <= startedAt) throw badRequest('Waktu pengembalian harus setelah waktu serah terima');
  const handoverRow = await tx.query.vehicleHandovers.findFirst({ where: eq(vehicleHandovers.rentalId, id) });
  if (input.km != null && handoverRow?.km != null && input.km < handoverRow.km) throw badRequest(`Kilometer akhir lebih kecil dari kilometer awal (${handoverRow.km})`);

  const { lateMinutes, fee: suggestedFee, settings } = await previewReturn(tx, companyId, r, input.returnedAt);
  const lateFee = input.lateFee ?? suggestedFee;
  if (!D(lateFee).eq(suggestedFee) && !can(req, 'rental.price_override')) throw forbidden('Anda tidak memiliki izin mengubah denda keterlambatan');

  const q = quote({
    startAt: r.startAt, endAt: r.endAt, rentalType: r.rentalType as RentalType, unitPrice: r.unitPrice, quantity: r.quantity,
    discount: r.discount, extraCharges: r.extraCharges, lateFee, damageFee: input.damageFee, taxPercent: r.taxPercent,
    graceMinutes: settings.graceMinutes, decimals: settings.moneyDecimals,
  });
  await tx.insert(vehicleReturns).values({
    companyId, rentalId: id, returnedAt: input.returnedAt, km: input.km, fuelLevel: input.fuelLevel, checklist: input.checklist,
    conditionNotes: input.conditionNotes, lateMinutes, lateFee: q.lateFee, damageFee: q.damageFee, damageNotes: input.damageNotes,
    staffName: input.staffName, returnerName: input.returnerName, createdBy: req.user!.id,
  });
  const [after] = await tx.update(rentalTransactions).set({
    status: 'RETURNED', actualEndAt: input.returnedAt, lateFee: q.lateFee, damageFee: q.damageFee, taxAmount: q.taxAmount, total: q.total, updatedBy: req.user!.id,
  }).where(eq(rentalTransactions.id, id)).returning();

  // The block now covers what was actually used: early returns free the vehicle; late returns extend
  // the block when possible. A late return that collides with the next booking is flagged, not refused.
  const blockStart = r.actualStartAt && r.actualStartAt < r.startAt ? r.actualStartAt : r.startAt;
  const warning = await upsertBlockLenient(tx, companyId, { vehicleId: r.vehicleId, type: 'RENTAL', id, start: blockStart, end: input.returnedAt, active: true }, r.endAt);
  if (input.km != null) await tx.update(vehicles).set({ currentKm: sql`greatest(coalesce(${vehicles.currentKm}, 0), ${input.km})` }).where(eq(vehicles.id, r.vehicleId));
  await audit(tx, req, {
    action: 'rental.return', entityType: 'rental', entityId: id, summary: `${r.number} dikembalikan${lateMinutes > 0 ? ` (terlambat ${Math.round(lateMinutes / 60)} jam)` : ''}`,
    before: { total: r.total }, after: { total: after.total, lateFee: q.lateFee, damageFee: q.damageFee, returnedAt: input.returnedAt, km: input.km },
  });
  await syncRentalCompletion(tx, id);
  const final = await tx.query.rentalTransactions.findFirst({ where: eq(rentalTransactions.id, id) });
  return { rental: final!, warning };
}

export async function completeRental(tx: Tx, req: Request, companyId: string, id: string) {
  const r = await lockRental(tx, companyId, id);
  if (r.status === 'COMPLETED') return r;
  if (r.status !== 'RETURNED') throw badRequest('Transaksi hanya dapat diselesaikan setelah kendaraan dikembalikan');
  const settings = await getSettings(tx, companyId);
  const b = await tx.execute<{ balance: string }>(sql`select balance from rental_balances where rental_id = ${id}`);
  const balance = D(b.rows[0].balance);
  if (balance.lt(0)) throw conflict(`Terdapat kelebihan bayar ${formatIDR(balance.neg())}. Catat pengembalian dana terlebih dahulu.`);
  if (balance.gt(0) && settings.requireFullPaymentToComplete) throw conflict(`Masih ada sisa tagihan ${formatIDR(balance)}. Lunasi terlebih dahulu.`);
  const [after] = await tx.update(rentalTransactions).set({ status: 'COMPLETED', completedAt: new Date(), updatedBy: req.user!.id }).where(eq(rentalTransactions.id, id)).returning();
  if (after.reservationId) await tx.update(reservations).set({ status: 'COMPLETED' }).where(eq(reservations.id, after.reservationId));
  await audit(tx, req, { action: 'rental.complete', entityType: 'rental', entityId: id, summary: `${r.number} selesai${balance.gt(0) ? ` dengan piutang ${formatIDR(balance)}` : ''}` });
  return after;
}

export const cancelInput = z.object({ reason: zText(500).min(3, 'Alasan wajib diisi'), cancellationFee: zMoney.default('0') });

export async function cancelRental(tx: Tx, req: Request, companyId: string, id: string, input: z.infer<typeof cancelInput>) {
  const r = await lockRental(tx, companyId, id);
  if (r.status !== 'SCHEDULED') throw badRequest('Hanya transaksi yang belum diserahterimakan yang dapat dibatalkan');
  if (D(input.cancellationFee).gt(r.total)) throw badRequest('Biaya pembatalan melebihi total transaksi');
  const [after] = await tx.update(rentalTransactions).set({
    status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: input.reason, cancellationFee: input.cancellationFee, updatedBy: req.user!.id,
  }).where(eq(rentalTransactions.id, id)).returning();
  await setBlockActive(tx, 'RENTAL', id, false);
  if (r.reservationId) await tx.update(reservations).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: input.reason }).where(eq(reservations.id, r.reservationId));
  const b = await tx.execute<{ balance: string }>(sql`select balance from rental_balances where rental_id = ${id}`);
  await audit(tx, req, {
    action: 'rental.cancel', entityType: 'rental', entityId: id, summary: `${r.number} dibatalkan: ${input.reason}`,
    before: { status: r.status, total: r.total }, after: { status: 'CANCELLED', cancellationFee: input.cancellationFee, balance: b.rows[0].balance },
  });
  return after;
}
