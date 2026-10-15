/**
 * Seed data for development / testing.
 *   npm run db:seed            → creates demo companies, users and operational data (only on an empty DB)
 *   npm run db:seed -- --reset → wipes ALL data first (refused when NODE_ENV=production)
 *
 * Demo password comes from SEED_DEMO_PASSWORD; when unset a random one is generated and printed.
 * Never run this against production unless SEED_ALLOW_PRODUCTION=true (it will not reset production).
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, pool, type Tx } from './client.js';
import { runMigrations } from './migrate.js';
import {
  companies, users, companyMemberships, customers, vehicles, vehicleRates, rentalTransactions, reservations, payments, expenses,
  maintenanceRecords, drivers, vehicleHandovers, vehicleReturns, cashAccounts, expenseCategories, otherIncomes,
} from './schema.js';
import { hashPassword, passwordPolicyError } from '../auth/password.js';
import { bootstrapCompany } from '../services/company.js';
import { upsertBlock } from '../services/schedule.js';
import { nextNumber } from '../lib/numbering.js';
import { getSettings } from '../lib/settings.js';
import { quote, lateFee, type RentalType } from '../lib/pricing.js';
import { normalizePhone, normalizePlate } from '../lib/normalize.js';
import { D } from '../lib/money.js';
import type { Role } from '../auth/permissions.js';

const isProd = process.env.NODE_ENV === 'production';
const RESET = process.argv.includes('--reset');
const TZ = 'Asia/Jakarta';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Today 09:00 Jakarta time + offset days/hours */
function at(days: number, hour = 9): Date {
  const now = new Date();
  const jkt = new Date(now.getTime() + 7 * HOUR);
  const base = Date.UTC(jkt.getUTCFullYear(), jkt.getUTCMonth(), jkt.getUTCDate(), hour - 7, 0, 0);
  return new Date(base + days * DAY);
}

async function main() {
  if (isProd && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Seed ditolak di production. Set SEED_ALLOW_PRODUCTION=true bila benar-benar diperlukan.');
  }
  if (RESET && isProd) throw new Error('--reset tidak diizinkan di production');
  await runMigrations();

  if (RESET) {
    console.log('… menghapus seluruh data (reset)');
    await db.execute(sql`
      alter table payments disable trigger payments_guard;
      alter table expenses disable trigger expenses_guard;
      alter table other_incomes disable trigger other_incomes_guard;
      alter table rental_transactions disable trigger rentals_no_delete;
      alter table reservations disable trigger reservations_no_delete;
      alter table audit_logs disable trigger audit_logs_append_only;
      truncate companies, users, sessions, password_tokens, company_memberships, role_permissions, company_settings, document_sequences,
        file_attachments, cash_accounts, expense_categories, customers, vehicles, vehicle_rates, drivers, reservations, rental_transactions,
        vehicle_handovers, vehicle_returns, vehicle_schedule_blocks, payments, expenses, other_incomes, maintenance_records, import_jobs, audit_logs cascade;
      alter table payments enable trigger payments_guard;
      alter table expenses enable trigger expenses_guard;
      alter table other_incomes enable trigger other_incomes_guard;
      alter table rental_transactions enable trigger rentals_no_delete;
      alter table reservations enable trigger reservations_no_delete;
      alter table audit_logs enable trigger audit_logs_append_only;`);
  } else {
    const existing = await db.select({ n: sql<number>`count(*)::int` }).from(companies);
    if (existing[0].n > 0) {
      console.log('Database sudah berisi data — seed dilewati. Gunakan --reset untuk mengisi ulang (bukan production).');
      return;
    }
  }

  let password = process.env.SEED_DEMO_PASSWORD;
  if (!password) password = `Demo-${crypto.randomBytes(6).toString('base64url')}9a`;
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(`SEED_DEMO_PASSWORD tidak memenuhi kebijakan password: ${policy}`);
  const passwordHash = await hashPassword(password);

  const mkUser = async (email: string, name: string, superAdmin = false) =>
    (await db.insert(users).values({ email, name, passwordHash, isSuperAdmin: superAdmin }).returning())[0];

  const superAdmin = await mkUser('superadmin@rental.local', 'Super Admin', true);
  const accounts: { email: string; name: string; memberships: [string, Role][] }[] = [
    { email: 'owner@nusantara.demo', name: 'Andi Wijaya', memberships: [['nusantara', 'OWNER']] },
    { email: 'admin@nusantara.demo', name: 'Sari Lestari', memberships: [['nusantara', 'ADMIN']] },
    { email: 'finance@nusantara.demo', name: 'Rina Kusuma', memberships: [['nusantara', 'FINANCE']] },
    { email: 'operator@nusantara.demo', name: 'Dedi Pratama', memberships: [['nusantara', 'OPERATOR']] },
    { email: 'viewer@nusantara.demo', name: 'Maya Putri', memberships: [['nusantara', 'VIEWER']] },
    { email: 'owner@mobilprima.demo', name: 'Hendra Gunawan', memberships: [['mobil-prima', 'OWNER']] },
    { email: 'owner@transportmandiri.demo', name: 'Yusuf Hakim', memberships: [['transport-mandiri', 'OWNER']] },
    // one email, several companies → demonstrates the Company Switcher
    { email: 'multi@demo.local', name: 'Lina Hartono', memberships: [['nusantara', 'FINANCE'], ['mobil-prima', 'ADMIN'], ['transport-mandiri', 'VIEWER']] },
  ];

  const companyDefs = [
    { slug: 'nusantara', name: 'PT Rental Nusantara', address: 'Jl. Gatot Subroto Kav. 21', city: 'Jakarta Selatan', phone: '021-5550-1234', email: 'info@rentalnusantara.co.id', npwp: '01.234.567.8-901.000',
      bankAccounts: [{ bank: 'BCA', accountNumber: '123-456-7890', accountHolder: 'PT Rental Nusantara' }, { bank: 'Mandiri', accountNumber: '130-00-1234567-8', accountHolder: 'PT Rental Nusantara' }] },
    { slug: 'mobil-prima', name: 'CV Mobil Prima', address: 'Jl. Pemuda No. 88', city: 'Semarang', phone: '024-355-8899', email: 'halo@mobilprima.id', npwp: null,
      bankAccounts: [{ bank: 'BRI', accountNumber: '0021-01-000123-30-1', accountHolder: 'CV Mobil Prima' }] },
    { slug: 'transport-mandiri', name: 'PT Transport Mandiri', address: 'Jl. Diponegoro No. 5', city: 'Surabaya', phone: '031-500-7788', email: 'cs@transportmandiri.co.id', npwp: null, bankAccounts: [] },
  ];

  const companyIds: Record<string, string> = {};
  for (const def of companyDefs) {
    await db.transaction(async (tx) => {
      const [c] = await tx.insert(companies).values(def).returning();
      companyIds[def.slug] = c.id;
      await bootstrapCompany(tx, c.id, superAdmin.id);
    });
  }
  for (const a of accounts) {
    const u = await mkUser(a.email, a.name);
    for (const [slug, role] of a.memberships) {
      await db.insert(companyMemberships).values({ companyId: companyIds[slug], userId: u.id, role, invitedBy: superAdmin.id });
    }
  }

  await seedNusantara(companyIds.nusantara);
  await seedPrima(companyIds['mobil-prima']);

  console.log('\n✔ Seed selesai. Akun demo (password sama untuk semua akun):');
  console.log(`  Password: ${password}${process.env.SEED_DEMO_PASSWORD ? ' (dari SEED_DEMO_PASSWORD)' : ' (acak — simpan sekarang)'}`);
  for (const e of ['superadmin@rental.local', ...accounts.map((a) => a.email)]) console.log(`  • ${e}`);
}

/* ------------------------------------------------------------------ helpers */

interface Ctx { tx: Tx; companyId: string; userId: string | null }

async function tenant<T>(companyId: string, fn: (ctx: Ctx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn({ tx, companyId, userId: null });
  });
}

const RATE_TYPES: [RentalType, boolean][] = [['DAILY', false], ['WEEKLY', false], ['MONTHLY', false], ['DAILY', true], ['WEEKLY', true], ['MONTHLY', true]];

async function addVehicle(ctx: Ctx, v: { plate: string; brand: string; model: string; year: number; color: string; transmission: 'MANUAL' | 'AUTOMATIC'; seats: number; daily: number; km: number; fuel?: 'BENSIN' | 'SOLAR' | 'LISTRIK' | 'HYBRID'; price?: number }) {
  const settings = await getSettings(ctx.tx, ctx.companyId);
  const code = await nextNumber(ctx.tx, ctx.companyId, 'VEHICLE', settings, TZ);
  const plate = normalizePlate(v.plate)!;
  const [row] = await ctx.tx.insert(vehicles).values({
    companyId: ctx.companyId, code, plateNumber: plate.display, plateNormalized: plate.normalized, brand: v.brand, model: v.model, year: v.year,
    color: v.color, transmission: v.transmission, fuelType: v.fuel ?? 'BENSIN', seats: v.seats, currentKm: v.km,
    purchaseDate: `${v.year}-0${(v.year % 9) + 1}-15`, purchasePrice: v.price ? String(v.price) : null,
  }).returning();
  const prices: Record<string, number> = {
    'DAILY-false': v.daily, 'WEEKLY-false': v.daily * 6, 'MONTHLY-false': v.daily * 22,
    'DAILY-true': v.daily + 200_000, 'WEEKLY-true': (v.daily + 200_000) * 6, 'MONTHLY-true': (v.daily + 200_000) * 22,
  };
  await ctx.tx.insert(vehicleRates).values(RATE_TYPES.map(([t, d]) => ({ companyId: ctx.companyId, vehicleId: row.id, rentalType: t, withDriver: d, price: String(prices[`${t}-${d}`]) })));
  return { ...row, daily: v.daily };
}

async function addCustomer(ctx: Ctx, c: { name: string; phone: string; type?: 'INDIVIDUAL' | 'COMPANY'; email?: string; address?: string; idNumber?: string; contactPerson?: string; status?: 'ACTIVE' | 'BLACKLISTED' }) {
  const code = await nextNumber(ctx.tx, ctx.companyId, 'CUSTOMER', await getSettings(ctx.tx, ctx.companyId), TZ);
  const [row] = await ctx.tx.insert(customers).values({
    companyId: ctx.companyId, code, type: c.type ?? 'INDIVIDUAL', name: c.name, phone: c.phone, phoneNormalized: normalizePhone(c.phone)!,
    email: c.email, address: c.address, idType: c.idNumber ? (c.type === 'COMPANY' ? 'NPWP' : 'KTP') : null, idNumber: c.idNumber, contactPerson: c.contactPerson, status: c.status ?? 'ACTIVE',
  }).returning();
  return row;
}

const custSnap = (c: typeof customers.$inferSelect) => ({ id: c.id, code: c.code, type: c.type, name: c.name, contactPerson: c.contactPerson, phone: c.phone, email: c.email, address: c.address, idType: c.idType, idNumber: c.idNumber });
const vehSnap = (v: typeof vehicles.$inferSelect) => ({ id: v.id, code: v.code, plateNumber: v.plateNumber, brand: v.brand, model: v.model, year: v.year, color: v.color, transmission: v.transmission, fuelType: v.fuelType, seats: v.seats });

async function compSnap(ctx: Ctx) {
  const c = (await ctx.tx.execute(sql`select * from companies where id = ${ctx.companyId}`)).rows[0] as Record<string, unknown>;
  return { name: c.name, address: c.address, city: c.city, phone: c.phone, email: c.email, website: c.website, npwp: c.npwp, bankAccounts: c.bank_accounts, logoFileId: c.logo_file_id, timezone: c.timezone };
}

async function pay(ctx: Ctx, r: { id: string; customerId: string }, amount: number | string, paidAt: Date, method: string, accountId: string, dp = false) {
  const settings = await getSettings(ctx.tx, ctx.companyId);
  const number = await nextNumber(ctx.tx, ctx.companyId, 'PAYMENT', settings, TZ, paidAt);
  await ctx.tx.insert(payments).values({
    companyId: ctx.companyId, number, kind: 'PAYMENT', isDownPayment: dp, rentalId: r.id, customerId: r.customerId, paidAt, method,
    cashAccountId: accountId, amount: D(amount).toFixed(2), reference: method === 'TRANSFER' ? `TRF${Math.floor(paidAt.getTime() / 1000) % 1000000}` : null,
  });
}

interface RentalSpec {
  customer: typeof customers.$inferSelect; vehicle: Awaited<ReturnType<typeof addVehicle>>; start: Date; end: Date;
  type?: RentalType; withDriver?: boolean; discount?: number; extra?: number;
  state: 'SCHEDULED' | 'ONGOING' | 'RETURNED' | 'COMPLETED' | 'CANCELLED';
  returnAt?: Date; damage?: number; payments?: [number | 'FULL' | 'REST', number, string, boolean?][]; // [amount, dayOffsetFromStart, method, isDp]
}

async function addRental(ctx: Ctx, s: RentalSpec, accounts: { cash: string; bank: string }) {
  const settings = await getSettings(ctx.tx, ctx.companyId);
  const type = s.type ?? 'DAILY';
  const withDriver = s.withDriver ?? false;
  const rate = (await ctx.tx.execute<{ price: string }>(sql`select price from vehicle_rates where vehicle_id = ${s.vehicle.id} and rental_type = ${type} and with_driver = ${withDriver}`)).rows[0].price;
  const daily = (await ctx.tx.execute<{ price: string }>(sql`select price from vehicle_rates where vehicle_id = ${s.vehicle.id} and rental_type = 'DAILY' and with_driver = ${withDriver}`)).rows[0].price;
  const createdAt = new Date(s.start.getTime() - 3 * DAY);
  const q = quote({ startAt: s.start, endAt: s.end, rentalType: type, unitPrice: rate, discount: s.discount, extraCharges: s.extra, taxPercent: 0, graceMinutes: settings.graceMinutes, decimals: 0 });
  const [r] = await ctx.tx.insert(rentalTransactions).values({
    companyId: ctx.companyId,
    number: await nextNumber(ctx.tx, ctx.companyId, 'RENTAL', settings, TZ, createdAt),
    invoiceNumber: await nextNumber(ctx.tx, ctx.companyId, 'INVOICE', settings, TZ, createdAt),
    contractNumber: await nextNumber(ctx.tx, ctx.companyId, 'CONTRACT', settings, TZ, createdAt),
    customerId: s.customer.id, vehicleId: s.vehicle.id, startAt: s.start, endAt: s.end, rentalType: type, withDriver,
    pickupLocation: 'Kantor pusat', returnLocation: 'Kantor pusat', unitPrice: q.unitPrice, quantity: q.quantity, subtotal: q.subtotal,
    discount: q.discount, extraCharges: q.extraCharges, extraChargesNote: s.extra ? 'Antar-jemput bandara' : null, taxPercent: '0', taxAmount: q.taxAmount,
    dailyRateSnapshot: daily, total: q.total, status: 'SCHEDULED', customerSnapshot: custSnap(s.customer), vehicleSnapshot: vehSnap(s.vehicle),
    companySnapshot: await compSnap(ctx), createdAt,
  }).returning();
  let total = D(q.total);
  if (s.state === 'CANCELLED') {
    await ctx.tx.update(rentalTransactions).set({ status: 'CANCELLED', cancelledAt: new Date(s.start.getTime() - DAY), cancelledReason: 'Customer membatalkan perjalanan' }).where(sql`id = ${r.id}`);
    await upsertBlock(ctx.tx, ctx.companyId, { vehicleId: s.vehicle.id, type: 'RENTAL', id: r.id, start: s.start, end: s.end, active: false });
    return r;
  }
  let blockEnd = s.end;
  if (s.state !== 'SCHEDULED') {
    await ctx.tx.insert(vehicleHandovers).values({ companyId: ctx.companyId, rentalId: r.id, handedAt: s.start, km: s.vehicle.currentKm, fuelLevel: 'Penuh', checklist: { stnk: true, banSerep: true, dongkrak: true, kebersihan: true }, staffName: 'Dedi Pratama', receiverName: s.customer.name });
    await ctx.tx.update(rentalTransactions).set({ status: 'ONGOING', actualStartAt: s.start }).where(sql`id = ${r.id}`);
  }
  if (s.state === 'RETURNED' || s.state === 'COMPLETED') {
    const returnedAt = s.returnAt ?? s.end;
    const lf = lateFee({ plannedEnd: s.end, actualEnd: returnedAt, graceMinutes: settings.graceMinutes, mode: 'PER_DAY', dailyRate: daily, hourlyRate: 0 });
    const q2 = quote({ startAt: s.start, endAt: s.end, rentalType: type, unitPrice: rate, quantity: q.quantity, discount: s.discount, extraCharges: s.extra, lateFee: lf.fee, damageFee: s.damage, taxPercent: 0, graceMinutes: settings.graceMinutes, decimals: 0 });
    total = D(q2.total);
    await ctx.tx.insert(vehicleReturns).values({ companyId: ctx.companyId, rentalId: r.id, returnedAt, km: (s.vehicle.currentKm ?? 0) + 350, fuelLevel: 'Penuh', lateMinutes: lf.lateMinutes, lateFee: lf.fee, damageFee: q2.damageFee, damageNotes: s.damage ? 'Baret pada bumper belakang' : null, checklist: { stnk: true, banSerep: true }, staffName: 'Dedi Pratama', returnerName: s.customer.name });
    await ctx.tx.update(rentalTransactions).set({ status: 'RETURNED', actualEndAt: returnedAt, lateFee: q2.lateFee, damageFee: q2.damageFee, total: q2.total }).where(sql`id = ${r.id}`);
    blockEnd = returnedAt;
  }
  await upsertBlock(ctx.tx, ctx.companyId, { vehicleId: s.vehicle.id, type: 'RENTAL', id: r.id, start: s.start, end: blockEnd, active: true });
  let paid = D(0);
  for (const [amt, off, method, dp] of s.payments ?? []) {
    const amount = amt === 'FULL' ? total : amt === 'REST' ? total.minus(paid) : D(amt);
    if (amount.lte(0)) continue;
    const when = new Date(s.start.getTime() + off * DAY + 2 * HOUR);
    await pay(ctx, { id: r.id, customerId: s.customer.id }, amount.toFixed(2), when > new Date() ? new Date(Date.now() - HOUR) : when, method, method === 'CASH' ? accounts.cash : accounts.bank, dp);
    paid = paid.plus(amount);
  }
  if (s.state === 'COMPLETED') await ctx.tx.update(rentalTransactions).set({ status: 'COMPLETED', completedAt: s.returnAt ?? s.end }).where(sql`id = ${r.id}`);
  return r;
}

async function addExpense(ctx: Ctx, code: string, date: Date, description: string, amount: number, vehicleId: string | null, accountId: string, method = 'CASH') {
  if (date.getTime() > Date.now()) return; // no future-dated expenses
  const settings = await getSettings(ctx.tx, ctx.companyId);
  const cat = (await ctx.tx.execute<{ id: string }>(sql`select id from expense_categories where company_id = ${ctx.companyId} and code = ${code}`)).rows[0];
  const d = new Date(date.getTime() + 7 * HOUR).toISOString().slice(0, 10);
  await ctx.tx.insert(expenses).values({
    companyId: ctx.companyId, number: await nextNumber(ctx.tx, ctx.companyId, 'EXPENSE', settings, TZ, date), expenseDate: d, categoryId: cat.id,
    vehicleId, description, amount: String(amount), method, cashAccountId: accountId,
  });
}

/* ------------------------------------------------------- PT Rental Nusantara */

async function seedNusantara(companyId: string) {
  await tenant(companyId, async (ctx) => {
    const [bank] = await ctx.tx.insert(cashAccounts).values({ companyId, name: 'BCA Operasional', type: 'BANK', bankName: 'BCA', accountNumber: '123-456-7890', accountHolder: 'PT Rental Nusantara' }).returning();
    await ctx.tx.insert(cashAccounts).values({ companyId, name: 'QRIS Mandiri', type: 'EWALLET', bankName: 'Mandiri' });
    const cash = (await ctx.tx.execute<{ id: string }>(sql`select id from cash_accounts where company_id = ${companyId} and name = 'Kas Tunai'`)).rows[0].id;
    const acc = { cash, bank: bank.id };

    const V = [
      await addVehicle(ctx, { plate: 'B 1234 RNA', brand: 'Toyota', model: 'Avanza 1.5 G', year: 2022, color: 'Hitam', transmission: 'MANUAL', seats: 7, daily: 350_000, km: 42_150, price: 235_000_000 }),
      await addVehicle(ctx, { plate: 'B 2345 RNB', brand: 'Toyota', model: 'Innova Zenix 2.0 V', year: 2023, color: 'Putih', transmission: 'AUTOMATIC', seats: 7, daily: 650_000, km: 18_400, price: 470_000_000 }),
      await addVehicle(ctx, { plate: 'B 3456 RNC', brand: 'Honda', model: 'Brio Satya E', year: 2021, color: 'Merah', transmission: 'AUTOMATIC', seats: 5, daily: 275_000, km: 61_020, price: 175_000_000 }),
      await addVehicle(ctx, { plate: 'B 4567 RND', brand: 'Mitsubishi', model: 'Xpander Ultimate', year: 2023, color: 'Abu-abu', transmission: 'AUTOMATIC', seats: 7, daily: 450_000, km: 22_800, price: 320_000_000 }),
      await addVehicle(ctx, { plate: 'B 5678 RNE', brand: 'Toyota', model: 'Hiace Premio', year: 2022, color: 'Putih', transmission: 'MANUAL', seats: 14, daily: 1_250_000, km: 55_300, fuel: 'SOLAR', price: 650_000_000 }),
      await addVehicle(ctx, { plate: 'B 6789 RNF', brand: 'Daihatsu', model: 'Xenia 1.3 R', year: 2020, color: 'Silver', transmission: 'MANUAL', seats: 7, daily: 300_000, km: 88_750, price: 190_000_000 }),
      await addVehicle(ctx, { plate: 'B 7890 RNG', brand: 'Toyota', model: 'Fortuner 2.8 VRZ', year: 2023, color: 'Hitam', transmission: 'AUTOMATIC', seats: 7, daily: 1_100_000, km: 15_900, fuel: 'SOLAR', price: 600_000_000 }),
      await addVehicle(ctx, { plate: 'B 8901 RNH', brand: 'Hyundai', model: 'Ioniq 5 Signature', year: 2024, color: 'Biru', transmission: 'AUTOMATIC', seats: 5, daily: 950_000, km: 9_200, fuel: 'LISTRIK', price: 780_000_000 }),
    ];

    const C = [
      await addCustomer(ctx, { name: 'Budi Santoso', phone: '0812-3456-7890', email: 'budi.santoso@example.com', address: 'Jl. Kemang Raya No. 10, Jakarta Selatan', idNumber: '3174011203850001' }),
      await addCustomer(ctx, { name: 'Siti Rahmawati', phone: '0813-2222-3344', email: 'siti.r@example.com', address: 'Jl. Margonda Raya 120, Depok', idNumber: '3276024508900002' }),
      await addCustomer(ctx, { name: 'PT Sinar Logistik Abadi', type: 'COMPANY', phone: '021-7788-9900', email: 'procurement@sinarlogistik.co.id', address: 'Kawasan Industri Pulogadung Blok C-5, Jakarta Timur', idNumber: '02.345.678.9-012.000', contactPerson: 'Agus Salim' }),
      await addCustomer(ctx, { name: 'Rudi Hartanto', phone: '0857-1111-2020', address: 'Jl. Fatmawati 45, Jakarta Selatan', idNumber: '3174050101880003' }),
      await addCustomer(ctx, { name: 'Dewi Anggraini', phone: '0821-9876-5432', email: 'dewi.a@example.com', address: 'Perumahan Bintaro Sektor 9, Tangerang Selatan', idNumber: '3674036606920004' }),
      await addCustomer(ctx, { name: 'CV Karya Wisata Mandiri', type: 'COMPANY', phone: '0811-8000-123', email: 'booking@karyawisata.id', address: 'Jl. Pramuka 33, Jakarta Pusat', contactPerson: 'Fitri' }),
      await addCustomer(ctx, { name: 'Ahmad Fauzi', phone: '0878-5555-6767', address: 'Jl. Raya Bogor Km 25, Jakarta Timur', idNumber: '3175061512870005' }),
      await addCustomer(ctx, { name: 'Linda Wijayanti', phone: '0819-3030-4040', email: 'linda.w@example.com', address: 'Apartemen Kalibata City Tower B, Jakarta Selatan', idNumber: '3174074409950006' }),
      await addCustomer(ctx, { name: 'Joko Susilo', phone: '0852-7000-8000', address: 'Jl. Cikini Raya 2, Jakarta Pusat', idNumber: '3171012003800007', status: 'BLACKLISTED' }),
      await addCustomer(ctx, { name: 'PT Mega Event Organizer', type: 'COMPANY', phone: '021-2929-3939', email: 'ops@megaevent.co.id', address: 'Jl. Sudirman Kav. 52, Jakarta Selatan', contactPerson: 'Bayu' }),
    ];

    // Completed rentals in previous months (history for charts)
    const hist: [number, number, number, number, number?][] = [ // [cust, veh, startDayOffset, days, discount]
      [0, 0, -150, 3], [2, 4, -140, 2], [1, 2, -128, 4], [3, 5, -118, 2], [5, 4, -105, 3, 250_000], [4, 1, -96, 5], [9, 6, -88, 2],
      [0, 3, -80, 3], [7, 7, -74, 2], [2, 1, -66, 7], [6, 0, -59, 2], [1, 3, -52, 3], [5, 4, -47, 2], [3, 2, -41, 4], [9, 6, -36, 3],
      [4, 7, -31, 2], [0, 1, -26, 3], [2, 4, -22, 2], [7, 5, -18, 3], [6, 3, -15, 2], [1, 0, -12, 4], [9, 6, -9, 2, 200_000],
    ];
    for (const [ci, vi, off, days, disc] of hist) {
      await addRental(ctx, { customer: C[ci], vehicle: V[vi], start: at(off), end: at(off + days), discount: disc, state: 'COMPLETED',
        payments: [[Math.round(V[vi].daily * days * 0.3 / 1000) * 1000, -2, 'TRANSFER', true], ['REST', days, ci % 2 ? 'CASH' : 'TRANSFER']] }, acc);
    }
    // Late return with late fee, paid in full
    await addRental(ctx, { customer: C[3], vehicle: V[2], start: at(-7), end: at(-5), returnAt: at(-4, 13), state: 'COMPLETED', payments: [['FULL', 3, 'CASH']] }, acc);
    // Returned with damage fee, still owing → receivable
    await addRental(ctx, { customer: C[7], vehicle: V[5], start: at(-6), end: at(-3), damage: 500_000, state: 'RETURNED', payments: [[400_000, -1, 'TRANSFER', true]] }, acc);
    // Corporate monthly rental, ongoing, partial payment
    await addRental(ctx, { customer: C[2], vehicle: V[1], start: at(-10), end: at(20), type: 'MONTHLY', state: 'ONGOING', payments: [[10_000_000, 0, 'TRANSFER'], [5_000_000, 7, 'TRANSFER']] }, acc);
    // Ongoing with driver
    await addRental(ctx, { customer: C[5], vehicle: V[4], start: at(-1, 7), end: at(2, 19), withDriver: true, extra: 300_000, state: 'ONGOING', payments: [[2_000_000, -2, 'TRANSFER', true]] }, acc);
    // Overdue: should have come back yesterday
    await addRental(ctx, { customer: C[0], vehicle: V[0], start: at(-4), end: at(-1, 17), state: 'ONGOING', payments: [['FULL', 0, 'QRIS']] }, acc);
    // Returning today
    await addRental(ctx, { customer: C[4], vehicle: V[3], start: at(-2), end: at(0, 18), state: 'ONGOING', payments: [[450_000, -1, 'TRANSFER', true]] }, acc);
    // Scheduled pickups
    await addRental(ctx, { customer: C[1], vehicle: V[6], start: at(0, 14), end: at(3, 14), state: 'SCHEDULED', payments: [[1_000_000, -1, 'TRANSFER', true]] }, acc);
    await addRental(ctx, { customer: C[9], vehicle: V[7], start: at(5), end: at(8), state: 'SCHEDULED' }, acc);
    // Cancelled booking (does not block the schedule)
    await addRental(ctx, { customer: C[6], vehicle: V[6], start: at(10), end: at(12), state: 'CANCELLED' }, acc);

    // Reservations
    const settings = await getSettings(ctx.tx, companyId);
    const mkRes = async (ci: number, vi: number, startOff: number, days: number, status: 'DRAFT' | 'PENDING' | 'CONFIRMED' | 'CANCELLED', dp = 0) => {
      const rate = (await ctx.tx.execute<{ price: string }>(sql`select price from vehicle_rates where vehicle_id = ${V[vi].id} and rental_type = 'DAILY' and with_driver = false`)).rows[0].price;
      const q = quote({ startAt: at(startOff), endAt: at(startOff + days), rentalType: 'DAILY', unitPrice: rate, graceMinutes: 60, decimals: 0 });
      const [r] = await ctx.tx.insert(reservations).values({
        companyId, number: await nextNumber(ctx.tx, companyId, 'RESERVATION', settings, TZ), customerId: C[ci].id, vehicleId: V[vi].id,
        startAt: at(startOff), endAt: at(startOff + days), rentalType: 'DAILY', withDriver: false, unitPrice: q.unitPrice, quantity: q.quantity,
        subtotal: q.subtotal, discount: '0', extraCharges: '0', taxPercent: '0', taxAmount: '0', total: q.total, dpAmount: String(dp), status,
        pickupLocation: 'Bandara Soekarno-Hatta T3', returnLocation: 'Kantor pusat', customerSnapshot: custSnap(C[ci]), vehicleSnapshot: vehSnap(V[vi]), companySnapshot: await compSnap(ctx),
        ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelledReason: 'Jadwal customer berubah' } : {}),
      }).returning();
      await upsertBlock(ctx.tx, companyId, { vehicleId: V[vi].id, type: 'RESERVATION', id: r.id, start: r.startAt, end: r.endAt, active: status === 'PENDING' || status === 'CONFIRMED' });
      if (dp > 0) {
        await ctx.tx.insert(payments).values({ companyId, number: await nextNumber(ctx.tx, companyId, 'PAYMENT', settings, TZ), kind: 'PAYMENT', isDownPayment: true,
          reservationId: r.id, customerId: C[ci].id, paidAt: new Date(Date.now() - 2 * HOUR), method: 'TRANSFER', cashAccountId: bank.id, amount: String(dp), reference: 'DP reservasi' });
      }
    };
    await mkRes(7, 2, 4, 3, 'CONFIRMED', 300_000);
    await mkRes(4, 0, 6, 2, 'PENDING');
    await mkRes(1, 3, 9, 4, 'CONFIRMED', 500_000);
    await mkRes(3, 5, 12, 2, 'DRAFT');
    await mkRes(0, 1, 15, 2, 'CANCELLED');

    // Maintenance: one finished, one in progress (blocks vehicle now), one scheduled
    const mk = async (vi: number, startOff: number, endOff: number | null, status: 'SCHEDULED' | 'IN_PROGRESS' | 'DONE', type: string, cost: number, next?: [number, number]) => {
      const startAt = at(startOff, 8);
      const endAt = endOff === null ? null : at(endOff, 17);
      const [m] = await ctx.tx.insert(maintenanceRecords).values({
        companyId, number: await nextNumber(ctx.tx, companyId, 'MAINTENANCE', settings, TZ, startAt), vehicleId: V[vi].id, startAt, endAt,
        completedAt: status === 'DONE' ? endAt : null, status, serviceType: type, km: V[vi].currentKm, workshop: 'Auto2000 Fatmawati', cost: String(cost),
        nextServiceDate: next ? new Date(at(next[0]).getTime() + 7 * HOUR).toISOString().slice(0, 10) : null, nextServiceKm: next ? next[1] : null,
      }).returning();
      await upsertBlock(ctx.tx, companyId, { vehicleId: V[vi].id, type: 'MAINTENANCE', id: m.id, start: startAt, end: endAt, active: true });
      if (cost > 0 && status === 'DONE') {
        const cat = (await ctx.tx.execute<{ id: string }>(sql`select id from expense_categories where company_id = ${companyId} and code = 'SERVIS'`)).rows[0];
        await ctx.tx.insert(expenses).values({ companyId, number: await nextNumber(ctx.tx, companyId, 'EXPENSE', settings, TZ, startAt),
          expenseDate: new Date(startAt.getTime() + 7 * HOUR).toISOString().slice(0, 10), categoryId: cat.id, vehicleId: V[vi].id, maintenanceId: m.id,
          description: `${type} — ${V[vi].plateNumber} (${m.number})`, amount: String(cost), method: 'TRANSFER', cashAccountId: bank.id });
      }
    };
    await mk(5, -45, -44, 'DONE', 'Servis berkala 80.000 km', 2_350_000, [-2, 90_000]);
    await mk(0, -63, -62, 'DONE', 'Ganti oli & filter', 850_000, [20, 47_000]);
    await mk(2, -20, -19, 'DONE', 'Ganti kampas rem', 1_200_000, [160, 70_000]);
    await mk(5, -1, 1, 'IN_PROGRESS', 'Perbaikan AC', 0);
    await mk(7, 18, 19, 'SCHEDULED', 'Pemeriksaan baterai & software', 0);

    // Operational expenses across months
    for (let m = -5; m <= 0; m++) {
      await addExpense(ctx, 'SOPIR', at(m * 30 - 2), 'Fee sopir bulanan', 4_500_000, null, bank.id, 'TRANSFER');
      await addExpense(ctx, 'BBM', at(m * 30 - 5), 'BBM operasional antar-jemput', 1_250_000, V[4].id, cash);
      await addExpense(ctx, 'KEBERSIHAN', at(m * 30 - 8), 'Cuci & detailing armada', 600_000, null, cash);
      await addExpense(ctx, 'TOL_PARKIR', at(m * 30 - 11), 'Tol & parkir pengantaran', 380_000, V[1].id, cash);
      await addExpense(ctx, 'ADMINISTRASI', at(m * 30 - 14), 'ATK & administrasi kantor', 250_000, null, cash);
    }
    await addExpense(ctx, 'PAJAK_KENDARAAN', at(-35), 'Pajak tahunan STNK', 3_150_000, V[1].id, bank.id, 'TRANSFER');
    await addExpense(ctx, 'ASURANSI', at(-70), 'Premi asuransi all-risk', 6_800_000, V[6].id, bank.id, 'TRANSFER');
    await addExpense(ctx, 'SUKU_CADANG', at(-12), 'Ban baru 4 pcs', 3_600_000, V[3].id, bank.id, 'TRANSFER');

    await ctx.tx.insert(otherIncomes).values({ companyId, number: await nextNumber(ctx.tx, companyId, 'INCOME', settings, TZ), incomeDate: new Date(at(-20).getTime() + 7 * HOUR).toISOString().slice(0, 10),
      category: 'Penjualan aset', description: 'Penjualan ban bekas', amount: '750000', method: 'CASH', cashAccountId: cash });

    await ctx.tx.insert(drivers).values([
      { companyId, code: 'DRV-001', name: 'Slamet Riyadi', phone: '0812-7000-1111', licenseNumber: 'SIM A Umum 1234567', dailyFee: '200000' },
      { companyId, code: 'DRV-002', name: 'Bambang Sutejo', phone: '0813-7000-2222', licenseNumber: 'SIM B1 Umum 7654321', dailyFee: '250000' },
    ]);
    await ctx.tx.execute(sql`insert into document_sequences (company_id, doc_type, period_key, last_value) values (${companyId}, 'DRIVER', 'ALL', 2)
      on conflict (company_id, doc_type, period_key) do update set last_value = 2`);
  });
}

/* ------------------------------------------------------------ CV Mobil Prima */

async function seedPrima(companyId: string) {
  await tenant(companyId, async (ctx) => {
    const cash = (await ctx.tx.execute<{ id: string }>(sql`select id from cash_accounts where company_id = ${companyId} and name = 'Kas Tunai'`)).rows[0].id;
    const [bank] = await ctx.tx.insert(cashAccounts).values({ companyId, name: 'BRI Usaha', type: 'BANK', bankName: 'BRI', accountNumber: '0021-01-000123-30-1', accountHolder: 'CV Mobil Prima' }).returning();
    const acc = { cash, bank: bank.id };
    const V = [
      await addVehicle(ctx, { plate: 'H 1001 MP', brand: 'Suzuki', model: 'Ertiga GX', year: 2021, color: 'Putih', transmission: 'MANUAL', seats: 7, daily: 325_000, km: 51_000 }),
      await addVehicle(ctx, { plate: 'H 1002 MP', brand: 'Toyota', model: 'Calya G', year: 2022, color: 'Merah', transmission: 'AUTOMATIC', seats: 7, daily: 300_000, km: 33_000 }),
      await addVehicle(ctx, { plate: 'H 1003 MP', brand: 'Isuzu', model: 'Elf NLR 20 Seat', year: 2020, color: 'Putih', transmission: 'MANUAL', seats: 20, daily: 1_400_000, km: 120_500, fuel: 'SOLAR' }),
    ];
    // Same plate format as another company's vehicle is fine — uniqueness is per company
    const C = [
      await addCustomer(ctx, { name: 'Bagus Prasetyo', phone: '0812-3456-7890', address: 'Jl. Pandanaran 12, Semarang', idNumber: '3374011201900001' }),
      await addCustomer(ctx, { name: 'PT Jateng Tour', type: 'COMPANY', phone: '024-7600-1122', email: 'admin@jatengtour.id', contactPerson: 'Wulan' }),
    ];
    await addRental(ctx, { customer: C[0], vehicle: V[0], start: at(-20), end: at(-17), state: 'COMPLETED', payments: [['FULL', 0, 'CASH']] }, acc);
    await addRental(ctx, { customer: C[1], vehicle: V[2], start: at(-3), end: at(2), withDriver: true, state: 'ONGOING', payments: [[3_000_000, -1, 'TRANSFER', true]] }, acc);
    await addRental(ctx, { customer: C[0], vehicle: V[1], start: at(3), end: at(5), state: 'SCHEDULED' }, acc);
    await addExpense(ctx, 'BBM', at(-2), 'Solar Elf', 900_000, V[2].id, cash);
  });
}

main()
  .then(() => pool.end())
  .catch(async (e) => { console.error('✖ Seed gagal:', e); await pool.end(); process.exit(1); });

void expenseCategories;
