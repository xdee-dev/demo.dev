import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { fixture, createUser, login, rawCount, iso } from '../helpers.js';

describe('multi-tenant isolation', () => {
  let A: Awaited<ReturnType<typeof fixture>>;
  let B: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => { A = await fixture(); B = await fixture(); });

  it('lists only the active company data', async () => {
    const a = await A.client.get('/api/customers');
    expect(a.status).toBe(200);
    expect(a.body.data.map((c: { id: string }) => c.id)).toEqual([A.customer.id]);
    const v = await A.client.get('/api/vehicles');
    expect(v.body.data.map((x: { id: string }) => x.id)).toEqual([A.vehicle.id]);
  });

  it('cannot read another company record by id (URL manipulation)', async () => {
    expect((await A.client.get(`/api/customers/${B.customer.id}`)).status).toBe(404);
    expect((await A.client.get(`/api/vehicles/${B.vehicle.id}`)).status).toBe(404);
  });

  it('cannot switch to a company it is not a member of (header manipulation)', async () => {
    const res = await A.client.as(B.company.id).get('/api/customers');
    expect(res.status).toBe(403);
    const bogus = await A.client.as('00000000-0000-0000-0000-000000000000').get('/api/customers');
    expect(bogus.status).toBe(403);
  });

  it('cannot create a rental using another company vehicle/customer id (parameter manipulation)', async () => {
    const res = await A.client.post('/api/rentals', {
      customerId: A.customer.id, vehicleId: B.vehicle.id, startAt: iso(30), endAt: iso(31), rentalType: 'DAILY',
    });
    expect(res.status).toBe(404);
    const res2 = await A.client.post('/api/rentals', {
      customerId: B.customer.id, vehicleId: A.vehicle.id, startAt: iso(30), endAt: iso(31), rentalType: 'DAILY',
    });
    expect(res2.status).toBe(404);
  });

  it('cannot update or archive another company record', async () => {
    const put = await A.client.put(`/api/customers/${B.customer.id}`, { name: 'Hacked', phone: '081299998888' });
    expect(put.status).toBe(404);
    const arch = await A.client.post(`/api/vehicles/${B.vehicle.id}/archive`);
    expect(arch.status).toBe(404);
    const b = await B.client.get(`/api/customers/${B.customer.id}`);
    expect(b.body.customer.name).toBe(B.customer.name);
  });

  it('a user in two companies sees each company separately', async () => {
    const u = await createUser([[A.company.id, 'VIEWER'], [B.company.id, 'VIEWER']]);
    const c = await login(u.email);
    const me = await c.get('/api/auth/me');
    expect(me.body.memberships).toHaveLength(2);
    const ra = await c.as(A.company.id).get('/api/customers');
    const rb = await c.as(B.company.id).get('/api/customers');
    expect(ra.body.data[0].id).toBe(A.customer.id);
    expect(rb.body.data[0].id).toBe(B.customer.id);
  });

  it('database RLS: without tenant context no rows are visible', async () => {
    expect(await rawCount('customers')).toBe(0);
    expect(await rawCount('customers', A.company.id)).toBe(1);
  });

  it('database RLS: inserting a row for another company is rejected', async () => {
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${A.company.id}, true)`);
      await tx.execute(sql`insert into customers (company_id, code, name, phone, phone_normalized) values (${B.company.id}, 'X', 'x', '1', '1')`);
    })).rejects.toThrow();
  });

  it('database composite FK: a rental cannot reference another company vehicle even via raw SQL', async () => {
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${A.company.id}, true)`);
      await tx.execute(sql`insert into rental_transactions (company_id, number, invoice_number, contract_number, customer_id, vehicle_id, start_at, end_at,
        rental_type, unit_price, quantity, subtotal, total, customer_snapshot, vehicle_snapshot, company_snapshot)
        values (${A.company.id}, 'X1', 'X1', 'X1', ${A.customer.id}, ${B.vehicle.id}, now(), now() + interval '1 day', 'DAILY', 1, 1, 1, 1, '{}', '{}', '{}')`);
    })).rejects.toMatchObject({ cause: { code: '23503' } }); // foreign_key_violation
  });

  it('files of another company are not reachable', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await B.client.agent.post('/api/files').set({ 'x-csrf-token': B.client.csrf, 'x-company-id': B.company.id })
      .field('kind', 'VEHICLE_PHOTO').attach('file', png, 'p.png');
    expect(up.status).toBe(201);
    expect((await B.client.get(`/api/files/${up.body.id}`)).status).toBe(200);
    expect((await A.client.get(`/api/files/${up.body.id}`)).status).toBe(404);
  });

  it('super admin cannot read company operational data without membership', async () => {
    const sa = await createUser([], { superAdmin: true });
    const c = await login(sa.email);
    expect((await c.get('/api/admin/companies')).status).toBe(200);
    expect((await c.as(A.company.id).get('/api/customers')).status).toBe(403);
    expect((await c.as(A.company.id).get('/api/payments')).status).toBe(403);
  });
});
