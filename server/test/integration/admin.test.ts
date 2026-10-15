import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, createUser, login, uid, fixture } from '../helpers.js';
import { devOutbox } from '../../src/lib/mailer.js';

describe('super admin & invitations', () => {
  it('creates a company whose owner is a brand-new email, and the owner can activate the account', async () => {
    const sa = await createUser([], { superAdmin: true });
    const c = await login(sa.email);
    const ownerEmail = `owner-${uid()}@example.com`;
    const res = await c.post('/api/admin/companies', { name: `PT. RPMS ${uid()}`, email: 'eday@rpms.co.id', ownerName: 'eday', ownerEmail });
    expect(res.status).toBe(201);
    expect(res.body.owner.invited).toBe(true);
    const mail = devOutbox.filter((m) => m.to === ownerEmail).at(-1)!;
    const token = mail.text.match(/token=([\w-]+)/)![1];
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'OwnerPass123', name: 'Eday' })).status).toBe(200);
    const owner = await request(app).post('/api/auth/login').send({ email: ownerEmail, password: 'OwnerPass123' });
    expect(owner.status).toBe(200);
    expect(owner.body.memberships[0]).toMatchObject({ role: 'OWNER', companyId: res.body.company.id });
  });

  it('creates a company for an existing user without an invitation', async () => {
    const sa = await createUser([], { superAdmin: true });
    const existing = await createUser([]);
    const c = await login(sa.email);
    const res = await c.post('/api/admin/companies', { name: `CV Baru ${uid()}`, ownerName: 'Xavier', ownerEmail: existing.email });
    expect(res.status).toBe(201);
    expect(res.body.owner.invited).toBe(false);
  });

  it('an owner can invite a brand-new email to the company', async () => {
    const F = await fixture();
    const res = await F.ownerClient.post('/api/company/members', { email: `staff-${uid()}@example.com`, name: 'Staf Baru', role: 'OPERATOR' });
    expect(res.status).toBe(201);
    expect(res.body.invited).toBe(true);
  });
});
