import { describe, it, expect } from 'vitest';
import { D, formatIDR, normalizeMoneyString, paymentStatus, roundMoney, sum } from '../../src/lib/money.js';

describe('money parsing & formatting (id-ID)', () => {
  it('parses machine and Indonesian formats', () => {
    expect(normalizeMoneyString('1250000')).toBe('1250000');
    expect(normalizeMoneyString('1.250.000')).toBe('1250000');
    expect(normalizeMoneyString('1.250.000,50')).toBe('1250000.50');
    expect(normalizeMoneyString('Rp 25.000')).toBe('25000');
    expect(normalizeMoneyString('1000.5')).toBe('1000.5');
    expect(normalizeMoneyString('1.000')).toBe('1000'); // thousands separator, not 1.0
    expect(() => normalizeMoneyString('12abc')).toThrow();
  });

  it('formats with dot thousands and comma decimals', () => {
    expect(formatIDR('1000')).toBe('Rp 1.000');
    expect(formatIDR('25000')).toBe('Rp 25.000');
    expect(formatIDR('1250000')).toBe('Rp 1.250.000');
    expect(formatIDR('12500000.50')).toBe('Rp 12.500.000,50');
    expect(formatIDR('-75000')).toBe('-Rp 75.000');
    expect(formatIDR('0')).toBe('Rp 0');
    expect(formatIDR('1250000', { symbol: false })).toBe('1.250.000');
  });

  it('never uses floating point arithmetic', () => {
    expect(sum(['0.1', '0.2']).toFixed(2)).toBe('0.30');
    expect(D('1000000000000.10').plus('0.20').toFixed(2)).toBe('1000000000000.30');
    expect(roundMoney('1234.5', 0).toFixed(0)).toBe('1235'); // half-up
    expect(roundMoney('1234.49', 0).toFixed(0)).toBe('1234');
  });
});

describe('payment status is derived from amounts', () => {
  it.each([
    ['1000000', '0', 0, 'UNPAID'],
    ['1000000', '300000', 0, 'DP_PAID'],
    ['1000000', '600000', 1, 'PARTIAL'],
    ['1000000', '1000000', 1, 'PAID'],
    ['1000000', '1200000', 2, 'REFUND_DUE'],
    ['0', '0', 0, 'PAID'],
  ])('due %s paid %s (nonDp %i) → %s', (due, paid, nonDp, expected) => {
    expect(paymentStatus(due, paid, nonDp)).toBe(expected);
  });
});
