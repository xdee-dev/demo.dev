import type { Request } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { payments, rentalTransactions } from '../db/schema.js';
import { zDateTime, zMoney, zOptText, zOptUuid } from '../lib/http.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { D, formatIDR } from '../lib/money.js';
import { nextNumber } from '../lib/numbering.js';
import type { CompanySettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';

export const paymentInput = z.object({
  rentalId: zOptUuid,
  reservationId: zOptUuid,
  kind: z.enum(['PAYMENT', 'REFUND']).default('PAYMENT'),
  amount: zMoney.refine((v) => D(v).gt(0), 'Nominal harus lebih dari 0'),
  isDownPayment: z.boolean().default(false),
  paidAt: zDateTime.default(() => new Date()),
  method: z.string().trim().min(1).max(20),
  cashAccountId: zOptUuid,
  reference: zOptText(120),
  notes: zOptText(1000),
  proofFileId: zOptUuid,
}).refine((v) => !!v.rentalId !== !!v.reservationId, { message: 'Pilih satu transaksi rental atau reservasi', path: ['rentalId'] });
export type PaymentInput = z.infer<typeof paymentInput>;

/** Recalculate lifecycle status that depends on the balance (RETURNED ⇄ COMPLETED). */
export async function syncRentalCompletion(tx: Tx, rentalId: string) {
  const r = await tx.execute<{ status: string; balance: string }>(sql`
    select t.status, b.balance from rental_transactions t join rental_balances b on b.rental_id = t.id where t.id = ${rentalId}`);
  const row = r.rows[0];
  if (!row) return;
  if (row.status === 'RETURNED' && D(row.balance).eq(0)) {
    await tx.update(rentalTransactions).set({ status: 'COMPLETED', completedAt: new Date() }).where(eq(rentalTransactions.id, rentalId));
  } else if (row.status === 'COMPLETED' && !D(row.balance).eq(0)) {
    await tx.update(rentalTransactions).set({ status: 'RETURNED', completedAt: null }).where(eq(rentalTransactions.id, rentalId));
  }
}

/**
 * Posts a payment or refund. Idempotent per (company, Idempotency-Key): a repeated request
 * (double click, network retry) returns the original payment instead of creating another.
 * The target row is locked FOR UPDATE so concurrent payments cannot overdraw the balance.
 */
export async function postPayment(
  tx: Tx, req: Request, companyId: string, timezone: string, settings: CompanySettings, input: PaymentInput, idempotencyKey: string | null,
): Promise<{ payment: typeof payments.$inferSelect; replay: boolean }> {
  if (idempotencyKey) {
    const existing = await tx.query.payments.findFirst({ where: and(eq(payments.companyId, companyId), eq(payments.idempotencyKey, idempotencyKey)) });
    if (existing) return { payment: existing, replay: true };
  }
  if (!settings.paymentMethods.some((m) => m.code === input.method)) throw badRequest('Metode pembayaran tidak dikenal', { fields: { method: 'Pilih metode yang tersedia' } });
  if (input.cashAccountId) {
    const acc = await tx.execute(sql`select is_active from cash_accounts where id = ${input.cashAccountId} and company_id = ${companyId}`);
    if (!acc.rows.length) throw badRequest('Akun kas tidak valid');
    if (!acc.rows[0].is_active) throw badRequest('Akun kas tidak aktif');
  }
  if (input.proofFileId) {
    const f = await tx.execute(sql`select 1 from file_attachments where id = ${input.proofFileId} and company_id = ${companyId} and kind = 'PAYMENT_PROOF'`);
    if (!f.rows.length) throw badRequest('Bukti pembayaran tidak valid');
  }
  if (input.paidAt.getTime() > Date.now() + 5 * 60_000) throw badRequest('Tanggal pembayaran tidak boleh di masa depan');

  let customerId: string;
  let balance: string;
  let label: string;
  if (input.rentalId) {
    const locked = await tx.execute<{ id: string; customer_id: string; number: string; status: string }>(
      sql`select id, customer_id, number, status from rental_transactions where id = ${input.rentalId} and company_id = ${companyId} for update`);
    const rental = locked.rows[0];
    if (!rental) throw notFound('Transaksi rental');
    const b = await tx.execute<{ balance: string }>(sql`select balance from rental_balances where rental_id = ${rental.id}`);
    customerId = rental.customer_id; balance = b.rows[0].balance; label = rental.number;
  } else {
    const locked = await tx.execute<{ id: string; customer_id: string; number: string; status: string }>(
      sql`select id, customer_id, number, status from reservations where id = ${input.reservationId!} and company_id = ${companyId} for update`);
    const r = locked.rows[0];
    if (!r) throw notFound('Reservasi');
    if (!['DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED'].includes(r.status)) throw badRequest('Reservasi sudah menjadi transaksi rental — catat pembayaran pada transaksi rental');
    if (r.status === 'CANCELLED' && input.kind === 'PAYMENT') throw badRequest('Reservasi sudah dibatalkan');
    const b = await tx.execute<{ balance: string }>(sql`select balance from reservation_balances where reservation_id = ${r.id}`);
    customerId = r.customer_id; balance = b.rows[0].balance; label = r.number;
    if (input.kind === 'PAYMENT') input.isDownPayment = true; // money received before the rental exists is a down payment
  }

  const amount = D(input.amount);
  if (input.kind === 'PAYMENT') {
    if (D(balance).lte(0)) throw conflict('Tagihan sudah lunas — tidak ada sisa tagihan', undefined, 'NO_BALANCE');
    if (amount.gt(balance)) throw badRequest(`Nominal melebihi sisa tagihan (${formatIDR(balance)})`, { fields: { amount: `Maksimal ${formatIDR(balance)}` } });
  } else {
    const overpaid = D(balance).neg();
    if (overpaid.lte(0)) throw badRequest('Tidak ada kelebihan pembayaran yang perlu dikembalikan');
    if (amount.gt(overpaid)) throw badRequest(`Refund melebihi kelebihan bayar (${formatIDR(overpaid)})`, { fields: { amount: `Maksimal ${formatIDR(overpaid)}` } });
  }

  const number = await nextNumber(tx, companyId, 'PAYMENT', settings, timezone, input.paidAt);
  const [payment] = await tx.insert(payments).values({
    companyId, number, kind: input.kind, isDownPayment: input.kind === 'PAYMENT' && input.isDownPayment,
    rentalId: input.rentalId ?? null, reservationId: input.reservationId ?? null, customerId, paidAt: input.paidAt,
    method: input.method, cashAccountId: input.cashAccountId ?? null,
    amount: input.kind === 'REFUND' ? amount.neg().toFixed(2) : amount.toFixed(2),
    reference: input.reference, notes: input.notes, proofFileId: input.proofFileId ?? null, idempotencyKey, createdBy: req.user!.id,
  }).returning();
  if (input.proofFileId) await tx.execute(sql`update file_attachments set entity_type = 'payment', entity_id = ${payment.id} where id = ${input.proofFileId}`);
  await audit(tx, req, {
    action: input.kind === 'REFUND' ? 'payment.refund' : 'payment.create', entityType: 'payment', entityId: payment.id,
    summary: `${payment.number} ${formatIDR(amount)} untuk ${label}`, after: { amount: payment.amount, method: payment.method, rentalId: payment.rentalId, reservationId: payment.reservationId },
  });
  if (payment.rentalId) await syncRentalCompletion(tx, payment.rentalId);
  return { payment, replay: false };
}

/** Correction of a posted payment: a new REVERSAL row with the opposite amount. Nothing is deleted. */
export async function reversePayment(tx: Tx, req: Request, companyId: string, timezone: string, settings: CompanySettings, paymentId: string, reason: string) {
  const locked = await tx.execute(sql`select id from payments where id = ${paymentId} and company_id = ${companyId} for update`);
  if (!locked.rows.length) throw notFound('Pembayaran');
  const p = await tx.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!p) throw notFound('Pembayaran');
  if (p.kind === 'REVERSAL') throw badRequest('Entri reversal tidak dapat dibatalkan lagi');
  const already = await tx.query.payments.findFirst({ where: eq(payments.reversesPaymentId, paymentId) });
  if (already) throw conflict('Pembayaran ini sudah dibatalkan sebelumnya');
  if (p.rentalId) await tx.execute(sql`select 1 from rental_transactions where id = ${p.rentalId} for update`);
  const now = new Date();
  const number = await nextNumber(tx, companyId, 'PAYMENT', settings, timezone, now);
  const [rev] = await tx.insert(payments).values({
    companyId, number, kind: 'REVERSAL', rentalId: p.rentalId, reservationId: p.reservationId, customerId: p.customerId, paidAt: now,
    method: p.method, cashAccountId: p.cashAccountId, amount: D(p.amount).neg().toFixed(2), reversesPaymentId: p.id,
    reference: p.number, notes: reason, createdBy: req.user!.id,
  }).returning();
  await audit(tx, req, {
    action: 'payment.reverse', entityType: 'payment', entityId: p.id,
    summary: `Reversal ${p.number} (${formatIDR(p.amount)}) → ${rev.number}: ${reason}`, before: { amount: p.amount }, after: { reversal: rev.number, amount: rev.amount, reason },
  });
  if (p.rentalId) await syncRentalCompletion(tx, p.rentalId);
  return rev;
}
