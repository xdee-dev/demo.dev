import { describe, it, expect } from 'vitest';
import { normalizePhone, normalizePlate } from '../../src/lib/normalize.js';
import { renderNumber } from '../../src/lib/numbering.js';

describe('normalization', () => {
  it('normalizes Indonesian phone numbers', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('+6281234567890');
    expect(normalizePhone('+62 812 3456 7890')).toBe('+6281234567890');
    expect(normalizePhone('6281234567890')).toBe('+6281234567890');
    expect(normalizePhone('021-5550-1234')).toBe('+622155501234');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('0812abc')).toBeNull();
  });
  it('normalizes plate numbers for uniqueness', () => {
    expect(normalizePlate('b 1234 xyz')).toEqual({ normalized: 'B1234XYZ', display: 'B 1234 XYZ' });
    expect(normalizePlate('B1234XYZ')).toEqual({ normalized: 'B1234XYZ', display: 'B 1234 XYZ' });
    expect(normalizePlate('AB 12 C')?.display).toBe('AB 12 C');
    expect(normalizePlate('!')).toBeNull();
  });
  it('renders document numbers', () => {
    expect(renderNumber('{PREFIX}/{YYYY}/{MM}/{SEQ}', { prefix: 'INV', pad: 4, seq: 7, year: '2026', month: '03', day: '01' })).toBe('INV/2026/03/0007');
  });
});
