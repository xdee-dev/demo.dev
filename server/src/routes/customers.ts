import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql, isNull, isNotNull } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import type { Tx } from '../db/client.js';
import { customers } from '../db/schema.js';
import { perm } from '../auth/middleware.js';
import { body, parse, query, listQuery, paged, zOptText, zText, zUuid, likeTerm } from '../lib/http.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { normalizePhone } from '../lib/normalize.js';
import { nextNumber } from '../lib/numbering.js';
import { getSettings } from '../lib/settings.js';

export const customersRouter = Router();

export const customerInput = z.object({
  type: z.enum(['INDIVIDUAL', 'COMPANY']).default('INDIVIDUAL'),
  name: zText(150).min(2, 'Nama wajib diisi (min. 2 karakter)'),
  contactPerson: zOptText(100),
  phone: zText(30).min(6, 'Nomor telepon wajib diisi'),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().toLowerCase().email('Email tidak valid').max(200).nullable().optional()),
  address: zOptText(500),
  idType: z.preprocess((v) => (v === '' ? null : v), z.enum(['KTP', 'SIM', 'PASPOR', 'NPWP', 'LAINNYA']).nullable().optional()),
  idNumber: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(40).regex(/^[A-Za-z0-9.\-/ ]+$/, 'Nomor identitas tidak valid').nullable().optional()),
  notes: zOptText(2000),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLACKLISTED']).default('ACTIVE'),
});
export type CustomerInput = z.infer<typeof customerInput>;

export function prepareCustomer(input: CustomerInput) {
  const phoneNormalized = normalizePhone(input.phone);
  if (!phoneNormalized) throw badRequest('Nomor telepon tidak valid', { fields: { phone: 'Nomor telepon tidak valid (contoh: 0812-3456-7890)' } });
  return { ...input, phoneNormalized, idNumber: input.idNumber ? input.idNumber.replace(/\s+/g, '') : input.idNumber };
}

/** Possible duplicates: same phone, same ID number, or same name (case-insensitive). */
export async function findDuplicateCustomers(tx: Tx, companyId: string, c: { name: string; phoneNormalized: string; idNumber?: string | null }, excludeId?: string) {
  const res = await tx.execute<{ id: string; code: string; name: string; phone: string; id_number: string | null; reason: string }>(sql`
    select id, code, name, phone, id_number,
      case when phone_normalized = ${c.phoneNormalized} then 'phone'
           when ${c.idNumber ?? null}::text is not null and id_number = ${c.idNumber ?? null} then 'idNumber'
           else 'name' end as reason
    from customers
    where company_id = ${companyId} and archived_at is null
      ${excludeId ? sql`and id <> ${excludeId}` : sql``}
      and (phone_normalized = ${c.phoneNormalized}
           or (${c.idNumber ?? null}::text is not null and id_number = ${c.idNumber ?? null})
           or lower(name) = lower(${c.name}))
    limit 5`);
  return res.rows;
}

customersRouter.get('/customers', perm('customer.view'), async (req, res) => {
  const q = query(req, listQuery.extend({
    status: z.enum(['ACTIVE', 'INACTIVE', 'BLACKLISTED']).optional(),
    type: z.enum(['INDIVIDUAL', 'COMPANY']).optional(),
    archived: z.enum(['true', 'false']).default('false'),
    hasReceivable: z.enum(['true']).optional(),
  }));
  const { companyId } = req.ctx!;
  const sortCols: Record<string, string> = { name: 'c.name', code: 'c.code', createdAt: 'c.created_at', receivable: 'receivable', totalBilled: 'total_billed' };
  const sortCol = sortCols[q.sort ?? ''] ?? 'c.created_at';
  const result = await withTenant(companyId, async (tx) => {
    const where = sql`c.company_id = ${companyId}
      ${q.archived === 'true' ? sql`and c.archived_at is not null` : sql`and c.archived_at is null`}
      ${q.status ? sql`and c.status = ${q.status}` : sql``}
      ${q.type ? sql`and c.type = ${q.type}` : sql``}
      ${q.q ? sql`and (c.name ilike ${likeTerm(q.q)} or c.code ilike ${likeTerm(q.q)} or c.phone ilike ${likeTerm(q.q)} or c.phone_normalized ilike ${likeTerm(q.q.replace(/^0/, ''))} or c.email ilike ${likeTerm(q.q)} or c.id_number ilike ${likeTerm(q.q)})` : sql``}`;
    const base = sql`
      from customers c
      left join lateral (
        select coalesce(sum(b.amount_due),0) as total_billed, coalesce(sum(b.paid),0) as total_paid,
               coalesce(sum(greatest(b.balance,0)),0) as receivable, count(*) as rentals
        from rental_transactions t join rental_balances b on b.rental_id = t.id
        where t.customer_id = c.id
      ) agg on true
      where ${where} ${q.hasReceivable ? sql`and agg.receivable > 0` : sql``}`;
    const total = await tx.execute<{ n: number }>(sql`select count(*)::int as n ${base}`);
    const rows = await tx.execute(sql`
      select c.id, c.code, c.type, c.name, c.contact_person as "contactPerson", c.phone, c.email, c.address, c.status,
             c.id_type as "idType", c.id_number as "idNumber", c.archived_at as "archivedAt", c.created_at as "createdAt",
             agg.total_billed as "totalBilled", agg.total_paid as "totalPaid", agg.receivable, agg.rentals::int as "rentalCount"
      ${base}
      order by ${sql.raw(sortCol)} ${sql.raw(q.dir)} nulls last, c.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return paged(rows.rows, total.rows[0].n, q);
  });
  res.json(result);
});

/** Lightweight search for comboboxes in reservation/rental forms. */
customersRouter.get('/customers/lookup', perm('customer.view'), async (req, res) => {
  const q = query(req, z.object({ q: z.string().trim().max(100).optional(), id: z.uuid().optional() }));
  const { companyId } = req.ctx!;
  const rows = await withTenant(companyId, (tx) => tx.execute(sql`
    select id, code, name, type, phone, email, address, status, id_type as "idType", id_number as "idNumber", contact_person as "contactPerson"
    from customers
    where company_id = ${companyId} and archived_at is null
      ${q.id ? sql`and id = ${q.id}` : sql``}
      ${q.q ? sql`and (name ilike ${likeTerm(q.q)} or code ilike ${likeTerm(q.q)} or phone ilike ${likeTerm(q.q)})` : sql``}
    order by (status = 'ACTIVE') desc, name limit 20`));
  res.json(rows.rows);
});

customersRouter.get('/customers/:id', perm('customer.view'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const customer = await tx.query.customers.findFirst({ where: and(eq(customers.id, id), eq(customers.companyId, companyId)) });
    if (!customer) throw notFound('Customer');
    const stats = await tx.execute(sql`
      select count(*)::int as "rentalCount", coalesce(sum(b.amount_due),0) as "totalBilled", coalesce(sum(b.paid),0) as "totalPaid",
             coalesce(sum(greatest(b.balance,0)),0) as receivable
      from rental_transactions t join rental_balances b on b.rental_id = t.id where t.customer_id = ${id}`);
    const rentals = await tx.execute(sql`
      select t.id, t.number, t.start_at as "startAt", t.end_at as "endAt", t.status, t.total, b.paid, b.balance, b.payment_status as "paymentStatus",
             t.vehicle_snapshot->>'plateNumber' as "plateNumber", (t.vehicle_snapshot->>'brand') || ' ' || (t.vehicle_snapshot->>'model') as "vehicleName"
      from rental_transactions t join rental_balances b on b.rental_id = t.id
      where t.customer_id = ${id} order by t.start_at desc limit 50`);
    const reservations = await tx.execute(sql`
      select id, number, start_at as "startAt", end_at as "endAt", status, total, vehicle_snapshot->>'plateNumber' as "plateNumber"
      from reservations where customer_id = ${id} and status not in ('ACTIVE','COMPLETED') order by start_at desc limit 20`);
    return { customer, stats: stats.rows[0], rentals: rentals.rows, reservations: reservations.rows };
  });
  res.json(data);
});

customersRouter.post('/customers/check-duplicates', perm('customer.view'), async (req, res) => {
  const input = body(req, z.object({ name: z.string().max(150).default(''), phone: z.string().max(30).default(''), idNumber: z.string().max(40).optional(), excludeId: z.uuid().optional() }));
  const phoneNormalized = normalizePhone(input.phone) ?? '__none__';
  const rows = await withTenant(req.ctx!.companyId, (tx) => findDuplicateCustomers(tx, req.ctx!.companyId, { name: input.name, phoneNormalized, idNumber: input.idNumber?.replace(/\s+/g, '') || null }, input.excludeId));
  res.json(rows);
});

customersRouter.post('/customers', perm('customer.manage'), async (req, res) => {
  const raw = body(req, customerInput.extend({ confirmDuplicate: z.boolean().default(false) }));
  const { confirmDuplicate, ...rest } = raw;
  const input = prepareCustomer(rest);
  const { companyId, timezone } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    if (!confirmDuplicate) {
      const dups = await findDuplicateCustomers(tx, companyId, input);
      if (dups.length) throw conflict('Kemungkinan customer duplikat ditemukan. Konfirmasi untuk tetap menyimpan.', { duplicates: dups }, 'DUPLICATE_CANDIDATE');
    }
    const settings = await getSettings(tx, companyId);
    const code = await nextNumber(tx, companyId, 'CUSTOMER', settings, timezone);
    const [c] = await tx.insert(customers).values({ ...input, companyId, code, createdBy: req.user!.id, updatedBy: req.user!.id }).returning();
    await audit(tx, req, { action: 'customer.create', entityType: 'customer', entityId: c.id, summary: `${c.code} ${c.name}` });
    return c;
  });
  res.status(201).json(row);
});

customersRouter.put('/customers/:id', perm('customer.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const raw = body(req, customerInput.extend({ confirmDuplicate: z.boolean().default(false) }));
  const { confirmDuplicate, ...rest } = raw;
  const input = prepareCustomer(rest);
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.customers.findFirst({ where: and(eq(customers.id, id), eq(customers.companyId, companyId)) });
    if (!before) throw notFound('Customer');
    if (!confirmDuplicate && (before.phoneNormalized !== input.phoneNormalized || before.name.toLowerCase() !== input.name.toLowerCase() || before.idNumber !== input.idNumber)) {
      const dups = await findDuplicateCustomers(tx, companyId, input, id);
      if (dups.length) throw conflict('Kemungkinan customer duplikat ditemukan. Konfirmasi untuk tetap menyimpan.', { duplicates: dups }, 'DUPLICATE_CANDIDATE');
    }
    const [c] = await tx.update(customers).set({ ...input, updatedBy: req.user!.id }).where(eq(customers.id, id)).returning();
    const d = diff(before as Record<string, unknown>, input);
    if (d.changed) await audit(tx, req, { action: 'customer.update', entityType: 'customer', entityId: id, summary: c.name, before: d.before, after: d.after });
    return c;
  });
  res.json(row);
});

customersRouter.post('/customers/:id/archive', perm('customer.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  await withTenant(companyId, async (tx) => {
    const open = await tx.execute(sql`select 1 from rental_transactions where customer_id = ${id} and status in ('SCHEDULED','ONGOING','RETURNED')
      union all select 1 from reservations where customer_id = ${id} and status in ('DRAFT','PENDING','CONFIRMED') limit 1`);
    if (open.rows.length) throw badRequest('Customer masih memiliki reservasi/transaksi yang berjalan');
    const [c] = await tx.update(customers).set({ archivedAt: sql`now()`, updatedBy: req.user!.id })
      .where(and(eq(customers.id, id), eq(customers.companyId, companyId), isNull(customers.archivedAt))).returning();
    if (!c) throw notFound('Customer');
    await audit(tx, req, { action: 'customer.archive', entityType: 'customer', entityId: id, summary: c.name });
  });
  res.json({ ok: true });
});

customersRouter.post('/customers/:id/restore', perm('customer.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  await withTenant(companyId, async (tx) => {
    const [c] = await tx.update(customers).set({ archivedAt: null, updatedBy: req.user!.id })
      .where(and(eq(customers.id, id), eq(customers.companyId, companyId), isNotNull(customers.archivedAt))).returning();
    if (!c) throw notFound('Customer');
    await audit(tx, req, { action: 'customer.restore', entityType: 'customer', entityId: id, summary: c.name });
  });
  res.json({ ok: true });
});
