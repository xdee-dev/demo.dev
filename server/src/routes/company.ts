import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, sql, ne } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import { cashAccounts, companies, companyMemberships, expenseCategories, rolePermissions, users, auditLogs } from '../db/schema.js';
import { perm, anyPerm } from '../auth/middleware.js';
import { ALL_PERMISSIONS, PERMISSIONS, ROLES, ROLE_LABELS, DEFAULT_ROLE_PERMISSIONS, type Permission, type Role } from '../auth/permissions.js';
import { body, parse, query, listQuery, paged, zOptText, zText, zMoney, zUuid, zDate, zOptDate } from '../lib/http.js';
import { audit, diff } from '../lib/audit.js';
import { getSettings, saveSettings, settingsSchema, parseSettings } from '../lib/settings.js';
import { badRequest, forbidden, notFound, conflict } from '../lib/errors.js';
import { isValidTimeZone } from '../lib/dates.js';
import { addMember } from '../services/membership.js';
import { issuePasswordToken } from './auth.js';
import { sendMail, mailEnabled } from '../lib/mailer.js';
import { config } from '../config.js';
import { db } from '../db/client.js';

export const companyRouter = Router();

/* ------------------------------------------------------ active company */

companyRouter.get('/company', async (req, res) => {
  const { companyId, role, permissions } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const company = await tx.query.companies.findFirst({ where: eq(companies.id, companyId) });
    const settings = await getSettings(tx, companyId);
    return { company, settings };
  });
  res.json({ ...data, role, permissions: [...permissions] });
});

const profileSchema = z.object({
  name: zText(150).min(2, 'Nama perusahaan wajib diisi'),
  address: zOptText(500),
  city: zOptText(100),
  phone: zOptText(40),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().email('Email tidak valid').max(200).nullable().optional()),
  website: zOptText(200),
  npwp: zOptText(40),
  bankAccounts: z.array(z.object({ bank: zText(60).min(1), accountNumber: zText(40).min(3), accountHolder: zText(100).min(1) })).max(10).default([]),
  logoFileId: z.uuid().nullable().optional(),
  timezone: z.string().refine(isValidTimeZone, 'Zona waktu tidak valid').default('Asia/Jakarta'),
});

companyRouter.put('/company/profile', perm('settings.manage'), async (req, res) => {
  const input = body(req, profileSchema);
  const { companyId } = req.ctx!;
  const company = await withTenant(companyId, async (tx) => {
    if (input.logoFileId) {
      const f = await tx.execute(sql`select 1 from file_attachments where id = ${input.logoFileId} and company_id = ${companyId} and kind = 'COMPANY_LOGO'`);
      if (!f.rows.length) throw badRequest('File logo tidak valid');
    }
    const before = await tx.query.companies.findFirst({ where: eq(companies.id, companyId) });
    const [after] = await tx.update(companies).set(input).where(eq(companies.id, companyId)).returning();
    const d = diff(before as Record<string, unknown>, input);
    if (d.changed) await audit(tx, req, { action: 'company.profile_update', entityType: 'company', entityId: companyId, before: d.before, after: d.after });
    return after;
  });
  res.json(company);
});

companyRouter.put('/company/settings', perm('settings.manage'), async (req, res) => {
  const input = parse(settingsSchema, req.body);
  const { companyId } = req.ctx!;
  const settings = parseSettings(input);
  await withTenant(companyId, async (tx) => {
    const before = await getSettings(tx, companyId);
    await saveSettings(tx, companyId, settings, req.user!.id);
    const d = diff(before as unknown as Record<string, unknown>, settings as unknown as Record<string, unknown>);
    if (d.changed) await audit(tx, req, { action: 'settings.update', entityType: 'company_settings', entityId: companyId, before: d.before, after: d.after });
  });
  res.json(settings);
});

/* ------------------------------------------------------------- members */

companyRouter.get('/company/members', perm('users.manage'), async (req, res) => {
  const rows = await db.select({
    id: companyMemberships.id, role: companyMemberships.role, status: companyMemberships.status, createdAt: companyMemberships.createdAt,
    userId: users.id, email: users.email, name: users.name, lastLoginAt: users.lastLoginAt, hasPassword: sql<boolean>`${users.passwordHash} is not null`,
  }).from(companyMemberships).innerJoin(users, eq(users.id, companyMemberships.userId))
    .where(eq(companyMemberships.companyId, req.ctx!.companyId)).orderBy(asc(users.name));
  res.json(rows);
});

const roleSchema = z.enum(['OWNER', 'ADMIN', 'FINANCE', 'OPERATOR', 'VIEWER']);

companyRouter.post('/company/members', perm('users.manage'), async (req, res) => {
  const input = body(req, z.object({ email: z.string().trim().toLowerCase().email('Email tidak valid').max(200), name: zText(100).min(2), role: roleSchema }));
  if (input.role === 'OWNER' && req.ctx!.role !== 'OWNER') throw forbidden('Hanya Owner yang dapat menambah Owner');
  const result = await withTenant(req.ctx!.companyId, (tx) => addMember(tx, req, req.ctx!.companyId, input.email, input.name, input.role));
  res.status(201).json(result);
});

companyRouter.patch('/company/members/:id', perm('users.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, z.object({ role: roleSchema.optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }));
  const { companyId } = req.ctx!;
  const updated = await withTenant(companyId, async (tx) => {
    const m = await tx.query.companyMemberships.findFirst({ where: and(eq(companyMemberships.id, id), eq(companyMemberships.companyId, companyId)) });
    if (!m) throw notFound('Anggota');
    if (m.userId === req.user!.id) throw badRequest('Anda tidak dapat mengubah role/status akun Anda sendiri');
    if ((m.role === 'OWNER' || input.role === 'OWNER') && req.ctx!.role !== 'OWNER') throw forbidden('Hanya Owner yang dapat mengubah Owner');
    if (m.role === 'OWNER' && (input.role && input.role !== 'OWNER' || input.status === 'DISABLED')) {
      const [{ n }] = await tx.select({ n: count() }).from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.role, 'OWNER'), eq(companyMemberships.status, 'ACTIVE'), ne(companyMemberships.id, id)));
      if (n === 0) throw badRequest('Perusahaan harus memiliki minimal satu Owner aktif');
    }
    const [after] = await tx.update(companyMemberships).set(input).where(eq(companyMemberships.id, id)).returning();
    await audit(tx, req, { action: 'membership.update', entityType: 'membership', entityId: id, before: { role: m.role, status: m.status }, after: input });
    return after;
  });
  res.json(updated);
});

companyRouter.post('/company/members/:id/resend-invite', perm('users.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const rows = await db.select({ userId: users.id, email: users.email, name: users.name, hasPw: sql<boolean>`${users.passwordHash} is not null` })
    .from(companyMemberships).innerJoin(users, eq(users.id, companyMemberships.userId))
    .where(and(eq(companyMemberships.id, id), eq(companyMemberships.companyId, req.ctx!.companyId)));
  const u = rows[0];
  if (!u) throw notFound('Anggota');
  if (u.hasPw) throw badRequest('Pengguna sudah mengaktifkan akunnya');
  const token = await issuePasswordToken(u.userId, 'INVITE');
  const link = `${config.appUrl}/accept-invite?token=${token}`;
  await sendMail(u.email, `Undangan bergabung — ${req.ctx!.companyName}`, `Halo ${u.name},\n\nBuat password Anda: ${link}`);
  res.json({ ok: true, inviteLink: mailEnabled() ? null : link });
});

/* ---------------------------------------------------- role permissions */

companyRouter.get('/company/roles', perm('users.manage'), async (req, res) => {
  const rows = await withTenant(req.ctx!.companyId, (tx) => tx.select().from(rolePermissions).where(eq(rolePermissions.companyId, req.ctx!.companyId)));
  const matrix = Object.fromEntries(ROLES.map((r) => [r, r === 'OWNER' ? ALL_PERMISSIONS : rows.filter((x) => x.role === r).map((x) => x.permission)]));
  res.json({ roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] })), permissions: PERMISSIONS, matrix, defaults: DEFAULT_ROLE_PERMISSIONS });
});

companyRouter.put('/company/roles/:role', perm('users.manage'), async (req, res) => {
  const role = parse(roleSchema, req.params.role) as Role;
  if (role === 'OWNER') throw badRequest('Izin Owner tidak dapat diubah');
  const { permissions } = body(req, z.object({ permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])) }));
  const { companyId } = req.ctx!;
  await withTenant(companyId, async (tx) => {
    const before = (await tx.select().from(rolePermissions).where(and(eq(rolePermissions.companyId, companyId), eq(rolePermissions.role, role)))).map((r) => r.permission);
    await tx.delete(rolePermissions).where(and(eq(rolePermissions.companyId, companyId), eq(rolePermissions.role, role)));
    const unique = [...new Set(permissions)];
    if (unique.length) await tx.insert(rolePermissions).values(unique.map((permission) => ({ companyId, role, permission })));
    await audit(tx, req, { action: 'role.permissions_update', entityType: 'role', entityId: role, before, after: unique });
  });
  res.json({ ok: true });
});

/* --------------------------------------------------------- cash accounts */

const cashAccountSchema = z.object({
  name: zText(80).min(2), type: z.enum(['CASH', 'BANK', 'EWALLET']), bankName: zOptText(60), accountNumber: zOptText(40),
  accountHolder: zOptText(100), openingBalance: zMoney.default('0'), isActive: z.boolean().default(true),
});

companyRouter.get('/cash-accounts', async (req, res) => {
  const rows = await withTenant(req.ctx!.companyId, (tx) => tx.select().from(cashAccounts).where(eq(cashAccounts.companyId, req.ctx!.companyId)).orderBy(asc(cashAccounts.name)));
  res.json(rows);
});
companyRouter.post('/cash-accounts', perm('settings.manage'), async (req, res) => {
  const input = body(req, cashAccountSchema);
  const row = await withTenant(req.ctx!.companyId, async (tx) => {
    const [r] = await tx.insert(cashAccounts).values({ ...input, companyId: req.ctx!.companyId }).returning();
    await audit(tx, req, { action: 'cash_account.create', entityType: 'cash_account', entityId: r.id, after: input });
    return r;
  });
  res.status(201).json(row);
});
companyRouter.put('/cash-accounts/:id', perm('settings.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, cashAccountSchema);
  const row = await withTenant(req.ctx!.companyId, async (tx) => {
    const before = await tx.query.cashAccounts.findFirst({ where: and(eq(cashAccounts.id, id), eq(cashAccounts.companyId, req.ctx!.companyId)) });
    if (!before) throw notFound('Akun kas');
    const [r] = await tx.update(cashAccounts).set(input).where(eq(cashAccounts.id, id)).returning();
    const d = diff(before as Record<string, unknown>, input);
    if (d.changed) await audit(tx, req, { action: 'cash_account.update', entityType: 'cash_account', entityId: id, before: d.before, after: d.after });
    return r;
  });
  res.json(row);
});

/* ---------------------------------------------------- expense categories */

companyRouter.get('/expense-categories', async (req, res) => {
  const rows = await withTenant(req.ctx!.companyId, (tx) => tx.select().from(expenseCategories).where(eq(expenseCategories.companyId, req.ctx!.companyId)).orderBy(asc(expenseCategories.name)));
  res.json(rows);
});
companyRouter.post('/expense-categories', perm('settings.manage'), async (req, res) => {
  const input = body(req, z.object({ code: zText(30).min(2).regex(/^[A-Z0-9_]+$/, 'Kode huruf besar/angka/underscore'), name: zText(80).min(2) }));
  const row = await withTenant(req.ctx!.companyId, async (tx) => {
    const [r] = await tx.insert(expenseCategories).values({ ...input, companyId: req.ctx!.companyId }).returning();
    await audit(tx, req, { action: 'expense_category.create', entityType: 'expense_category', entityId: r.id, after: input });
    return r;
  });
  res.status(201).json(row);
});
companyRouter.put('/expense-categories/:id', perm('settings.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, z.object({ name: zText(80).min(2), isActive: z.boolean() }));
  const row = await withTenant(req.ctx!.companyId, async (tx) => {
    const [r] = await tx.update(expenseCategories).set(input).where(and(eq(expenseCategories.id, id), eq(expenseCategories.companyId, req.ctx!.companyId))).returning();
    if (!r) throw notFound('Kategori');
    await audit(tx, req, { action: 'expense_category.update', entityType: 'expense_category', entityId: id, after: input });
    return r;
  });
  res.json(row);
});

/* ------------------------------------------------------------ audit log */

companyRouter.get('/audit-logs', perm('audit.view'), async (req, res) => {
  const q = query(req, listQuery.extend({ entityType: z.string().max(40).optional(), entityId: z.string().max(60).optional(), action: z.string().max(60).optional(), from: zOptDate, to: zOptDate }));
  const { companyId, timezone } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    const conds = [eq(auditLogs.companyId, companyId)];
    if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
    if (q.action) conds.push(sql`${auditLogs.action} like ${q.action + '%'}`);
    if (q.from) conds.push(sql`${auditLogs.createdAt} >= (${q.from}::date)::timestamp at time zone ${timezone}`);
    if (q.to) conds.push(sql`${auditLogs.createdAt} < ((${q.to}::date + 1)::timestamp at time zone ${timezone})`);
    if (q.q) conds.push(sql`(${auditLogs.summary} ilike ${'%' + q.q + '%'} or ${auditLogs.action} ilike ${'%' + q.q + '%'})`);
    const where = and(...conds);
    const [{ n }] = await tx.select({ n: count() }).from(auditLogs).where(where);
    const rows = await tx.select({
      id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, summary: auditLogs.summary,
      before: auditLogs.before, after: auditLogs.after, ip: auditLogs.ip, createdAt: auditLogs.createdAt, userName: users.name, userEmail: users.email,
    }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId)).where(where)
      .orderBy(desc(auditLogs.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    return paged(rows, n, q);
  });
  res.json(result);
});

// silence unused-import lint for helpers kept for future use
void zDate; void conflict;
