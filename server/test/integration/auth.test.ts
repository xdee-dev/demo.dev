import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, createCompany, createUser, login, PASSWORD } from '../helpers.js';
import { devOutbox } from '../../src/lib/mailer.js';

describe('authentication', () => {
  it('logs in with email/password and rejects wrong passwords with a generic message', async () => {
    const c = await createCompany();
    const u = await createUser([[c.id, 'ADMIN']]);
    const ok = await request(app).post('/api/auth/login').send({ email: u.email.toUpperCase(), password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(ok.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    const bad = await request(app).post('/api/auth/login').send({ email: u.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@x.local', password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
  });

  it('protects API routes and requires the CSRF token for writes', async () => {
    expect((await request(app).get('/api/customers')).status).toBe(401);
    const c = await createCompany();
    const u = await createUser([[c.id, 'OWNER']]);
    const client = await login(u.email, c.id);
    const noCsrf = await client.agent.post('/api/customers').set('x-company-id', c.id).send({ name: 'A B', phone: '081234567890' });
    expect(noCsrf.status).toBe(403);
    const ok = await client.post('/api/customers', { name: 'A B', phone: '081234567890' });
    expect(ok.status).toBe(201);
  });

  it('logout invalidates the session', async () => {
    const c = await createCompany();
    const u = await createUser([[c.id, 'OWNER']]);
    const client = await login(u.email, c.id);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    await client.post('/api/auth/logout');
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('locks the account after repeated failures', async () => {
    const c = await createCompany();
    const u = await createUser([[c.id, 'VIEWER']]);
    for (let i = 0; i < 8; i++) await request(app).post('/api/auth/login').send({ email: u.email, password: 'nope-nope' });
    const locked = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(locked.status).toBe(423);
  });

  it('resets a password through an emailed single-use token', async () => {
    const c = await createCompany();
    const u = await createUser([[c.id, 'VIEWER']]);
    const r = await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    expect(r.status).toBe(200);
    const mail = devOutbox.filter((m) => m.to === u.email).at(-1)!;
    const token = mail.text.match(/token=([\w-]+)/)![1];
    const weak = await request(app).post('/api/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(400);
    const done = await request(app).post('/api/auth/reset-password').send({ token, password: 'BrandNewPass123' });
    expect(done.status).toBe(200);
    const again = await request(app).post('/api/auth/reset-password').send({ token, password: 'BrandNewPass456' });
    expect(again.status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: 'BrandNewPass123' })).status).toBe(200);
    // same response for unknown emails (no account enumeration)
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@x.local' });
    expect(unknown.body).toEqual(r.body);
  });

  it('does not leak internals on errors', async () => {
    const res = await request(app).post('/api/auth/login').set('content-type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at \w+ \(/);
  });
});
