import type { Request } from 'express';
import { z, type ZodType } from 'zod';
import { badRequest, zodToDetails } from './errors.js';
import { normalizeMoneyString, D } from './money.js';
import { isoDate } from './dates.js';

export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Data tidak valid', zodToDetails(r.error));
  return r.data;
}

export const body = <T extends ZodType>(req: Request, schema: T) => parse(schema, req.body);
export const query = <T extends ZodType>(req: Request, schema: T) => parse(schema, req.query);

/* ---- reusable zod pieces ---- */

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const zText = (max = 500) => z.string().trim().max(max);
export const zOptText = (max = 500) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());
export const zUuid = z.uuid({ message: 'ID tidak valid' });
export const zOptUuid = z.preprocess(emptyToNull, z.uuid().nullable().optional());
export const zDate = z.string().regex(isoDate, 'Format tanggal YYYY-MM-DD');
export const zOptDate = z.preprocess(emptyToNull, zDate.nullable().optional());
export const zDateTime = z.coerce.date({ message: 'Tanggal/waktu tidak valid' });
export const zOptDateTime = z.preprocess(emptyToNull, z.coerce.date().nullable().optional());

/** Money accepted as number or string (machine or Indonesian format). Output: canonical '1234.50'. */
export const zMoney = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    const d = D(typeof v === 'string' ? normalizeMoneyString(v) : v);
    if (d.isNegative()) { ctx.addIssue({ code: 'custom', message: 'Nominal tidak boleh negatif' }); return z.NEVER; }
    if (d.decimalPlaces() > 2) { ctx.addIssue({ code: 'custom', message: 'Maksimal 2 angka desimal' }); return z.NEVER; }
    if (d.gt('9999999999999999')) { ctx.addIssue({ code: 'custom', message: 'Nominal terlalu besar' }); return z.NEVER; }
    return d.toFixed(2);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Nominal tidak valid' });
    return z.NEVER;
  }
});
export const zOptMoney = z.preprocess(emptyToNull, zMoney.nullable().optional());

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListQuery = z.infer<typeof listQuery>;

export const paged = <T>(rows: T[], total: number, q: ListQuery) => ({
  data: rows, page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
});

/** Escape LIKE wildcards in user search terms. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

export const idempotencyKey = (req: Request): string | null => {
  const k = req.get('idempotency-key');
  if (!k) return null;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(k)) throw badRequest('Idempotency-Key tidak valid');
  return k;
};
