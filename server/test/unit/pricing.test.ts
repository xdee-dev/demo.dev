import { describe, it, expect } from 'vitest';
import { billableUnits, quote, lateFee } from '../../src/lib/pricing.js';

const t = (s: string) => new Date(s);

describe('duration → billable units', () => {
  it('counts started days after the grace period', () => {
    expect(billableUnits(t('2026-01-01T09:00Z'), t('2026-01-02T09:00Z'), 'DAILY', 60)).toBe(1);
    expect(billableUnits(t('2026-01-01T09:00Z'), t('2026-01-02T09:59Z'), 'DAILY', 60)).toBe(1); // within grace
    expect(billableUnits(t('2026-01-01T09:00Z'), t('2026-01-02T10:01Z'), 'DAILY', 60)).toBe(2);
    expect(billableUnits(t('2026-01-01T09:00Z'), t('2026-01-01T13:00Z'), 'DAILY', 60)).toBe(1); // minimum 1
    expect(billableUnits(t('2026-01-01T09:00Z'), t('2026-01-08T09:00Z'), 'WEEKLY', 0)).toBe(1);
    expect(billableUnits(t('2026-01-01T09:00Z'), t('2026-01-09T09:00Z'), 'WEEKLY', 0)).toBe(2);
    expect(billableUnits(t('2026-01-01T09:00Z'), t('2026-01-31T09:00Z'), 'MONTHLY', 0)).toBe(1);
  });
  it('rejects end before start', () => {
    expect(() => billableUnits(t('2026-01-02T09:00Z'), t('2026-01-01T09:00Z'), 'DAILY')).toThrow();
  });
});

describe('quote', () => {
  it('computes subtotal, discount, extras, tax and total exactly', () => {
    const q = quote({ startAt: t('2026-01-01T09:00Z'), endAt: t('2026-01-04T09:00Z'), rentalType: 'DAILY', unitPrice: '350000',
      discount: '50000', extraCharges: '150000', taxPercent: '11', graceMinutes: 60, decimals: 0 });
    expect(q.quantity).toBe(3);
    expect(q.subtotal).toBe('1050000.00');
    expect(q.taxableBase).toBe('1150000.00');
    expect(q.taxAmount).toBe('126500.00');
    expect(q.total).toBe('1276500.00');
  });
  it('respects quantity override and late/damage fees', () => {
    const q = quote({ startAt: t('2026-01-01T09:00Z'), endAt: t('2026-01-02T09:00Z'), rentalType: 'DAILY', unitPrice: 300000, quantity: 2,
      lateFee: '300000', damageFee: '250000', decimals: 0 });
    expect(q.autoQuantity).toBe(1);
    expect(q.quantity).toBe(2);
    expect(q.total).toBe('1150000.00');
  });
  it('refuses a discount larger than the bill', () => {
    expect(() => quote({ startAt: t('2026-01-01T09:00Z'), endAt: t('2026-01-02T09:00Z'), rentalType: 'DAILY', unitPrice: 100000, discount: 200000 })).toThrow();
  });
  it('rounds tax half-up to whole rupiah', () => {
    const q = quote({ startAt: t('2026-01-01T09:00Z'), endAt: t('2026-01-02T09:00Z'), rentalType: 'DAILY', unitPrice: '333333', taxPercent: '11', decimals: 0 });
    expect(q.taxAmount).toBe('36667.00'); // 36666.63 → 36667
    expect(q.total).toBe('370000.00');
  });
});

describe('late fee', () => {
  const base = { plannedEnd: t('2026-01-05T09:00Z'), graceMinutes: 60, dailyRate: '300000', hourlyRate: '50000', decimals: 0 };
  it('is zero inside the grace period', () => {
    expect(lateFee({ ...base, mode: 'PER_DAY', actualEnd: t('2026-01-05T09:45Z') }).fee).toBe('0.00');
  });
  it('charges per started day after grace', () => {
    expect(lateFee({ ...base, mode: 'PER_DAY', actualEnd: t('2026-01-05T12:00Z') })).toMatchObject({ units: 1, fee: '300000.00' });
    expect(lateFee({ ...base, mode: 'PER_DAY', actualEnd: t('2026-01-06T12:00Z') })).toMatchObject({ units: 2, fee: '600000.00' });
  });
  it('charges per started hour when configured', () => {
    expect(lateFee({ ...base, mode: 'PER_HOUR', actualEnd: t('2026-01-05T12:30Z') })).toMatchObject({ units: 3, fee: '150000.00' });
  });
});
