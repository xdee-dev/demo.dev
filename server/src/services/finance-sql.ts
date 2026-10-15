import { sql, type SQL } from 'drizzle-orm';

/**
 * Accounting definitions used consistently by the dashboard and every report
 * --------------------------------------------------------------------------
 * • Pendapatan rental (revenue) — recognized on the rental START date, net of tax:
 *     total − tax_amount for non-cancelled rentals; cancellation_fee for cancelled ones
 *     (recognized on the cancellation date). Cash timing does not matter.
 * • Penerimaan kas (cash in) — money actually received on the payment date: payments
 *   minus refunds minus reversals (signed sum of `payments.amount`).
 * • Piutang (receivable) — amount still owed: Σ max(balance, 0) from `rental_balances`.
 * • Pengeluaran (expenses) — POSTED expenses on their expense date (void ones excluded).
 * • Laba operasional — revenue − expenses over the same period.
 * Down payments received before the rental starts therefore show up as cash in one period
 * and as revenue in another; the two are never added together.
 */

export const dayStart = (date: string, tz: string) => sql`((${date}::date)::timestamp at time zone ${tz})`;
export const dayEnd = (date: string, tz: string) => sql`(((${date}::date) + 1)::timestamp at time zone ${tz})`;

export const recognizedRevenue = (companyId: string): SQL => sql`(
  select t.id as rental_id, t.vehicle_id, t.customer_id, t.number,
    case when t.status = 'CANCELLED' then t.cancelled_at else t.start_at end as recognized_at,
    case when t.status = 'CANCELLED' then t.cancellation_fee else t.total - t.tax_amount end as amount,
    t.tax_amount as tax, t.quantity, t.rental_type, t.status
  from rental_transactions t
  where t.company_id = ${companyId} and (t.status <> 'CANCELLED' or t.cancellation_fee > 0)
)`;

export const inRange = (col: SQL, from: string, to: string, tz: string) => sql`${col} >= ${dayStart(from, tz)} and ${col} < ${dayEnd(to, tz)}`;
