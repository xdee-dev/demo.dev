import { D, roundMoney, type MoneyInput } from './money.js';
import { badRequest } from './errors.js';

export type RentalType = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export const UNIT_MINUTES: Record<RentalType, number> = {
  DAILY: 24 * 60,
  WEEKLY: 7 * 24 * 60,
  MONTHLY: 30 * 24 * 60,
};

export const UNIT_LABEL: Record<RentalType, string> = { DAILY: 'hari', WEEKLY: 'minggu', MONTHLY: 'bulan' };

/**
 * Number of billable units. A grace period (e.g. 60 minutes) is tolerated before an extra
 * unit is charged. Minimum 1 unit.
 */
export function billableUnits(startAt: Date, endAt: Date, rentalType: RentalType, graceMinutes = 0): number {
  const minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
  if (minutes <= 0) throw badRequest('Tanggal selesai harus setelah tanggal mulai');
  const unit = UNIT_MINUTES[rentalType];
  const billable = Math.max(minutes - Math.max(graceMinutes, 0), 1);
  return Math.max(1, Math.ceil(billable / unit));
}

export interface QuoteInput {
  startAt: Date;
  endAt: Date;
  rentalType: RentalType;
  unitPrice: MoneyInput;
  quantity?: number | null; // override (requires permission)
  discount?: MoneyInput;
  extraCharges?: MoneyInput;
  lateFee?: MoneyInput;
  damageFee?: MoneyInput;
  taxPercent?: MoneyInput;
  graceMinutes?: number;
  decimals?: number;
}

export interface Quote {
  durationMinutes: number;
  autoQuantity: number;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  discount: string;
  extraCharges: string;
  lateFee: string;
  damageFee: string;
  taxPercent: string;
  taxableBase: string;
  taxAmount: string;
  total: string;
}

/** All money math for a rental/reservation. Results are DB-ready strings with 2 decimals. */
export function quote(input: QuoteInput): Quote {
  const decimals = input.decimals ?? 0;
  const durationMinutes = Math.round((input.endAt.getTime() - input.startAt.getTime()) / 60000);
  const autoQuantity = billableUnits(input.startAt, input.endAt, input.rentalType, input.graceMinutes ?? 0);
  const quantity = input.quantity && input.quantity > 0 ? Math.floor(input.quantity) : autoQuantity;
  const unitPrice = roundMoney(input.unitPrice, decimals);
  const discount = roundMoney(input.discount, decimals);
  const extra = roundMoney(input.extraCharges, decimals);
  const lateFee = roundMoney(input.lateFee, decimals);
  const damageFee = roundMoney(input.damageFee, decimals);
  const taxPercent = D(input.taxPercent);

  for (const [label, v] of [['Harga satuan', unitPrice], ['Diskon', discount], ['Biaya tambahan', extra], ['Denda', lateFee], ['Biaya kerusakan', damageFee]] as const) {
    if (v.isNegative()) throw badRequest(`${label} tidak boleh negatif`);
  }
  if (taxPercent.isNegative() || taxPercent.gt(100)) throw badRequest('Persentase pajak tidak valid');

  const subtotal = unitPrice.times(quantity);
  const taxableBase = subtotal.minus(discount).plus(extra).plus(lateFee).plus(damageFee);
  if (taxableBase.isNegative()) throw badRequest('Diskon melebihi nilai transaksi');
  const taxAmount = roundMoney(taxableBase.times(taxPercent).dividedBy(100), decimals);
  const total = taxableBase.plus(taxAmount);

  return {
    durationMinutes,
    autoQuantity,
    quantity,
    unitPrice: unitPrice.toFixed(2),
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    extraCharges: extra.toFixed(2),
    lateFee: lateFee.toFixed(2),
    damageFee: damageFee.toFixed(2),
    taxPercent: taxPercent.toFixed(2),
    taxableBase: taxableBase.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    total: total.toFixed(2),
  };
}

export interface LateFeeInput {
  plannedEnd: Date;
  actualEnd: Date;
  graceMinutes: number;
  mode: 'PER_DAY' | 'PER_HOUR';
  dailyRate: MoneyInput;
  hourlyRate: MoneyInput;
  decimals?: number;
}

/** Late fee suggestion at vehicle return. Staff may adjust it (with permission). */
export function lateFee(input: LateFeeInput): { lateMinutes: number; units: number; fee: string } {
  const lateMinutes = Math.max(0, Math.round((input.actualEnd.getTime() - input.plannedEnd.getTime()) / 60000));
  if (lateMinutes <= input.graceMinutes) return { lateMinutes, units: 0, fee: '0.00' };
  const chargeable = lateMinutes - input.graceMinutes;
  const units = input.mode === 'PER_HOUR' ? Math.ceil(chargeable / 60) : Math.ceil(chargeable / (24 * 60));
  const rate = input.mode === 'PER_HOUR' ? D(input.hourlyRate) : D(input.dailyRate);
  return { lateMinutes, units, fee: roundMoney(rate.times(units), input.decimals ?? 0).toFixed(2) };
}
