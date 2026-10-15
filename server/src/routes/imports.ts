import { Router, type Request } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import type { Tx } from '../db/client.js';
import { customers, importJobs, vehicles } from '../db/schema.js';
import { can } from '../auth/middleware.js';
import { body, parse, zUuid, zMoney } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { nextNumber } from '../lib/numbering.js';
import { getSettings } from '../lib/settings.js';
import { zodToDetails } from '../lib/errors.js';
import { customerInput, prepareCustomer } from './customers.js';
import { vehicleInput, prepareVehicle, saveRates } from './vehicles.js';
import { normalizePhone, normalizePlate } from '../lib/normalize.js';

export const importsRouter = Router();

type Entity = 'CUSTOMER' | 'VEHICLE';
interface FieldDef { key: string; label: string; required?: boolean; aliases: string[]; example: string; help?: string }

const FIELDS: Record<Entity, FieldDef[]> = {
  CUSTOMER: [
    { key: 'name', label: 'Nama Lengkap / Perusahaan', required: true, aliases: ['nama', 'name', 'namalengkap', 'namacustomer', 'customer', 'namaperusahaan'], example: 'Budi Santoso' },
    { key: 'phone', label: 'No. Telepon', required: true, aliases: ['telepon', 'phone', 'notelepon', 'nohp', 'hp', 'nomortelepon', 'whatsapp', 'wa', 'telp'], example: '0812-3456-7890' },
    { key: 'type', label: 'Jenis (Individu/Perusahaan)', aliases: ['jenis', 'type', 'tipe', 'jeniscustomer'], example: 'Individu' },
    { key: 'email', label: 'Email', aliases: ['email', 'surel', 'mail'], example: 'budi@example.com' },
    { key: 'address', label: 'Alamat', aliases: ['alamat', 'address'], example: 'Jl. Merdeka No. 1, Jakarta' },
    { key: 'idType', label: 'Jenis Identitas (KTP/SIM/PASPOR/NPWP)', aliases: ['jenisidentitas', 'idtype', 'identitas'], example: 'KTP' },
    { key: 'idNumber', label: 'No. Identitas', aliases: ['noidentitas', 'nik', 'noktp', 'ktp', 'idnumber', 'nomoridentitas'], example: '3171234567890001' },
    { key: 'contactPerson', label: 'Kontak Person (perusahaan)', aliases: ['kontakperson', 'contactperson', 'pic'], example: '' },
    { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes', 'keterangan'], example: '' },
  ],
  VEHICLE: [
    { key: 'plateNumber', label: 'Nomor Polisi', required: true, aliases: ['nopol', 'nomorpolisi', 'platenumber', 'plat', 'nopolisi', 'platnomor'], example: 'B 1234 XYZ' },
    { key: 'brand', label: 'Merek', required: true, aliases: ['merek', 'merk', 'brand'], example: 'Toyota' },
    { key: 'model', label: 'Model / Tipe', required: true, aliases: ['model', 'tipe', 'type', 'modeltipe'], example: 'Avanza 1.3 G' },
    { key: 'year', label: 'Tahun', aliases: ['tahun', 'year', 'tahunkendaraan'], example: '2022' },
    { key: 'color', label: 'Warna', aliases: ['warna', 'color'], example: 'Hitam' },
    { key: 'transmission', label: 'Transmisi (Manual/Matic)', aliases: ['transmisi', 'transmission'], example: 'Manual' },
    { key: 'fuelType', label: 'Bahan Bakar', aliases: ['bahanbakar', 'bbm', 'fuel', 'fueltype'], example: 'Bensin' },
    { key: 'seats', label: 'Kapasitas Penumpang', aliases: ['kapasitas', 'seats', 'kursi', 'kapasitaspenumpang'], example: '7' },
    { key: 'chassisNumber', label: 'No. Rangka', aliases: ['norangka', 'nomorrangka', 'chassis', 'vin'], example: '' },
    { key: 'engineNumber', label: 'No. Mesin', aliases: ['nomesin', 'nomormesin', 'engine'], example: '' },
    { key: 'purchaseDate', label: 'Tanggal Pembelian (YYYY-MM-DD)', aliases: ['tanggalpembelian', 'tglbeli', 'purchasedate'], example: '2022-03-15' },
    { key: 'purchasePrice', label: 'Harga Perolehan', aliases: ['hargaperolehan', 'hargabeli', 'purchaseprice'], example: '235000000' },
    { key: 'currentKm', label: 'Kilometer Saat Ini', aliases: ['km', 'kilometer', 'odometer'], example: '25000' },
    { key: 'rateDaily', label: 'Tarif Harian (tanpa sopir)', aliases: ['tarifharian', 'harian', 'ratedaily'], example: '350000' },
    { key: 'rateWeekly', label: 'Tarif Mingguan (tanpa sopir)', aliases: ['tarifmingguan', 'mingguan', 'rateweekly'], example: '2100000' },
    { key: 'rateMonthly', label: 'Tarif Bulanan (tanpa sopir)', aliases: ['tarifbulanan', 'bulanan', 'ratemonthly'], example: '7500000' },
    { key: 'rateDailyDriver', label: 'Tarif Harian (dengan sopir)', aliases: ['tarifharianSopir', 'tarifhariandengansopir', 'harianSopir'], example: '550000' },
    { key: 'rateWeeklyDriver', label: 'Tarif Mingguan (dengan sopir)', aliases: ['tarifmingguandengansopir'], example: '' },
    { key: 'rateMonthlyDriver', label: 'Tarif Bulanan (dengan sopir)', aliases: ['tarifbulanandengansopir'], example: '' },
    { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes', 'keterangan'], example: '' },
  ],
};

const RATE_FIELDS: Record<string, { rentalType: 'DAILY' | 'WEEKLY' | 'MONTHLY'; withDriver: boolean }> = {
  rateDaily: { rentalType: 'DAILY', withDriver: false }, rateWeekly: { rentalType: 'WEEKLY', withDriver: false }, rateMonthly: { rentalType: 'MONTHLY', withDriver: false },
  rateDailyDriver: { rentalType: 'DAILY', withDriver: true }, rateWeeklyDriver: { rentalType: 'WEEKLY', withDriver: true }, rateMonthlyDriver: { rentalType: 'MONTHLY', withDriver: true },
};

const MAX_ROWS = 5000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const entityParam = (req: Request): Entity => {
  const e = String(req.params.entity).toUpperCase();
  if (e === 'CUSTOMERS' || e === 'CUSTOMER') return 'CUSTOMER';
  if (e === 'VEHICLES' || e === 'VEHICLE') return 'VEHICLE';
  throw notFound('Jenis impor');
};
const requireImportPerm = (req: Request, entity: Entity) => {
  if (!can(req, entity === 'CUSTOMER' ? 'customer.import' : 'vehicle.import')) throw forbidden();
};

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((x) => x.text).join('');
    if (o.result !== undefined) return cellToString(o.result);
    if (o.text !== undefined) return String(o.text);
    return '';
  }
  return String(v).trim();
}

async function parseUpload(file: Express.Multer.File): Promise<{ headers: string[]; rows: string[][] }> {
  const name = file.originalname.toLowerCase();
  let matrix: string[][] = [];
  if (name.endsWith('.xlsx')) {
    if (file.buffer.subarray(0, 2).toString() !== 'PK') throw badRequest('File XLSX tidak valid');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(file.buffer as unknown as ArrayBuffer); } catch { throw badRequest('File Excel tidak dapat dibaca'); }
    const ws = wb.worksheets.find((w) => w.state === 'visible' && w.rowCount > 0) ?? wb.worksheets[0];
    if (!ws) throw badRequest('File Excel kosong');
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map(cellToString);
      matrix.push(vals);
    });
  } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    matrix = parsed.data.map((r) => r.map((x) => String(x ?? '').trim()));
  } else {
    throw badRequest('Format file harus .xlsx atau .csv');
  }
  matrix = matrix.filter((r) => r.some((x) => x !== ''));
  if (matrix.length < 2) throw badRequest('File tidak memiliki baris data (baris pertama harus berisi judul kolom)');
  const headers = matrix[0].map((h, i) => h || `Kolom ${i + 1}`);
  const rows = matrix.slice(1).map((r) => headers.map((_, i) => r[i] ?? ''));
  if (rows.length > MAX_ROWS) throw badRequest(`Maksimal ${MAX_ROWS} baris per impor`);
  return { headers, rows };
}

function suggestMapping(entity: Entity, headers: string[]) {
  const mapping: Record<string, number | null> = {};
  for (const f of FIELDS[entity]) {
    const aliases = [f.key, f.label, ...f.aliases].map(normKey);
    const idx = headers.findIndex((h) => aliases.includes(normKey(h)));
    mapping[f.key] = idx >= 0 ? idx : null;
  }
  return mapping;
}

/* ------------------------------------------------------------- row parsing */

function parseDateText(s: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) { // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return s; // let validation report it
}

function mapEnum(v: string, table: Record<string, string>): string | undefined {
  if (!v) return undefined;
  return table[normKey(v)] ?? v.toUpperCase();
}

function buildRecord(entity: Entity, row: string[], mapping: Record<string, number | null>) {
  const get = (k: string) => { const i = mapping[k]; return i === null || i === undefined ? '' : (row[i] ?? '').trim(); };
  if (entity === 'CUSTOMER') {
    return {
      name: get('name'), phone: get('phone'),
      type: mapEnum(get('type'), { individu: 'INDIVIDUAL', perorangan: 'INDIVIDUAL', pribadi: 'INDIVIDUAL', individual: 'INDIVIDUAL', perusahaan: 'COMPANY', company: 'COMPANY', pt: 'COMPANY', cv: 'COMPANY', korporat: 'COMPANY' }) ?? 'INDIVIDUAL',
      email: get('email') || null, address: get('address') || null,
      idType: mapEnum(get('idType'), { ktp: 'KTP', sim: 'SIM', paspor: 'PASPOR', passport: 'PASPOR', npwp: 'NPWP' }) ?? null,
      idNumber: get('idNumber') || null, contactPerson: get('contactPerson') || null, notes: get('notes') || null, status: 'ACTIVE',
    };
  }
  const rates: Record<string, string> = {};
  for (const k of Object.keys(RATE_FIELDS)) { const v = get(k); if (v) rates[k] = v; }
  return {
    plateNumber: get('plateNumber'), brand: get('brand'), model: get('model'), year: get('year') || null, color: get('color') || null,
    transmission: mapEnum(get('transmission'), { manual: 'MANUAL', mt: 'MANUAL', matic: 'AUTOMATIC', automatic: 'AUTOMATIC', otomatis: 'AUTOMATIC', at: 'AUTOMATIC', cvt: 'AUTOMATIC' }) ?? 'MANUAL',
    fuelType: mapEnum(get('fuelType'), { bensin: 'BENSIN', pertalite: 'BENSIN', pertamax: 'BENSIN', gasoline: 'BENSIN', solar: 'SOLAR', diesel: 'SOLAR', listrik: 'LISTRIK', ev: 'LISTRIK', electric: 'LISTRIK', hybrid: 'HYBRID' }) ?? 'BENSIN',
    seats: get('seats') || null, chassisNumber: get('chassisNumber') || null, engineNumber: get('engineNumber') || null,
    purchaseDate: parseDateText(get('purchaseDate')), purchasePrice: get('purchasePrice') || null, currentKm: get('currentKm') || null,
    notes: get('notes') || null, isActive: true, _rates: rates,
  };
}

const rateSchema = z.record(z.string(), z.string());

interface Analyzed {
  rowNumber: number; action: 'create' | 'update' | 'skip' | 'error'; errors: string[];
  data?: Record<string, unknown>; existingId?: string; existingLabel?: string; changes?: Record<string, { from: unknown; to: unknown }>;
  rates?: { rentalType: 'DAILY' | 'WEEKLY' | 'MONTHLY'; withDriver: boolean; price: string }[];
}

async function analyze(tx: Tx, companyId: string, entity: Entity, rows: string[][], mapping: Record<string, number | null>, duplicateMode: 'skip' | 'update'): Promise<Analyzed[]> {
  const required = FIELDS[entity].filter((f) => f.required).map((f) => f.key);
  const missing = required.filter((k) => mapping[k] === null || mapping[k] === undefined);
  if (missing.length) throw badRequest(`Kolom wajib belum dipetakan: ${missing.map((k) => FIELDS[entity].find((f) => f.key === k)!.label).join(', ')}`);

  // Load existing keys once (company-scoped) for duplicate detection
  const existing = entity === 'CUSTOMER'
    ? await tx.select().from(customers).where(eq(customers.companyId, companyId))
    : await tx.select().from(vehicles).where(eq(vehicles.companyId, companyId));
  const seen = new Map<string, number>();
  const out: Analyzed[] = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2; // +1 header, +1 one-based
    const rec = buildRecord(entity, row, mapping) as Record<string, unknown>;
    const a: Analyzed = { rowNumber, action: 'create', errors: [] };
    if (Object.values(rec).every((v) => v === null || v === '' || (typeof v === 'object' && v && !Object.keys(v).length) || v === 'ACTIVE' || v === 'INDIVIDUAL' || v === 'MANUAL' || v === 'BENSIN' || v === true)) {
      return; // fully empty row
    }
    try {
      let key: string;
      if (entity === 'CUSTOMER') {
        const r = customerInput.safeParse(rec);
        if (!r.success) { a.errors.push(...Object.entries(zodToDetails(r.error).fields).map(([k, m]) => `${FIELDS.CUSTOMER.find((f) => f.key === k)?.label ?? k}: ${m}`)); }
        else {
          const prepared = prepareCustomer(r.data);
          a.data = prepared;
          key = prepared.phoneNormalized;
          const dupIdx = seen.get(key);
          if (dupIdx) a.errors.push(`Duplikat dalam file (sama dengan baris ${dupIdx})`);
          else seen.set(key, rowNumber);
          const match = (existing as (typeof customers.$inferSelect)[]).find((c) => c.phoneNormalized === prepared.phoneNormalized || (prepared.idNumber && c.idNumber === prepared.idNumber));
          if (match) {
            a.existingId = match.id; a.existingLabel = `${match.code} ${match.name}`;
            a.action = duplicateMode;
            if (duplicateMode === 'update') a.changes = changesOf(match as Record<string, unknown>, prepared as Record<string, unknown>, ['name', 'phone', 'type', 'email', 'address', 'idType', 'idNumber', 'contactPerson', 'notes']);
          }
        }
      } else {
        const { _rates, ...vrec } = rec as Record<string, unknown> & { _rates: Record<string, string> };
        const r = vehicleInput.safeParse(vrec);
        if (!r.success) { a.errors.push(...Object.entries(zodToDetails(r.error).fields).map(([k, m]) => `${FIELDS.VEHICLE.find((f) => f.key === k)?.label ?? k}: ${m}`)); }
        else {
          let prepared;
          try { prepared = prepareVehicle(r.data); } catch (e) { a.errors.push(`Nomor Polisi: ${(e as Error).message}`); }
          if (prepared) {
            a.data = prepared;
            key = prepared.plateNormalized;
            const dupIdx = seen.get(key);
            if (dupIdx) a.errors.push(`Nomor polisi duplikat dalam file (sama dengan baris ${dupIdx})`);
            else seen.set(key, rowNumber);
            const match = (existing as (typeof vehicles.$inferSelect)[]).find((v) => v.plateNormalized === prepared.plateNormalized);
            if (match) {
              a.existingId = match.id; a.existingLabel = `${match.code} ${match.plateNumber}`;
              a.action = duplicateMode;
              if (duplicateMode === 'update') a.changes = changesOf(match as Record<string, unknown>, prepared as Record<string, unknown>, ['brand', 'model', 'year', 'color', 'transmission', 'fuelType', 'seats', 'chassisNumber', 'engineNumber', 'purchaseDate', 'purchasePrice', 'currentKm', 'notes']);
            }
          }
        }
        const rates = rateSchema.parse(_rates);
        a.rates = [];
        for (const [k, v] of Object.entries(rates)) {
          const price = zMoney.safeParse(v);
          if (price.success) a.rates.push({ ...RATE_FIELDS[k], price: price.data });
          else a.errors.push(`${FIELDS.VEHICLE.find((f) => f.key === k)?.label}: nominal tidak valid`);
        }
      }
    } catch (e) {
      a.errors.push((e as { details?: { fields?: Record<string, string> } }).details?.fields ? Object.values((e as { details: { fields: Record<string, string> } }).details.fields).join('; ') : (e as Error).message);
    }
    if (a.errors.length) a.action = 'error';
    out.push(a);
  });
  return out;
}

function changesOf(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]) {
  const ch: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    const b = before[k] ?? null; const a = after[k] ?? null;
    if (a === null || a === '' || a === undefined) continue; // empty cells never erase existing data
    if (String(b) !== String(a)) ch[k] = { from: b, to: a };
  }
  return ch;
}

const summarize = (rows: Analyzed[]) => ({
  total: rows.length,
  create: rows.filter((r) => r.action === 'create').length,
  update: rows.filter((r) => r.action === 'update').length,
  skip: rows.filter((r) => r.action === 'skip').length,
  error: rows.filter((r) => r.action === 'error').length,
  duplicates: rows.filter((r) => r.existingId).length,
});

/* ------------------------------------------------------------------ routes */

importsRouter.get('/imports/templates/:entity', async (req, res) => {
  const entity = entityParam(req);
  requireImportPerm(req, entity);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(entity === 'CUSTOMER' ? 'Customer' : 'Kendaraan');
  const fields = FIELDS[entity];
  const header = ws.addRow(fields.map((f) => f.label + (f.required ? ' *' : '')));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; });
  ws.addRow(fields.map((f) => f.example));
  fields.forEach((f, i) => { ws.getColumn(i + 1).width = Math.max(16, f.label.length + 4); ws.getColumn(i + 1).numFmt = '@'; });
  const info = wb.addWorksheet('Petunjuk');
  info.addRow(['Petunjuk pengisian']).font = { bold: true, size: 13 };
  [
    'Baris pertama berisi judul kolom. Kolom bertanda * wajib diisi.',
    'Hapus baris contoh sebelum mengunggah.',
    entity === 'CUSTOMER' ? 'No. telepon dipakai untuk mendeteksi customer duplikat (juga No. Identitas bila diisi).' : 'Nomor polisi dipakai untuk mendeteksi kendaraan duplikat.',
    'Nominal boleh ditulis 350000 atau 350.000 (tanpa "Rp").',
    'Tanggal ditulis YYYY-MM-DD atau DD/MM/YYYY.',
    entity === 'VEHICLE' ? 'Foto kendaraan diunggah terpisah melalui halaman detail kendaraan.' : 'Dokumen KTP diunggah terpisah melalui halaman detail customer.',
  ].forEach((t) => info.addRow([t]));
  info.getColumn(1).width = 100;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="template_import_${entity === 'CUSTOMER' ? 'customer' : 'kendaraan'}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

importsRouter.get('/imports', async (req, res) => {
  if (!can(req, 'customer.import') && !can(req, 'vehicle.import')) throw forbidden();
  const { companyId } = req.ctx!;
  const rows = await withTenant(companyId, (tx) => tx.execute(sql`
    select j.id, j.entity, j.file_name as "fileName", j.status, j.result, j.created_at as "createdAt", j.completed_at as "completedAt", u.name as "createdByName",
      jsonb_array_length(j.rows) as "rowCount"
    from import_jobs j left join users u on u.id = j.created_by where j.company_id = ${companyId} order by j.created_at desc limit 30`));
  res.json(rows.rows);
});

importsRouter.post('/imports/:entity/upload', upload.single('file'), async (req, res) => {
  const entity = entityParam(req);
  requireImportPerm(req, entity);
  if (!req.file) throw badRequest('File wajib diunggah');
  const { headers, rows } = await parseUpload(req.file);
  const { companyId } = req.ctx!;
  const job = await withTenant(companyId, async (tx) => {
    const [j] = await tx.insert(importJobs).values({ companyId, entity, fileName: req.file!.originalname.slice(0, 200), headers, rows, createdBy: req.user!.id }).returning();
    return j;
  });
  res.status(201).json({
    id: job.id, entity, fileName: job.fileName, headers, totalRows: rows.length, sampleRows: rows.slice(0, 10),
    fields: FIELDS[entity].map(({ key, label, required }) => ({ key, label, required: !!required })), suggestedMapping: suggestMapping(entity, headers),
  });
});

const mappingBody = z.object({
  mapping: z.record(z.string(), z.number().int().min(0).max(500).nullable()),
  duplicateMode: z.enum(['skip', 'update']).default('skip'),
});

async function loadJob(tx: Tx, companyId: string, id: string) {
  const job = await tx.query.importJobs.findFirst({ where: and(eq(importJobs.id, id), eq(importJobs.companyId, companyId)) });
  if (!job) throw notFound('Impor');
  return job;
}

importsRouter.post('/imports/:id/validate', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, mappingBody);
  const { companyId } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    const job = await loadJob(tx, companyId, id);
    requireImportPerm(req, job.entity);
    const analyzed = await analyze(tx, companyId, job.entity, job.rows, input.mapping, input.duplicateMode);
    await tx.update(importJobs).set({ mapping: input.mapping, duplicateMode: input.duplicateMode }).where(eq(importJobs.id, id));
    return {
      summary: summarize(analyzed),
      rows: analyzed.slice(0, 1000).map(({ rowNumber, action, errors, existingLabel, changes, data }) => ({
        rowNumber, action, errors, existingLabel, changes,
        label: data ? (job.entity === 'CUSTOMER' ? `${data.name} (${data.phone})` : `${data.plateNumber} ${data.brand} ${data.model}`) : null,
      })),
    };
  });
  res.json(result);
});

importsRouter.post('/imports/:id/commit', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, mappingBody);
  const { companyId, timezone } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    await tx.execute(sql`select 1 from import_jobs where id = ${id} for update`);
    const job = await loadJob(tx, companyId, id);
    requireImportPerm(req, job.entity);
    if (job.status !== 'PREVIEW') throw badRequest('Impor ini sudah diproses');
    const analyzed = await analyze(tx, companyId, job.entity, job.rows, input.mapping, input.duplicateMode);
    const hasRates = analyzed.some((a) => a.rates?.length && a.action !== 'error');
    if (job.entity === 'VEHICLE' && hasRates && !can(req, 'rate.manage')) throw forbidden('Impor tarif memerlukan izin mengubah tarif');
    const settings = await getSettings(tx, companyId);
    let created = 0; let updated = 0;
    // Single DB transaction: either every valid row is written, or nothing is.
    for (const a of analyzed) {
      if (a.action === 'create') {
        if (job.entity === 'CUSTOMER') {
          const code = await nextNumber(tx, companyId, 'CUSTOMER', settings, timezone);
          await tx.insert(customers).values({ ...(a.data as ReturnType<typeof prepareCustomer>), companyId, code, createdBy: req.user!.id, updatedBy: req.user!.id });
        } else {
          const code = await nextNumber(tx, companyId, 'VEHICLE', settings, timezone);
          const [v] = await tx.insert(vehicles).values({ ...(a.data as ReturnType<typeof prepareVehicle>), companyId, code, createdBy: req.user!.id, updatedBy: req.user!.id }).returning();
          if (a.rates?.length) await saveRates(tx, req, companyId, v.id, a.rates);
        }
        created++;
      } else if (a.action === 'update' && a.existingId) {
        const patch = Object.fromEntries(Object.entries(a.changes ?? {}).map(([k, v]) => [k, v.to]));
        if (job.entity === 'CUSTOMER') {
          if (patch.phone) patch.phoneNormalized = normalizePhone(String(patch.phone));
          if (Object.keys(patch).length) await tx.update(customers).set({ ...patch, updatedBy: req.user!.id }).where(eq(customers.id, a.existingId));
        } else {
          if (Object.keys(patch).length) await tx.update(vehicles).set({ ...patch, updatedBy: req.user!.id }).where(eq(vehicles.id, a.existingId));
          if (a.rates?.length) await saveRates(tx, req, companyId, a.existingId, a.rates);
        }
        if (Object.keys(patch).length || a.rates?.length) updated++;
      }
    }
    const summary = { ...summarize(analyzed), created, updated };
    const errorRows = analyzed.filter((a) => a.action === 'error').map((a) => ({ rowNumber: a.rowNumber, errors: a.errors }));
    await tx.update(importJobs).set({ status: 'COMPLETED', mapping: input.mapping, duplicateMode: input.duplicateMode, result: { summary, errorRows }, completedAt: new Date() })
      .where(eq(importJobs.id, id));
    await audit(tx, req, {
      action: 'import.commit', entityType: 'import', entityId: id,
      summary: `Impor ${job.entity === 'CUSTOMER' ? 'customer' : 'kendaraan'} "${job.fileName}": ${created} baru, ${updated} diperbarui, ${summary.skip} dilewati, ${summary.error} error`,
      after: summary,
    });
    return { summary, errorRows: errorRows.slice(0, 200) };
  });
  res.json(result);
});

/** Downloadable error report: original columns + row number + error messages. */
importsRouter.get('/imports/:id/errors', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  const job = await withTenant(companyId, (tx) => loadJob(tx, companyId, id));
  requireImportPerm(req, job.entity);
  let errorRows = (job.result as { errorRows?: { rowNumber: number; errors: string[] }[] } | null)?.errorRows;
  if (!errorRows && job.mapping) {
    const analyzed = await withTenant(companyId, (tx) => analyze(tx, companyId, job.entity, job.rows, job.mapping as Record<string, number | null>, (job.duplicateMode as 'skip' | 'update') ?? 'skip'));
    errorRows = analyzed.filter((a) => a.action === 'error').map((a) => ({ rowNumber: a.rowNumber, errors: a.errors }));
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Error');
  const h = ws.addRow(['Baris', 'Kesalahan', ...job.headers]);
  h.font = { bold: true };
  for (const e of errorRows ?? []) ws.addRow([e.rowNumber, e.errors.join('; '), ...(job.rows[e.rowNumber - 2] ?? [])]);
  ws.getColumn(2).width = 60;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="error_impor_${id.slice(0, 8)}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

void normalizePlate;
