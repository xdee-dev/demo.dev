import request from 'supertest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { companies, users, companyMemberships } from '../src/db/schema.js';
import { hashPassword } from '../src/auth/password.js';
import { bootstrapCompany } from '../src/services/company.js';
import type { Role } from '../src/auth/permissions.js';

export const app = createApp();
export const PASSWORD = 'TestPassw0rd!';
let pwHash: string | null = null;

export const uid = () => crypto.randomUUID().slice(0, 8);

export async function createCompany(name = `Co ${uid()}`) {
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(companies).values({ name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${uid()}` }).returning();
    await bootstrapCompany(tx, c.id, null);
    return c;
  });
}

export async function createUser(memberships: [string, Role][], opts: { superAdmin?: boolean; email?: string } = {}) {
  pwHash ??= await hashPassword(PASSWORD);
  const [u] = await db.insert(users).values({ email: opts.email ?? `u${uid()}@test.local`, name: 'Test User', passwordHash: pwHash, isSuperAdmin: !!opts.superAdmin }).returning();
  for (const [companyId, role] of memberships) await db.insert(companyMemberships).values({ companyId, userId: u.id, role });
  return u;
}

/** Logged-in HTTP client bound to a company (sends session cookie, CSRF token and X-Company-Id). */
export async function login(email: string, companyId?: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrfToken as string;
  const headers = (extra: Record<string, string> = {}) => ({ 'x-csrf-token': csrf, ...(companyId ? { 'x-company-id': companyId } : {}), ...extra });
  return {
    agent, csrf,
    get: (url: string) => agent.get(url).set(headers()),
    post: (url: string, body?: unknown, extra?: Record<string, string>) => agent.post(url).set(headers(extra)).send(body as object),
    put: (url: string, body?: unknown) => agent.put(url).set(headers()).send(body as object),
    patch: (url: string, body?: unknown) => agent.patch(url).set(headers()).send(body as object),
    as: (cid: string) => ({
      get: (url: string) => agent.get(url).set({ 'x-csrf-token': csrf, 'x-company-id': cid }),
      post: (url: string, body?: unknown) => agent.post(url).set({ 'x-csrf-token': csrf, 'x-company-id': cid }).send(body as object),
    }),
  };
}
export type Client = Awaited<ReturnType<typeof login>>;

/** Owner client + a company with one vehicle (daily 300.000) and one customer. */
export async function fixture(role: Role = 'OWNER') {
  const company = await createCompany();
  const owner = await createUser([[company.id, 'OWNER']]);
  const ownerClient = await login(owner.email, company.id);
  const vehicle = (await ownerClient.post('/api/vehicles', {
    plateNumber: `B ${Math.floor(1000 + Math.random() * 8999)} TST`, brand: 'Toyota', model: 'Avanza', year: 2022, transmission: 'MANUAL',
    rates: [{ rentalType: 'DAILY', withDriver: false, price: '300000' }, { rentalType: 'WEEKLY', withDriver: false, price: 1800000 }],
  })).body;
  const customer = (await ownerClient.post('/api/customers', { name: `Customer ${uid()}`, phone: `0812${Math.floor(10000000 + Math.random() * 89999999)}` })).body;
  let client = ownerClient;
  let user = owner;
  if (role !== 'OWNER') {
    user = await createUser([[company.id, role]]);
    client = await login(user.email, company.id);
  }
  return { company, owner, ownerClient, client, user, vehicle, customer };
}

export const iso = (daysFromNow: number, hour = 9) => {
  const d = new Date();
  d.setUTCHours(hour - 7, 0, 0, 0);
  return new Date(d.getTime() + daysFromNow * 86400_000).toISOString();
};

export async function rawCount(table: string, companyId?: string) {
  return db.transaction(async (tx) => {
    if (companyId) await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    const r = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`));
    return r.rows[0].n;
  });
}
