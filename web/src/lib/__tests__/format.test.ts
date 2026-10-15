import { describe, it, expect } from 'vitest';
import { formatMoney, parseMoneyInput, moneyInputDisplay, addMoney, subMoney, toCents, fromLocalInput, toLocalInput, setTimeZone } from '../format';
import { terbilang } from '../terbilang';

describe('Indonesian money formatting (client)', () => {
  it('formats with thousands dots and decimal comma', () => {
    expect(formatMoney('1000')).toBe('Rp 1.000');
    expect(formatMoney('25000.00')).toBe('Rp 25.000');
    expect(formatMoney('1250000')).toBe('Rp 1.250.000');
    expect(formatMoney('12500000.50')).toBe('Rp 12.500.000,50');
    expect(formatMoney('-300000.00')).toBe('-Rp 300.000');
    expect(formatMoney(null)).toBe('—');
  });
  it('keeps the numeric value separate from what is displayed while typing', () => {
    expect(parseMoneyInput('1.250.000')).toBe('1250000');
    expect(parseMoneyInput('1.250.000,5')).toBe('1250000.5');
    expect(parseMoneyInput('Rp 25.000')).toBe('25000');
    expect(moneyInputDisplay('1250000.5')).toBe('1.250.000,5');
    expect(moneyInputDisplay('')).toBe('');
  });
  it('adds and subtracts exactly (BigInt cents, no floats)', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(subMoney('825000.00', '300000')).toBe('525000.00');
    expect(toCents('-12.5')).toBe(-1250n);
  });
});

describe('time zone inputs', () => {
  it('converts company local time to UTC and back', () => {
    setTimeZone('Asia/Jakarta');
    expect(fromLocalInput('2026-03-01T09:00')!.toISOString()).toBe('2026-03-01T02:00:00.000Z');
    expect(toLocalInput('2026-03-01T02:00:00.000Z')).toBe('2026-03-01T09:00');
    setTimeZone('Asia/Jayapura');
    expect(fromLocalInput('2026-03-01T09:00')!.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    setTimeZone('Asia/Jakarta');
  });
});

describe('terbilang', () => {
  it.each([
    ['0', 'Nol rupiah'],
    ['1000', 'Seribu rupiah'],
    ['11500', 'Sebelas ribu lima ratus rupiah'],
    ['1250000.00', 'Satu juta dua ratus lima puluh ribu rupiah'],
    ['12500000.50', 'Dua belas juta lima ratus ribu rupiah lima puluh sen'],
    ['100000000', 'Seratus juta rupiah'],
  ])('%s → %s', (n, words) => expect(terbilang(n)).toBe(words));
});
