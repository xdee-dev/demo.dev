/** Indonesian formatting. Money stays a string end-to-end; formatting never goes through float math. */

export function formatMoney(v: string | number | null | undefined, opts: { symbol?: boolean; decimals?: number } = {}): string {
  if (v === null || v === undefined || v === '') return '—';
  let s = typeof v === 'number' ? v.toFixed(2) : String(v);
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  let [int, frac = ''] = s.split('.');
  int = int.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  if (opts.decimals !== undefined) frac = opts.decimals === 0 ? '' : frac.padEnd(opts.decimals, '0').slice(0, opts.decimals);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = frac ? `${grouped},${frac.padEnd(2, '0').slice(0, 2)}` : grouped;
  const isZero = /^0*$/.test(int) && /^0*$/.test(frac);
  const sign = neg && !isZero ? '-' : '';
  return opts.symbol === false ? sign + body : `${sign}Rp ${body}`;
}

/** Digits typed in a money field ('1.250.000,5') → canonical machine string ('1250000.5'). */
export function parseMoneyInput(text: string): string {
  const cleaned = text.replace(/[^\d,]/g, '');
  const [int, ...rest] = cleaned.split(',');
  const frac = rest.join('').slice(0, 2);
  const i = int.replace(/^0+(?=\d)/, '') || (frac ? '0' : '');
  return frac !== '' || cleaned.endsWith(',') ? `${i || '0'}.${frac}` : i;
}

/** Canonical ('1250000.5') → display while typing ('1.250.000,5'). */
export function moneyInputDisplay(canonical: string): string {
  if (canonical === '') return '';
  const [int, frac] = canonical.split('.');
  const g = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return frac !== undefined ? `${g},${frac}` : g;
}

/* ---- money arithmetic on strings (2 decimals, BigInt cents — no floats) ---- */
export const toCents = (v: string | number | null | undefined): bigint => {
  if (v === null || v === undefined || v === '') return 0n;
  const s = typeof v === 'number' ? v.toFixed(2) : String(v);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const c = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -c : c;
};
export const fromCents = (c: bigint): string => {
  const neg = c < 0n; const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};
export const addMoney = (...vals: (string | number | null | undefined)[]) => fromCents(vals.reduce<bigint>((s, v) => s + toCents(v), 0n));
export const subMoney = (a: string | number, b: string | number) => fromCents(toCents(a) - toCents(b));
export const isPositive = (v: string | null | undefined) => toCents(v) > 0n;

/* ---- dates (company time zone) ---- */
let TZ = 'Asia/Jakarta';
export const setTimeZone = (tz: string) => { TZ = tz; };
export const getTimeZone = () => TZ;

export const toDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
  const d = new Date(v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? null : d;
};

const isDateOnly = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function formatDate(v: string | Date | null | undefined, style: 'short' | 'long' = 'short'): string {
  const d = toDate(v); if (!d) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: isDateOnly(v) ? 'UTC' : TZ, day: '2-digit', month: style === 'long' ? 'long' : 'short', year: 'numeric' }).format(d);
}
export function formatDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v); if (!d) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d).replace('.', ':');
}
export function formatTime(v: string | Date | null | undefined): string {
  const d = toDate(v); if (!d) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d).replace('.', ':');
}

/** Parts of an instant in the company time zone. */
export function zoned(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** 'YYYY-MM-DDTHH:mm' in company time → Date (UTC instant). */
export function fromLocalInput(local: string): Date | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // offset of TZ at that moment (iterate twice for DST edges)
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const z = zoned(new Date(guess));
    const shown = Date.UTC(z.y, z.m - 1, z.d, z.h, z.min);
    guess = guess + (asUtc - shown);
  }
  return new Date(guess);
}
export function toLocalInput(v: string | Date | null | undefined): string {
  const d = toDate(v); if (!d) return '';
  const z = zoned(d);
  return `${z.date}T${z.time}`;
}
export const todayLocal = () => zoned(new Date()).date;
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export const startOfMonth = (date = todayLocal()) => `${date.slice(0, 8)}01`;

export function formatDuration(minutes: number) {
  const d = Math.floor(minutes / 1440); const h = Math.floor((minutes % 1440) / 60); const m = minutes % 60;
  return [d ? `${d} hari` : '', h ? `${h} jam` : '', !d && m ? `${m} menit` : ''].filter(Boolean).join(' ') || '0 menit';
}

export const formatNumber = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : new Intl.NumberFormat('id-ID').format(Number(v));
