import type { NextFunction, Request, Response } from 'express';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { companies, companyMemberships, sessions, users } from '../db/schema.js';
import { withTenant } from '../db/tenant.js';
import { forbidden, unauthorized, badRequest } from '../lib/errors.js';
import { isUuid } from '../lib/normalize.js';
import { sha256 } from './password.js';
import { ALL_PERMISSIONS, type Permission, type Role } from './permissions.js';
import { config } from '../config.js';

export const SESSION_COOKIE = 'rms_sid';

/** Resolves the session cookie (if any) into req.user / req.session. Never throws for anonymous requests. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 20) return next();
  const rows = await db
    .select({
      sessionId: sessions.id, csrfToken: sessions.csrfToken, lastSeenAt: sessions.lastSeenAt,
      userId: users.id, email: users.email, name: users.name, isSuperAdmin: users.isSuperAdmin, isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  const s = rows[0];
  if (s && s.isActive) {
    req.user = { id: s.userId, email: s.email, name: s.name, isSuperAdmin: s.isSuperAdmin };
    req.session = { id: s.sessionId, csrfToken: s.csrfToken };
    // Sliding expiration, throttled to one write per 5 minutes.
    if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) {
      await db.update(sessions)
        .set({ lastSeenAt: sql`now()`, expiresAt: sql`now() + make_interval(hours => ${config.sessionTtlHours})` })
        .where(eq(sessions.id, s.sessionId));
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  next();
}

/**
 * CSRF protection (synchronizer token): every state-changing request from a logged-in browser
 * must echo the per-session token in the X-CSRF-Token header. Cookies are SameSite=Lax as well.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.session) return next();
  const header = req.get('x-csrf-token');
  if (!header || header !== req.session.csrfToken) throw forbidden('Token CSRF tidak valid. Muat ulang halaman.');
  next();
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  if (!req.user.isSuperAdmin) throw forbidden('Hanya Super Admin');
  next();
}

/**
 * Resolves the active company from the X-Company-Id header and verifies — on the server, on
 * every request — that the authenticated user is an active member of that active company.
 */
export async function requireCompany(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  const companyId = req.get('x-company-id');
  if (!companyId) throw badRequest('Perusahaan aktif belum dipilih');
  if (!isUuid(companyId)) throw forbidden('Akses perusahaan ditolak');

  const rows = await db
    .select({ role: companyMemberships.role, status: companyMemberships.status, active: companies.isActive, tz: companies.timezone, name: companies.name })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, req.user.id)))
    .limit(1);
  const m = rows[0];
  if (!m || m.status !== 'ACTIVE') throw forbidden('Anda bukan anggota perusahaan ini');
  if (!m.active) throw forbidden('Perusahaan ini sedang dinonaktifkan');

  const role = m.role as Role;
  let permissions: Set<Permission>;
  if (role === 'OWNER') {
    permissions = new Set(ALL_PERMISSIONS); // owners can never lock themselves out
  } else {
    const perms = await withTenant(companyId, (tx) =>
      tx.execute<{ permission: string }>(sql`select permission from role_permissions where company_id = ${companyId} and role = ${role}`));
    permissions = new Set(perms.rows.map((r) => r.permission as Permission));
  }
  req.ctx = { companyId, role, permissions, timezone: m.tz, companyName: m.name };
  next();
}

/** Route guard: the active membership must hold *all* listed permissions. */
export const perm = (...needed: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.ctx) throw forbidden();
  for (const p of needed) if (!req.ctx.permissions.has(p)) throw forbidden();
  next();
};

/** Route guard: the active membership must hold *any* of the listed permissions. */
export const anyPerm = (...needed: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.ctx || !needed.some((p) => req.ctx!.permissions.has(p))) throw forbidden();
  next();
};

export const can = (req: Request, p: Permission) => !!req.ctx?.permissions.has(p);
