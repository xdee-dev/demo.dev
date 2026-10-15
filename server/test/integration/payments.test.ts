import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { fixture, iso } from '../helpers.js';

describe('payments & rental lifecycle', () => {
  let F: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => { F = await fixture(); });

  const newRental = async (start: number, days: number, extra: Record<string, unknown> = {}) =>
    (await F.client.post('/api/rentals', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(start), endAt: iso(start + days), rentalType: 'DAILY', ...extra })).body;
  const detail = async (id: string) => (await F.client.get(`/api/rentals/${id}`)).body;
  const pay = (rentalId: string, amount: string, extra: Record<string, unknown> = {}, key?: string) =>
    F.client.post('/api/payments', { rentalId, amount, method: 'CASH', ...extra }, key ? { 'idempotency-key': key } : {});

  it('installments update the balance and derived status', async () => {
    const r = await newRental(1, 3); // 900.000
    expect((await detail(r.id)).balance).toMatchObject({ amountDue: '900000.00', paid: '0.00', paymentStatus: 'UNPAID' });
    expect((await pay(r.id, '300.000', { isDownPayment: true })).status).toBe(201); // Indonesian format accepted
    expect((await detail(r.id)).balance).toMatchObject({ paid: '300000.00', balance: '600000.00', paymentStatus: 'DP_PAID' });
    await pay(r.id, '250000');
    expect((await detail(r.id)).balance).toMatchObject({ balance: '350000.00', paymentStatus: 'PARTIAL' });
    const over = await pay(r.id, '350001');
    expect(over.status).toBe(400);
    await pay(r.id, '350000');
    expect((await detail(r.id)).balance).toMatchObject({ balance: '0.00', paymentStatus: 'PAID' });
    expect((await pay(r.id, '1')).status).toBe(409);
  });

  it('down payment can be recorded together with the transaction', async () => {
    const r = await newRental(10, 2, { downPayment: { amount: '200000', method: 'TRANSFER' } });
    expect((await detail(r.id)).balance).toMatchObject({ paid: '200000.00', paymentStatus: 'DP_PAID' });
  });

  it('is idempotent: repeated or concurrent submits with the same key create one payment', async () => {
    const r = await newRental(20, 2);
    const key = `pay-${Date.now()}-abcdef`;
    const results = await Promise.all([pay(r.id, '100000', {}, key), pay(r.id, '100000', {}, key), pay(r.id, '100000', {}, key)]);
    const ok = results.filter((x) => x.status === 201 || x.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await pay(r.id, '100000', {}, key);
    expect([200, 201]).toContain(again.status);
    expect((await detail(r.id)).payments).toHaveLength(1);
    expect((await detail(r.id)).balance.paid).toBe('100000.00');
  });

  it('reversal corrects a payment without deleting it and is audited', async () => {
    const r = await newRental(30, 1);
    const p = (await pay(r.id, '300000')).body;
    expect((await detail(r.id)).balance.paymentStatus).toBe('PAID');
    const rev = await F.client.post(`/api/payments/${p.id}/reverse`, { reason: 'Salah input nominal' });
    expect(rev.status).toBe(201);
    expect(rev.body.amount).toBe('-300000.00');
    const d = await detail(r.id);
    expect(d.payments).toHaveLength(2);
    expect(d.balance).toMatchObject({ paid: '0.00', paymentStatus: 'UNPAID' });
    expect((await F.client.post(`/api/payments/${p.id}/reverse`, { reason: 'lagi' })).status).toBe(409);
    const log = await F.client.get(`/api/audit-logs?entityType=payment&entityId=${p.id}`);
    expect(log.body.data.map((x: { action: string }) => x.action)).toContain('payment.reverse');
  });

  it('the database refuses to delete or edit posted payments', async () => {
    const r = await newRental(35, 1);
    const p = (await pay(r.id, '100000')).body;
    const attempt = (q: ReturnType<typeof sql>) => db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${F.company.id}, true)`);
      await tx.execute(q);
    });
    await expect(attempt(sql`delete from payments where id = ${p.id}`)).rejects.toThrow();
    await expect(attempt(sql`update payments set amount = 1 where id = ${p.id}`)).rejects.toThrow();
  });

  it('handover → late return → late fee → auto-complete when paid in full', async () => {
    const H = 3600_000;
    const startAt = new Date(Date.now() - 3 * 24 * H).toISOString();
    const endAt = new Date(Date.now() - 5 * H).toISOString(); // planned return 5 hours ago
    const r = (await F.client.post('/api/rentals', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt, endAt, rentalType: 'DAILY' })).body;
    expect(r.quantity).toBe(3); // 2 days 19 hours → 3 started days
    expect(r.total).toBe('900000.00');
    expect((await F.client.post(`/api/rentals/${r.id}/handover`, { handedAt: startAt, km: 1000, fuelLevel: 'Penuh' })).status).toBe(200);
    const veh = await F.client.get('/api/vehicles');
    expect(veh.body.data.find((v: { id: string }) => v.id === F.vehicle.id).status).toBe('RENTED');
    const preview = await F.client.post(`/api/rentals/${r.id}/return-preview`, { returnedAt: new Date().toISOString() });
    expect(preview.body.lateFee).toBe('300000.00'); // 5h late − 1h grace → one started day at the daily rate
    const lowKm = await F.client.post(`/api/rentals/${r.id}/return`, { returnedAt: new Date().toISOString(), km: 900 });
    expect(lowKm.status).toBe(400); // km below handover km
    const ret = await F.client.post(`/api/rentals/${r.id}/return`, { returnedAt: new Date().toISOString(), km: 1250, damageFee: '100000' });
    expect(ret.status).toBe(200);
    expect(ret.body.rental.status).toBe('RETURNED');
    expect(ret.body.rental.total).toBe('1300000.00');
    const km = await F.client.post(`/api/rentals/${r.id}/return`, { returnedAt: new Date().toISOString() });
    expect(km.status).toBe(400); // already returned
    await pay(r.id, '1300000');
    expect((await detail(r.id)).rental.status).toBe('COMPLETED');
    const veh2 = await F.client.get('/api/vehicles');
    expect(veh2.body.data.find((v: { id: string }) => v.id === F.vehicle.id).status).not.toBe('RENTED');
  });

  it('cancellation with a fee leaves a refund due that can be refunded', async () => {
    const r = await newRental(50, 2); // 600.000
    await pay(r.id, '400000', { isDownPayment: true });
    const c = await F.client.post(`/api/rentals/${r.id}/cancel`, { reason: 'Batal mendadak', cancellationFee: '100000' });
    expect(c.status).toBe(200);
    expect((await detail(r.id)).balance).toMatchObject({ amountDue: '100000.00', balance: '-300000.00', paymentStatus: 'REFUND_DUE' });
    expect((await F.client.post('/api/payments', { rentalId: r.id, kind: 'REFUND', amount: '300001', method: 'CASH' })).status).toBe(400);
    expect((await F.client.post('/api/payments', { rentalId: r.id, kind: 'REFUND', amount: '300000', method: 'CASH' })).status).toBe(201);
    expect((await detail(r.id)).balance).toMatchObject({ balance: '0.00', paymentStatus: 'PAID' });
  });

  it('reservation → rental conversion carries the agreed price and the down payment', async () => {
    const res = await F.client.post('/api/reservations', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(70), endAt: iso(72), rentalType: 'DAILY', status: 'CONFIRMED' });
    expect(res.status).toBe(201);
    expect((await F.client.post('/api/payments', { reservationId: res.body.id, amount: '150000', method: 'TRANSFER' })).status).toBe(201);
    const conv = await F.client.post(`/api/reservations/${res.body.id}/convert`);
    expect(conv.status).toBe(201);
    const d = await detail(conv.body.id);
    expect(d.rental.total).toBe('600000.00');
    expect(d.balance).toMatchObject({ paid: '150000.00', paymentStatus: 'DP_PAID' });
    expect(d.reservation.id).toBe(res.body.id);
    // the slot stays blocked by the rental
    expect((await F.client.post('/api/rentals', { customerId: F.customer.id, vehicleId: F.vehicle.id, startAt: iso(71), endAt: iso(73), rentalType: 'DAILY' })).status).toBe(409);
  });

  it('dashboard and reports are computed from stored data without double counting', async () => {
    const dash = await F.client.get(`/api/dashboard?from=${iso(-400).slice(0, 10)}&to=${iso(400).slice(0, 10)}`);
    expect(dash.status).toBe(200);
    const m = dash.body.money;
    const sumRows = await F.client.get(`/api/reports/summary?from=${iso(-400).slice(0, 10)}&to=${iso(400).slice(0, 10)}`);
    const revenueRow = sumRows.body.rows.find((r: { item: string }) => r.item.startsWith('Pendapatan rental'));
    expect(revenueRow.amount).toBe(m.revenue);
    const pays = await F.client.get(`/api/payments?pageSize=100&from=${iso(-400).slice(0, 10)}&to=${iso(400).slice(0, 10)}`);
    expect(pays.body.sum).toBe(m.cashIn);
    const xlsx = await F.client.get(`/api/reports/summary?format=xlsx`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
  });
});
