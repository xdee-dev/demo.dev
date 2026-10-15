/** Indonesian phone numbers → +62xxxxxxxxx. Other international numbers keep their +CC. */
export function normalizePhone(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (/[^\d+\s().-]/.test(trimmed)) return null;
  let digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.indexOf('+') > 0) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  else if (digits.startsWith('8')) digits = '62' + digits;
  if (!/^\d{9,15}$/.test(digits)) return null;
  if (digits.startsWith('62') && !/^62\d{8,13}$/.test(digits)) return null;
  return '+' + digits;
}

/** 'b 1234 xyz' → 'B1234XYZ' (used for uniqueness), and a pretty form 'B 1234 XYZ'. */
export function normalizePlate(raw: string): { normalized: string; display: string } | null {
  const compact = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = compact.match(/^([A-Z]{1,2})(\d{1,4})([A-Z]{0,3})$/);
  if (!m) {
    if (compact.length < 3 || compact.length > 12) return null;
    return { normalized: compact, display: String(raw).toUpperCase().trim().replace(/\s+/g, ' ') };
  }
  return { normalized: compact, display: [m[1], m[2], m[3]].filter(Boolean).join(' ') };
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60);
}

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
