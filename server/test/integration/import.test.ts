import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { fixture } from '../helpers.js';

async function xlsx(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Excel/CSV import', () => {
  let F: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => { F = await fixture(); });
  const upload = (entity: string, buf: Buffer, name: string) =>
    F.client.agent.post(`/api/imports/${entity}/upload`).set({ 'x-csrf-token': F.client.csrf, 'x-company-id': F.company.id }).attach('file', buf, name);

  it('detects errors and duplicates, then imports valid rows only', async () => {
    const existingPhone = F.customer.phone as string;
    const file = await xlsx([
      ['Nama', 'No HP', 'Email', 'Alamat'],
      ['Andi Saputra', '0811-2222-3333', 'andi@example.com', 'Jakarta'],
      ['', '0811-4444-5555', '', ''], // missing name
      ['Citra Dewi', 'abc', '', ''], // bad phone
      ['Dupe In File', '0811-2222-3333', '', ''], // duplicate of row 2
      ['Existing Person', existingPhone, '', 'Alamat baru'], // matches DB
      ['Eka Putri', '0811 6666 7777', 'bukan-email', ''], // bad email
      ['Fajar Nugroho', '+62 811 8888 9999', '', 'Bandung'],
    ]);
    const up = await upload('customers', file, 'customers.xlsx');
    expect(up.status).toBe(201);
    expect(up.body.suggestedMapping).toMatchObject({ name: 0, phone: 1, email: 2, address: 3 });
    const v = await F.client.post(`/api/imports/${up.body.id}/validate`, { mapping: up.body.suggestedMapping, duplicateMode: 'skip' });
    expect(v.status).toBe(200);
    expect(v.body.summary).toMatchObject({ total: 7, create: 2, skip: 1, error: 4 });
    const upd = await F.client.post(`/api/imports/${up.body.id}/validate`, { mapping: up.body.suggestedMapping, duplicateMode: 'update' });
    expect(upd.body.summary.update).toBe(1);
    expect(upd.body.rows.find((r: { action: string }) => r.action === 'update').changes).toHaveProperty('address');
    const commit = await F.client.post(`/api/imports/${up.body.id}/commit`, { mapping: up.body.suggestedMapping, duplicateMode: 'update' });
    expect(commit.status).toBe(200);
    expect(commit.body.summary).toMatchObject({ created: 2, updated: 1, error: 4 });
    const list = await F.client.get('/api/customers?pageSize=50');
    expect(list.body.total).toBe(3);
    expect((await F.client.post(`/api/imports/${up.body.id}/commit`, { mapping: up.body.suggestedMapping })).status).toBe(400); // not twice
    const errs = await F.client.get(`/api/imports/${up.body.id}/errors`);
    expect(errs.status).toBe(200);
    const audit = await F.client.get('/api/audit-logs?action=import');
    expect(audit.body.data.length).toBeGreaterThan(0);
  });

  it('imports vehicles from CSV with rates and rejects duplicate plates', async () => {
    const csv = Buffer.from([
      'Nomor Polisi;Merek;Model;Tahun;Transmisi;Tarif Harian',
      'D 1111 AA;Honda;Jazz;2019;Matic;300.000',
      'd1111aa;Honda;Jazz RS;2020;Manual;320000',
      `${F.vehicle.plateNumber};Toyota;Avanza;2022;Manual;350000`,
      'D 2222 BB;Suzuki;Ertiga;1800;Manual;300000',
    ].join('\n'));
    const up = await upload('vehicles', csv, 'kendaraan.csv');
    expect(up.status).toBe(201);
    const v = await F.client.post(`/api/imports/${up.body.id}/validate`, { mapping: up.body.suggestedMapping, duplicateMode: 'skip' });
    expect(v.body.summary).toMatchObject({ create: 1, skip: 1, error: 2 });
    const c = await F.client.post(`/api/imports/${up.body.id}/commit`, { mapping: up.body.suggestedMapping, duplicateMode: 'skip' });
    expect(c.body.summary.created).toBe(1);
    const rates = await F.client.get('/api/rates');
    const jazz = rates.body.find((x: { plateNumber: string }) => x.plateNumber === 'D 1111 AA');
    expect(jazz.rates[0]).toMatchObject({ rentalType: 'DAILY', price: '300000.00' });
  });

  it('serves downloadable templates', async () => {
    const t = await F.client.get('/api/imports/templates/customers');
    expect(t.status).toBe(200);
    expect(t.headers['content-disposition']).toMatch(/template_import_customer/);
  });
});
