import { describe, it, expect, beforeAll } from 'vitest';
import { fixture, iso } from '../helpers.js';

describe('vehicle schedule conflicts', () => {
  let F: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => { F = await fixture(); });
  const rental = (start: number, end: number, extra: Record<string, unknown> = {}) =>
    F.client.post('/api/rentals', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(start), endAt: iso(end), rentalType: 'DAILY', ...extra });

  it('rejects an overlapping rental and allows back-to-back bookings', async () => {
    expect((await rental(1, 3)).status).toBe(201);
    const clash = await rental(2, 4);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect((await rental(3, 4)).status).toBe(201); // starts exactly when the previous ends
  });

  it('prevents double booking under concurrent requests', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => rental(10, 12)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
  });

  it('blocks confirmed/pending reservations but not drafts or cancelled ones', async () => {
    const draft = await F.client.post('/api/reservations', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(20), endAt: iso(22), rentalType: 'DAILY', status: 'DRAFT' });
    expect(draft.status).toBe(201);
    const pending = await F.client.post('/api/reservations', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(20), endAt: iso(22), rentalType: 'DAILY', status: 'PENDING' });
    expect(pending.status).toBe(201);
    expect((await rental(21, 23)).status).toBe(409);
    // the draft can no longer be confirmed: the slot is taken
    expect((await F.client.post(`/api/reservations/${draft.body.id}/status`, { status: 'CONFIRMED' })).status).toBe(409);
    // cancelling the pending reservation releases the slot
    expect((await F.client.post(`/api/reservations/${pending.body.id}/status`, { status: 'CANCELLED', reason: 'Batal' })).status).toBe(200);
    expect((await rental(21, 23)).status).toBe(201);
  });

  it('cancelled rentals release the vehicle', async () => {
    const r = await rental(30, 32);
    expect((await rental(30, 32)).status).toBe(409);
    expect((await F.client.post(`/api/rentals/${r.body.id}/cancel`, { reason: 'Customer batal' })).status).toBe(200);
    expect((await rental(30, 32)).status).toBe(201);
  });

  it('maintenance blocks the vehicle for its period', async () => {
    const m = await F.client.post('/api/maintenance', { vehicleId: F.vehicle.id, startAt: iso(40), endAt: iso(41), serviceType: 'Servis berkala', cost: '0' });
    expect(m.status).toBe(201);
    expect((await rental(40, 42)).status).toBe(409);
    const avail = await F.client.get(`/api/vehicles/available?start=${encodeURIComponent(iso(40))}&end=${encodeURIComponent(iso(42))}`);
    expect(avail.body.find((v: { id: string }) => v.id === F.vehicle.id)).toBeUndefined();
    const free = await F.client.get(`/api/vehicles/available?start=${encodeURIComponent(iso(45))}&end=${encodeURIComponent(iso(46))}`);
    expect(free.body.find((v: { id: string }) => v.id === F.vehicle.id)).toBeTruthy();
  });

  it('editing a rental re-checks availability and recalculates totals', async () => {
    const a = await rental(60, 62);
    await rental(63, 64);
    const extend = await F.client.put(`/api/rentals/${a.body.id}`, { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(60), endAt: iso(64), rentalType: 'DAILY' });
    expect(extend.status).toBe(409);
    const ok = await F.client.put(`/api/rentals/${a.body.id}`, { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(60), endAt: iso(63), rentalType: 'DAILY' });
    expect(ok.status).toBe(200);
    expect(ok.body.quantity).toBe(3);
    expect(ok.body.total).toBe('900000.00');
  });
});
