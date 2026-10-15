import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { and, eq, gt, isNull, sql, asc } from 'drizzle-orm';
import { db, type Executor } from '../db/client.js';
import { companies, companyMemberships, passwordTokens, sessions, users } from '../db/schema.js';
import { withPlatform } from '../db/tenant.js';
import { hashPassword, verifyPassword, passwordPolicyError, randomToken, sha256 } from '../auth/password.js';
import { SESSION_COOKIE, requireAuth } from '../auth/middleware.js';
import { body, query } from '../lib/http.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import { config } from '../config.js';

export const authRouter = Router();

const limiterOpts = { standardHeaders: 'draft-7' as const, legacyHeaders: false, skip: () => config.isTest };
const loginLimiter = rateLimit({
  ...limiterOpts, windowMs: 15 * 60_000, limit: 20,
  message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' } },
});
const sensitiveLimiter = rateLimit({
  ...limiterOpts, windowMs: 15 * 60_000, limit: 10,
  message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan. Coba lagi nanti.' } },
});

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export async function membershipsOf(userId: string) {
  return db
    .select({
      companyId: companies.id, name: companies.name, slug: companies.slug, logoFileId: companies.logoFileId,
      role: companyMemberships.role, companyActive: companies.isActive,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.status, 'ACTIVE')))
    .orderBy(asc(companies.name));
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/', maxAge: config.sessionTtlHours * 3600_000,
  });
}

async function createSession(req: Request, res: Response, userId: string) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  await db.insert(sessions).values({
    tokenHash: sha256(token), csrfToken, userId, ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300),
    expiresAt: sql`now() + make_interval(hours => ${config.sessionTtlHours})`,
  });
  setSessionCookie(res, token);
  return csrfToken;
}

/* ------------------------------------------------------------------ login */

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = body(req, z.object({ email: z.string().trim().toLowerCase().email('Email tidak valid').max(200), password: z.string().min(1).max(200) }));
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const genericFail = new AppError(401, 'INVALID_CREDENTIALS', 'Email atau password salah');

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'LOCKED', `Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi setelah ${LOCK_MINUTES} menit.`);
  }
  const ok = await verifyPassword(user?.passwordHash ?? null, password);
  if (!user || !ok || !user.isActive) {
    if (user) {
      const failed = user.failedLoginCount + 1;
      await withPlatform(async (tx) => {
        await tx.update(users).set({
          failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? sql`now() + interval '${sql.raw(String(LOCK_MINUTES))} minutes'` : null,
        }).where(eq(users.id, user.id));
        await audit(tx, req, { action: 'auth.login_failed', entityType: 'user', entityId: user.id, summary: `Login gagal (${failed})` }, null);
      });
    }
    throw genericFail;
  }

  await withPlatform(async (tx) => {
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` }).where(eq(users.id, user.id));
    await audit(tx, req, { action: 'auth.login', entityType: 'user', entityId: user.id, userId: user.id, summary: 'Login berhasil' }, null);
  });
  // Rotate: drop any pre-existing session cookie value (session fixation defence)
  const csrfToken = await createSession(req, res, user.id);
  res.json({
    user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin },
    csrfToken,
    memberships: await membershipsOf(user.id),
  });
});

authRouter.post('/logout', async (req, res) => {
  if (req.session) {
    await db.delete(sessions).where(eq(sessions.id, req.session.id));
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user, csrfToken: req.session!.csrfToken, memberships: await membershipsOf(req.user!.id) });
});

/* ---------------------------------------------------------- password reset */

/** `executor` must be the caller's transaction when the user row was created in that same transaction. */
export async function issuePasswordToken(userId: string, purpose: 'RESET' | 'INVITE', executor: Executor = db) {
  const token = randomToken(32);
  const hours = purpose === 'INVITE' ? 72 : 1;
  await executor.insert(passwordTokens).values({
    userId, purpose, tokenHash: sha256(token), expiresAt: sql`now() + make_interval(hours => ${hours})`,
  });
  return token;
}

authRouter.post('/forgot-password', sensitiveLimiter, async (req, res) => {
  const { email } = body(req, z.object({ email: z.string().trim().toLowerCase().email().max(200) }));
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (user && user.isActive) {
    const token = await issuePasswordToken(user.id, 'RESET');
    const link = `${config.appUrl}/reset-password?token=${token}`;
    await sendMail(user.email, 'Reset password — Rental Management System',
      `Halo ${user.name},\n\nKami menerima permintaan reset password. Buka tautan berikut (berlaku 1 jam):\n${link}\n\nAbaikan email ini jika Anda tidak memintanya.`);
    await withPlatform((tx) => audit(tx, null, { action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id }, null));
  }
  // Same response either way — do not reveal whether the email is registered.
  res.json({ ok: true, message: 'Jika email terdaftar, tautan reset password telah dikirim.' });
});

async function findValidToken(token: string) {
  const rows = await db.select({ id: passwordTokens.id, userId: passwordTokens.userId, purpose: passwordTokens.purpose, email: users.email, name: users.name })
    .from(passwordTokens).innerJoin(users, eq(users.id, passwordTokens.userId))
    .where(and(eq(passwordTokens.tokenHash, sha256(token)), isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, sql`now()`)))
    .limit(1);
  return rows[0] ?? null;
}

authRouter.get('/token-info', sensitiveLimiter, async (req, res) => {
  const { token } = query(req, z.object({ token: z.string().min(20).max(200) }));
  const t = await findValidToken(token);
  if (!t) throw badRequest('Tautan tidak valid atau sudah kedaluwarsa');
  res.json({ purpose: t.purpose, email: t.email, name: t.name });
});

authRouter.post('/reset-password', sensitiveLimiter, async (req, res) => {
  const input = body(req, z.object({ token: z.string().min(20).max(200), password: z.string().max(200), name: z.string().trim().min(2).max(100).optional() }));
  const policy = passwordPolicyError(input.password);
  if (policy) throw badRequest(policy, { fields: { password: policy } });
  const t = await findValidToken(input.token);
  if (!t) throw badRequest('Tautan tidak valid atau sudah kedaluwarsa');
  const passwordHash = await hashPassword(input.password);
  await withPlatform(async (tx) => {
    const used = await tx.update(passwordTokens).set({ usedAt: sql`now()` })
      .where(and(eq(passwordTokens.id, t.id), isNull(passwordTokens.usedAt))).returning({ id: passwordTokens.id });
    if (!used.length) throw badRequest('Tautan sudah digunakan');
    await tx.update(users).set({
      passwordHash, failedLoginCount: 0, lockedUntil: null, ...(input.name && t.purpose === 'INVITE' ? { name: input.name } : {}),
    }).where(eq(users.id, t.userId));
    await tx.delete(sessions).where(eq(sessions.userId, t.userId)); // log out everywhere
    await audit(tx, null, { action: t.purpose === 'INVITE' ? 'auth.invite_accepted' : 'auth.password_reset', entityType: 'user', entityId: t.userId }, null);
  });
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, sensitiveLimiter, async (req, res) => {
  const input = body(req, z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }));
  const user = await db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
  if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) throw unauthorized('Password lama salah');
  const policy = passwordPolicyError(input.newPassword);
  if (policy) throw badRequest(policy, { fields: { newPassword: policy } });
  const passwordHash = await hashPassword(input.newPassword);
  await withPlatform(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(and(eq(sessions.userId, user.id), sql`${sessions.id} <> ${req.session!.id}`));
    await audit(tx, req, { action: 'auth.password_changed', entityType: 'user', entityId: user.id }, null);
  });
  res.json({ ok: true });
});

authRouter.patch('/profile', requireAuth, async (req, res) => {
  const { name } = body(req, z.object({ name: z.string().trim().min(2).max(100) }));
  await db.update(users).set({ name }).where(eq(users.id, req.user!.id));
  res.json({ ok: true });
});
