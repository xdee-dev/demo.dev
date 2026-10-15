import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { withPlatform } from '../db/tenant.js';
import { companies, companyMemberships, users, auditLogs } from '../db/schema.js';
import { body, parse, zOptText, zText, zUuid, query, listQuery, paged } from '../lib/http.js';
import { slugify } from '../lib/normalize.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { bootstrapCompany } from '../services/company.js';
import { addMember } from '../services/membership.js';

/**
 * Super Admin: manages tenants and memberships only. It deliberately has NO endpoint that reads
 * a company's customers, rentals or finances — a super admin must be invited into a company
 * (membership) to see its operational data, like any other user.
 */
export const adminRouter = Router();

adminRouter.get('/companies', async (_req, res) => {
  const rows = await db.select({
    id: companies.id, name: companies.name, slug: companies.slug, email: companies.email, phone: companies.phone,
    isActive: companies.isActive, createdAt: companies.createdAt,
    members: sql<number>`(select count(*)::int from company_memberships m where m.company_id = ${companies.id} and m.status = 'ACTIVE')`,
  }).from(companies).orderBy(asc(companies.name));
  res.json(rows);
});

adminRouter.post('/companies', async (req, res) => {
  const input = body(req, z.object({
    name: zText(150).min(2), slug: z.string().trim().max(60).optional(), email: zOptText(200), phone: zOptText(40), address: zOptText(500),
    ownerEmail: z.string().trim().toLowerCase().email('Email owner tidak valid'), ownerName: zText(100).min(2),
  }));
  const base = slugify(input.slug || input.name) || 'perusahaan';
  const result = await withPlatform(async (tx) => {
    // The slug is internal: make it unique automatically (pt-rpms, pt-rpms-2, …) instead of failing.
    const taken = new Set((await tx.execute<{ slug: string }>(sql`select slug from companies where slug = ${base} or slug like ${base + '-%'}`)).rows.map((r) => r.slug));
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    const [company] = await tx.insert(companies).values({ name: input.name, slug, email: input.email, phone: input.phone, address: input.address }).returning();
    await audit(tx, req, { action: 'company.create', entityType: 'company', entityId: company.id, summary: company.name }, null);
    await bootstrapCompany(tx, company.id, req.user!.id);
    const owner = await addMember(tx, req, company.id, input.ownerEmail, input.ownerName, 'OWNER');
    return { company, owner };
  });
  res.status(201).json(result);
});

adminRouter.patch('/companies/:id', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, z.object({ isActive: z.boolean().optional(), name: zText(150).min(2).optional() }));
  const row = await withPlatform(async (tx) => {
    const before = await tx.query.companies.findFirst({ where: eq(companies.id, id) });
    if (!before) throw notFound('Perusahaan');
    const [after] = await tx.update(companies).set(input).where(eq(companies.id, id)).returning();
    await audit(tx, req, { action: input.isActive === false ? 'company.deactivate' : input.isActive ? 'company.activate' : 'company.update', entityType: 'company', entityId: id,
      before: { isActive: before.isActive, name: before.name }, after: input }, null);
    return after;
  });
  res.json(row);
});

adminRouter.get('/companies/:id/members', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const rows = await db.select({
    id: companyMemberships.id, role: companyMemberships.role, status: companyMemberships.status,
    userId: users.id, email: users.email, name: users.name, lastLoginAt: users.lastLoginAt,
  }).from(companyMemberships).innerJoin(users, eq(users.id, companyMemberships.userId))
    .where(eq(companyMemberships.companyId, id)).orderBy(asc(users.name));
  res.json(rows);
});

adminRouter.post('/companies/:id/members', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, z.object({ email: z.string().trim().toLowerCase().email(), name: zText(100).min(2), role: z.enum(['OWNER', 'ADMIN', 'FINANCE', 'OPERATOR', 'VIEWER']) }));
  const exists = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!exists) throw notFound('Perusahaan');
  const result = await withPlatform(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${id}, true)`); // audit row belongs to that company
    return addMember(tx, req, id, input.email, input.name, input.role);
  });
  res.status(201).json(result);
});

adminRouter.patch('/memberships/:id', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, z.object({ role: z.enum(['OWNER', 'ADMIN', 'FINANCE', 'OPERATOR', 'VIEWER']).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }));
  const row = await withPlatform(async (tx) => {
    const m = await tx.query.companyMemberships.findFirst({ where: eq(companyMemberships.id, id) });
    if (!m) throw notFound('Keanggotaan');
    const [after] = await tx.update(companyMemberships).set(input).where(eq(companyMemberships.id, id)).returning();
    await audit(tx, req, { action: 'membership.admin_update', entityType: 'membership', entityId: id, before: { role: m.role, status: m.status }, after: input }, null);
    return after;
  });
  res.json(row);
});

adminRouter.get('/users', async (req, res) => {
  const q = query(req, listQuery);
  const where = q.q ? sql`(${users.email} ilike ${'%' + q.q + '%'} or ${users.name} ilike ${'%' + q.q + '%'})` : undefined;
  const [{ n }] = await db.select({ n: count() }).from(users).where(where);
  const rows = await db.select({
    id: users.id, email: users.email, name: users.name, isSuperAdmin: users.isSuperAdmin, isActive: users.isActive, lastLoginAt: users.lastLoginAt,
    companies: sql<number>`(select count(*)::int from company_memberships m where m.user_id = ${users.id} and m.status='ACTIVE')`,
  }).from(users).where(where).orderBy(asc(users.email)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  res.json(paged(rows, n, q));
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, z.object({ isActive: z.boolean().optional(), isSuperAdmin: z.boolean().optional() }));
  if (id === req.user!.id) throw badRequest('Tidak dapat mengubah akun sendiri');
  const row = await withPlatform(async (tx) => {
    const [u] = await tx.update(users).set(input).where(eq(users.id, id)).returning({ id: users.id, email: users.email, isActive: users.isActive, isSuperAdmin: users.isSuperAdmin });
    if (!u) throw notFound('Pengguna');
    if (input.isActive === false) await tx.execute(sql`delete from sessions where user_id = ${id}`);
    await audit(tx, req, { action: 'user.admin_update', entityType: 'user', entityId: id, after: input }, null);
    return u;
  });
  res.json(row);
});

adminRouter.get('/audit-logs', async (req, res) => {
  const q = query(req, listQuery);
  const result = await withPlatform(async (tx) => {
    const where = sql`${auditLogs.companyId} is null`;
    const [{ n }] = await tx.select({ n: count() }).from(auditLogs).where(where);
    const rows = await tx.select({ id: auditLogs.id, action: auditLogs.action, summary: auditLogs.summary, entityType: auditLogs.entityType, entityId: auditLogs.entityId,
      ip: auditLogs.ip, createdAt: auditLogs.createdAt, userEmail: users.email })
      .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId)).where(where).orderBy(desc(auditLogs.id))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    return paged(rows, n, q);
  });
  res.json(result);
});

void and;
