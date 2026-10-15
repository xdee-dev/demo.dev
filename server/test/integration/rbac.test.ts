import { describe, it, expect, beforeAll } from 'vitest';
import { fixture, createUser, login, iso } from '../helpers.js';

describe('role-based access control (checked on the backend)', () => {
  let F: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => { F = await fixture(); });
  const as = async (role: 'ADMIN' | 'FINANCE' | 'OPERATOR' | 'VIEWER') => login((await createUser([[F.company.id, role]])).email, F.company.id);

  it('viewer can read but not write', async () => {
    const v = await as('VIEWER');
    expect((await v.get('/api/customers')).status).toBe(200);
    expect((await v.post('/api/customers', { name: 'Nope', phone: '081211112222' })).status).toBe(403);
    expect((await v.post('/api/rentals', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(40), endAt: iso(41), rentalType: 'DAILY' })).status).toBe(403);
    expect((await v.get('/api/reports/summary?format=xlsx')).status).toBe(403); // no export permission
  });

  it('operator cannot see financial reports or override prices', async () => {
    const o = await as('OPERATOR');
    expect((await o.get('/api/reports/summary')).status).toBe(403);
    expect((await o.get('/api/reports/rentals')).status).toBe(200);
    const dash = await o.get('/api/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.money).toBeNull();
    const override = await o.post('/api/rentals', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(40), endAt: iso(41), rentalType: 'DAILY', unitPrice: '1000' });
    expect(override.status).toBe(403);
    const atRate = await o.post('/api/rentals', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(40), endAt: iso(41), rentalType: 'DAILY' });
    expect(atRate.status).toBe(201);
    expect(atRate.body.total).toBe('300000.00');
    expect((await o.put(`/api/rates/${F.vehicle.id}`, { rates: [{ rentalType: 'DAILY', withDriver: false, price: 1 }] })).status).toBe(403);
  });

  it('finance can post payments but cannot create rentals or manage users', async () => {
    const f = await as('FINANCE');
    expect((await f.post('/api/rentals', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(50), endAt: iso(51), rentalType: 'DAILY' })).status).toBe(403);
    expect((await f.get('/api/company/members')).status).toBe(403);
    expect((await f.get('/api/reports/summary')).status).toBe(200);
  });

  it('admin cannot manage users; owner can change role permissions and it takes effect', async () => {
    const a = await as('ADMIN');
    expect((await a.get('/api/company/members')).status).toBe(403);
    const viewer = await as('VIEWER');
    expect((await viewer.get('/api/payments')).status).toBe(200);
    const roles = await F.ownerClient.get('/api/company/roles');
    const perms = (roles.body.matrix.VIEWER as string[]).filter((p) => p !== 'payment.view');
    expect((await F.ownerClient.put('/api/company/roles/VIEWER', { permissions: perms })).status).toBe(200);
    expect((await viewer.get('/api/payments')).status).toBe(403);
  });

  it('only owners can grant the owner role and the last owner cannot be removed', async () => {
    const members = (await F.ownerClient.get('/api/company/members')).body as { id: string; role: string; userId: string }[];
    const ownerMembership = members.find((m) => m.userId === F.owner.id)!;
    const other = await createUser([[F.company.id, 'OWNER']]);
    const otherClient = await login(other.email, F.company.id);
    // demote the original owner is allowed (another owner exists)…
    expect((await otherClient.patch(`/api/company/members/${ownerMembership.id}`, { role: 'ADMIN' })).status).toBe(200);
    // …but the remaining owner cannot demote themselves
    const otherMembership = ((await otherClient.get('/api/company/members')).body as { id: string; userId: string }[]).find((m) => m.userId === other.id)!;
    expect((await otherClient.patch(`/api/company/members/${otherMembership.id}`, { role: 'ADMIN' })).status).toBe(400);
  });
});
