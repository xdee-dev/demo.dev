import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type MoneyInput = string | number | Decimal | null | undefined;

export const D = (v: MoneyInput): Decimal => {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  if (v instanceof Decimal) return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Invalid money value');
    return new Decimal(v.toString());
  }
  return new Decimal(normalizeMoneyString(v));
};

/**
 * Accepts '1250000', '1250000.50', '1.250.000', '1.250.000,50', 'Rp 1.250.000'.
 * Indonesian format (dot thousands, comma decimal) and plain machine format are supported.
 */
export function normalizeMoneyString(raw: string): string {
  let s = String(raw).trim().replace(/rp\.?/i, '').replace(/\s/g, '');
  if (s === '') return '0';
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (s.includes(',')) {
    // Indonesian: dots are thousands separators, comma is decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) {
    // 1.250.000 → thousands separators
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Nilai nominal tidak valid: ${raw}`);
  return (neg ? '-' : '') + s;
}

/** Round to the configured number of decimals (IDR default 0). */
export const roundMoney = (v: MoneyInput, decimals = 2): Decimal => D(v).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);

/** Canonical DB string with 2 decimals, e.g. '1250000.00'. */
export const toDb = (v: MoneyInput): string => D(v).toFixed(2);

export const sum = (values: MoneyInput[]): Decimal => values.reduce<Decimal>((a, v) => a.plus(D(v)), new Decimal(0));

/** Indonesian display format: Rp 1.250.000 or Rp 12.500.000,50 */
export function formatIDR(v: MoneyInput, opts: { decimals?: number; symbol?: boolean } = {}): string {
  const d = D(v);
  const decimals = opts.decimals ?? (d.isInteger() ? 0 : 2);
  const fixed = d.abs().toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = frac ? `${grouped},${frac}` : grouped;
  const sign = d.isNegative() && !d.isZero() ? '-' : '';
  return opts.symbol === false ? `${sign}${body}` : `${sign}Rp ${body}`;
}

export type PaymentStatus = 'UNPAID' | 'DP_PAID' | 'PARTIAL' | 'PAID' | 'REFUND_DUE';

/**
 * Payment status is derived, never typed in. Mirrors SQL function payment_status().
 * @param due        amount the customer owes (total, or cancellation fee when cancelled)
 * @param paid       net of payments, refunds and reversals
 * @param nonDpCount number of non-reversed, non-down-payment PAYMENT entries
 */
export function paymentStatus(due: MoneyInput, paid: MoneyInput, nonDpCount: number): PaymentStatus {
  const d = D(due);
  const p = D(paid);
  if (p.gt(d)) return 'REFUND_DUE';
  if (p.gte(d)) return 'PAID';
  if (p.lte(0)) return 'UNPAID';
  if (nonDpCount === 0) return 'DP_PAID';
  return 'PARTIAL';
}
