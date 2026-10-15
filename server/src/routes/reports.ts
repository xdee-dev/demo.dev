import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql, type SQL } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { withTenant } from '../db/tenant.js';
import type { Tx } from '../db/client.js';
import { can } from '../auth/middleware.js';
import type { Permission } from '../auth/permissions.js';
import { parse, zOptDate } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { localDate } from '../lib/dates.js';
import { D, sum } from '../lib/money.js';
import { audit } from '../lib/audit.js';
import { recognizedRevenue, inRange, dayStart, dayEnd } from '../services/finance-sql.js';
import { vehicleStatusSql } from '../services/schedule.js';

export const reportsRouter = Router();

type ColType = 'text' | 'money' | 'number' | 'date' | 'datetime' | 'percent' | 'status';
interface Col { key: string; label: string; type: ColType }
interface Filters { from: string; to: string; customerId?: string; vehicleId?: string; status?: string; tz: string; companyId: string }
interface ReportResult { columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>; notes?: string }
interface ReportDef {
  key: string; title: string; group: string; perm: Permission;
  filters: ('period' | 'customer' | 'vehicle' | 'status')[];
  statusOptions?: { value: string; label: string }[];
  run(tx: Tx, f: Filters): Promise<ReportResult>;
}

const c = (key: string, label: string, type: ColType = 'text'): Col => ({ key, label, type });
const totalOf = (rows: Record<string, unknown>[], ...keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, sum(rows.map((r) => r[k] as string)).toFixed(2)]));
const opt = (cond: unknown, frag: SQL) => (cond ? frag : sql``);

const RENTAL_STATUS = [
  { value: 'SCHEDULED', label: 'Terjadwal' }, { value: 'ONGOING', label: 'Sedang disewa' }, { value: 'RETURNED', label: 'Dikembalikan' },
  { value: 'COMPLETED', label: 'Selesai' }, { value: 'CANCELLED', label: 'Dibatalkan' },
];

async function revenueBy(tx: Tx, f: Filters, fmt: 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY', trunc: 'day' | 'month' | 'year') {
  const rows = (await tx.execute(sql`
    with rev as (
      select date_trunc(${trunc}, (r.recognized_at at time zone ${f.tz}))::date as b, count(*) filter (where r.status <> 'CANCELLED')::int as cnt,
        sum(r.amount) as revenue, sum(r.tax) filter (where r.status <> 'CANCELLED') as tax
      from ${recognizedRevenue(f.companyId)} r
      where ${inRange(sql`r.recognized_at`, f.from, f.to, f.tz)} ${opt(f.vehicleId, sql`and r.vehicle_id = ${f.vehicleId}`)} ${opt(f.customerId, sql`and r.customer_id = ${f.customerId}`)}
      group by 1
    ), cash as (
      select date_trunc(${trunc}, (p.paid_at at time zone ${f.tz}))::date as b, sum(p.amount) as cash_in
      from payments p left join rental_transactions t on t.id = p.rental_id
      where p.company_id = ${f.companyId} and ${inRange(sql`p.paid_at`, f.from, f.to, f.tz)}
        ${opt(f.vehicleId, sql`and t.vehicle_id = ${f.vehicleId}`)} ${opt(f.customerId, sql`and p.customer_id = ${f.customerId}`)}
      group by 1
    ), exp as (
      select date_trunc(${trunc}, e.expense_date)::date as b, sum(e.amount) as expenses
      from expenses e where e.company_id = ${f.companyId} and e.status = 'POSTED' and e.expense_date between ${f.from}::date and ${f.to}::date
        ${opt(f.vehicleId, sql`and e.vehicle_id = ${f.vehicleId}`)}
      group by 1
    ), keys as (select b from rev union select b from cash union select b from exp)
    select to_char(k.b, ${fmt}) as period, coalesce(rev.cnt, 0) as count, coalesce(rev.revenue, 0) as revenue, coalesce(rev.tax, 0) as tax,
      coalesce(cash.cash_in, 0) as "cashIn", coalesce(exp.expenses, 0) as expenses, coalesce(rev.revenue, 0) - coalesce(exp.expenses, 0) as profit
    from keys k left join rev on rev.b = k.b left join cash on cash.b = k.b left join exp on exp.b = k.b
    order by k.b`)).rows;
  const label = trunc === 'day' ? 'Tanggal' : trunc === 'month' ? 'Bulan' : 'Tahun';
  return {
    columns: [c('period', label, trunc === 'day' ? 'date' : 'text'), c('count', 'Transaksi', 'number'), c('revenue', 'Pendapatan Rental', 'money'), c('tax', 'Pajak', 'money'),
      c('cashIn', 'Penerimaan Kas', 'money'), c('expenses', 'Pengeluaran', 'money'), c('profit', 'Laba Operasional', 'money')],
    rows, totals: { period: 'Total', count: rows.reduce((a, r) => a + Number(r.count), 0), ...totalOf(rows, 'revenue', 'tax', 'cashIn', 'expenses', 'profit') },
    notes: 'Pendapatan diakui pada tanggal mulai sewa (di luar pajak). Penerimaan kas dicatat pada tanggal pembayaran. Keduanya tidak dijumlahkan.',
  };
}

const REPORTS: ReportDef[] = [
  { key: 'revenue-daily', title: 'Pendapatan Harian', group: 'pendapatan', perm: 'report.financial', filters: ['period', 'vehicle', 'customer'], run: (tx, f) => revenueBy(tx, f, 'YYYY-MM-DD', 'day') },
  { key: 'revenue-monthly', title: 'Pendapatan Bulanan', group: 'pendapatan', perm: 'report.financial', filters: ['period', 'vehicle', 'customer'], run: (tx, f) => revenueBy(tx, f, 'YYYY-MM', 'month') },
  { key: 'revenue-yearly', title: 'Pendapatan Tahunan', group: 'pendapatan', perm: 'report.financial', filters: ['period', 'vehicle', 'customer'], run: (tx, f) => revenueBy(tx, f, 'YYYY', 'year') },
  {
    key: 'revenue-by-vehicle', title: 'Pendapatan per Kendaraan', group: 'kendaraan', perm: 'report.financial', filters: ['period', 'vehicle'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select v.code, v.plate_number as "plateNumber", v.brand || ' ' || v.model as vehicle, count(r.rental_id) filter (where r.status <> 'CANCELLED')::int as count,
          coalesce(sum(r.amount), 0) as revenue
        from vehicles v left join ${recognizedRevenue(f.companyId)} r on r.vehicle_id = v.id and ${inRange(sql`r.recognized_at`, f.from, f.to, f.tz)}
        where v.company_id = ${f.companyId} and (v.archived_at is null or r.rental_id is not null) ${opt(f.vehicleId, sql`and v.id = ${f.vehicleId}`)}
        group by v.id order by revenue desc, v.plate_number`)).rows;
      const total = sum(rows.map((r) => r.revenue as string));
      rows.forEach((r) => { r.share = total.gt(0) ? D(r.revenue as string).div(total).times(100).toFixed(1) : '0'; });
      return { columns: [c('code', 'Kode'), c('plateNumber', 'No. Polisi'), c('vehicle', 'Kendaraan'), c('count', 'Transaksi', 'number'), c('revenue', 'Pendapatan', 'money'), c('share', 'Kontribusi', 'percent')],
        rows, totals: { vehicle: 'Total', count: rows.reduce((a, r) => a + Number(r.count), 0), revenue: total.toFixed(2), share: '100' } };
    },
  },
  {
    key: 'revenue-by-customer', title: 'Pendapatan per Customer', group: 'pendapatan', perm: 'report.financial', filters: ['period', 'customer'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select cu.code, cu.name, cu.phone, count(r.rental_id) filter (where r.status <> 'CANCELLED')::int as count, coalesce(sum(r.amount), 0) as revenue,
          (select coalesce(sum(greatest(b.balance,0)),0) from rental_transactions t join rental_balances b on b.rental_id = t.id where t.customer_id = cu.id) as receivable
        from ${recognizedRevenue(f.companyId)} r join customers cu on cu.id = r.customer_id
        where ${inRange(sql`r.recognized_at`, f.from, f.to, f.tz)} ${opt(f.customerId, sql`and cu.id = ${f.customerId}`)}
        group by cu.id order by revenue desc`)).rows;
      return { columns: [c('code', 'Kode'), c('name', 'Customer'), c('phone', 'Telepon'), c('count', 'Transaksi', 'number'), c('revenue', 'Pendapatan', 'money'), c('receivable', 'Piutang Saat Ini', 'money')],
        rows, totals: { name: 'Total', count: rows.reduce((a, r) => a + Number(r.count), 0), ...totalOf(rows, 'revenue', 'receivable') } };
    },
  },
  {
    key: 'rentals', title: 'Transaksi Rental', group: 'rental', perm: 'report.operational', filters: ['period', 'customer', 'vehicle', 'status'], statusOptions: RENTAL_STATUS,
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select t.number, t.start_at as "startAt", t.end_at as "endAt", t.actual_end_at as "actualEndAt", t.customer_snapshot->>'name' as customer,
          t.vehicle_snapshot->>'plateNumber' as "plateNumber", t.rental_type as "rentalType", t.quantity, t.status, b.amount_due as total, b.paid, b.balance, b.payment_status as "paymentStatus"
        from rental_transactions t join rental_balances b on b.rental_id = t.id
        where t.company_id = ${f.companyId} and ${inRange(sql`t.start_at`, f.from, f.to, f.tz)}
          ${opt(f.vehicleId, sql`and t.vehicle_id = ${f.vehicleId}`)} ${opt(f.customerId, sql`and t.customer_id = ${f.customerId}`)} ${opt(f.status, sql`and t.status::text = ${f.status}`)}
        order by t.start_at`)).rows;
      return { columns: [c('number', 'No. Transaksi'), c('startAt', 'Mulai', 'datetime'), c('endAt', 'Rencana Kembali', 'datetime'), c('actualEndAt', 'Aktual Kembali', 'datetime'),
        c('customer', 'Customer'), c('plateNumber', 'No. Polisi'), c('quantity', 'Durasi', 'number'), c('status', 'Status', 'status'), c('total', 'Tagihan', 'money'),
        c('paid', 'Dibayar', 'money'), c('balance', 'Sisa', 'money'), c('paymentStatus', 'Pembayaran', 'status')],
      rows, totals: { number: 'Total', ...totalOf(rows, 'total', 'paid', 'balance') } };
    },
  },
  {
    key: 'utilization', title: 'Reservasi & Tingkat Penggunaan Kendaraan', group: 'penggunaan', perm: 'report.operational', filters: ['period', 'vehicle'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        with p as (select tstzrange(${dayStart(f.from, f.tz)}, ${dayEnd(f.to, f.tz)}, '[)') as r)
        select v.code, v.plate_number as "plateNumber", v.brand || ' ' || v.model as vehicle,
          (select count(*)::int from rental_transactions t where t.vehicle_id = v.id and t.status <> 'CANCELLED' and ${inRange(sql`t.start_at`, f.from, f.to, f.tz)}) as rentals,
          (select count(*)::int from reservations rs where rs.vehicle_id = v.id and ${inRange(sql`rs.start_at`, f.from, f.to, f.tz)}) as reservations,
          (select count(*)::int from reservations rs where rs.vehicle_id = v.id and rs.status = 'CANCELLED' and ${inRange(sql`rs.start_at`, f.from, f.to, f.tz)}) as "cancelledReservations",
          round(coalesce((select sum(extract(epoch from (upper(b.period * p.r) - lower(b.period * p.r)))) / 3600 from vehicle_schedule_blocks b, p
            where b.vehicle_id = v.id and b.active and b.source_type = 'RENTAL' and b.period && p.r), 0)::numeric, 1) as "rentedHours",
          round(coalesce((select sum(extract(epoch from (upper(b.period * p.r) - lower(b.period * p.r)))) / 3600 from vehicle_schedule_blocks b, p
            where b.vehicle_id = v.id and b.active and b.source_type = 'MAINTENANCE' and b.period && p.r), 0)::numeric, 1) as "maintenanceHours",
          round((extract(epoch from (upper(p.r) - lower(p.r))) / 3600)::numeric, 1) as "periodHours"
        from vehicles v, p where v.company_id = ${f.companyId} and v.archived_at is null ${opt(f.vehicleId, sql`and v.id = ${f.vehicleId}`)}
        order by v.plate_number`)).rows;
      rows.forEach((r) => { r.utilization = D(r.periodHours as string).gt(0) ? D(r.rentedHours as string).div(r.periodHours as string).times(100).toFixed(1) : '0'; });
      return { columns: [c('code', 'Kode'), c('plateNumber', 'No. Polisi'), c('vehicle', 'Kendaraan'), c('reservations', 'Reservasi', 'number'), c('cancelledReservations', 'Batal', 'number'),
        c('rentals', 'Transaksi', 'number'), c('rentedHours', 'Jam Disewa', 'number'), c('maintenanceHours', 'Jam Perawatan', 'number'), c('utilization', 'Utilisasi', 'percent')], rows,
        notes: 'Utilisasi = jam kendaraan terpakai untuk rental ÷ total jam pada periode.' };
    },
  },
  {
    key: 'vehicle-schedule', title: 'Jadwal Kendaraan', group: 'rental', perm: 'report.operational', filters: ['period', 'vehicle'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select v.plate_number as "plateNumber", v.brand || ' ' || v.model as vehicle,
          case b.source_type when 'RESERVATION' then 'Reservasi' when 'RENTAL' then 'Rental' else 'Perawatan' end as type,
          coalesce(rs.number, t.number, m.number) as number, coalesce(rs.customer_snapshot->>'name', t.customer_snapshot->>'name', m.service_type) as description,
          lower(b.period) as "startAt", upper(b.period) as "endAt", coalesce(rs.status::text, t.status::text, m.status::text) as status
        from vehicle_schedule_blocks b join vehicles v on v.id = b.vehicle_id
        left join reservations rs on b.source_type = 'RESERVATION' and rs.id = b.source_id
        left join rental_transactions t on b.source_type = 'RENTAL' and t.id = b.source_id
        left join maintenance_records m on b.source_type = 'MAINTENANCE' and m.id = b.source_id
        where b.company_id = ${f.companyId} and b.active and b.period && tstzrange(${dayStart(f.from, f.tz)}, ${dayEnd(f.to, f.tz)}, '[)')
          ${opt(f.vehicleId, sql`and b.vehicle_id = ${f.vehicleId}`)}
        order by v.plate_number, lower(b.period)`)).rows;
      return { columns: [c('plateNumber', 'No. Polisi'), c('vehicle', 'Kendaraan'), c('type', 'Jenis'), c('number', 'Nomor'), c('description', 'Customer / Keterangan'),
        c('startAt', 'Mulai', 'datetime'), c('endAt', 'Selesai', 'datetime'), c('status', 'Status', 'status')], rows };
    },
  },
  {
    key: 'fleet-status', title: 'Kendaraan Tersedia & Sedang Disewa', group: 'penggunaan', perm: 'report.operational', filters: ['vehicle'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select v.code, v.plate_number as "plateNumber", v.brand || ' ' || v.model as vehicle, ${vehicleStatusSql} as status,
          t.number as "rentalNumber", t.customer_snapshot->>'name' as customer, t.end_at as "returnDue", (t.end_at < now()) as overdue,
          (select min(lower(b.period)) from vehicle_schedule_blocks b where b.vehicle_id = v.id and b.active and lower(b.period) > now()) as "nextBooking"
        from vehicles v left join rental_transactions t on t.vehicle_id = v.id and t.status = 'ONGOING'
        where v.company_id = ${f.companyId} and v.archived_at is null ${opt(f.vehicleId, sql`and v.id = ${f.vehicleId}`)}
        order by 4, v.plate_number`)).rows;
      rows.forEach((r) => { r.overdue = r.overdue ? 'Ya' : ''; });
      return { columns: [c('code', 'Kode'), c('plateNumber', 'No. Polisi'), c('vehicle', 'Kendaraan'), c('status', 'Status Saat Ini', 'status'), c('rentalNumber', 'Transaksi'),
        c('customer', 'Penyewa'), c('returnDue', 'Jadwal Kembali', 'datetime'), c('overdue', 'Terlambat'), c('nextBooking', 'Jadwal Berikutnya', 'datetime')], rows };
    },
  },
  {
    key: 'late-returns', title: 'Pengembalian Terlambat', group: 'rental', perm: 'report.operational', filters: ['period', 'customer', 'vehicle'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select t.number, t.customer_snapshot->>'name' as customer, t.customer_snapshot->>'phone' as phone, t.vehicle_snapshot->>'plateNumber' as "plateNumber",
          t.end_at as "plannedEnd", t.actual_end_at as "actualEnd",
          round((extract(epoch from (coalesce(t.actual_end_at, now()) - t.end_at)) / 3600)::numeric, 1) as "lateHours",
          t.late_fee as "lateFee", case when t.status = 'ONGOING' then 'Belum kembali' else 'Sudah kembali' end as state
        from rental_transactions t
        where t.company_id = ${f.companyId} and t.status <> 'CANCELLED'
          and ((t.status = 'ONGOING' and t.end_at < now()) or (t.actual_end_at is not null and t.actual_end_at > t.end_at + interval '1 minute'))
          and ${inRange(sql`t.end_at`, f.from, f.to, f.tz)}
          ${opt(f.vehicleId, sql`and t.vehicle_id = ${f.vehicleId}`)} ${opt(f.customerId, sql`and t.customer_id = ${f.customerId}`)}
        order by t.end_at`)).rows;
      return { columns: [c('number', 'No. Transaksi'), c('customer', 'Customer'), c('phone', 'Telepon'), c('plateNumber', 'No. Polisi'), c('plannedEnd', 'Rencana Kembali', 'datetime'),
        c('actualEnd', 'Aktual Kembali', 'datetime'), c('lateHours', 'Terlambat (jam)', 'number'), c('lateFee', 'Denda', 'money'), c('state', 'Keterangan')],
      rows, totals: { number: 'Total', ...totalOf(rows, 'lateFee') } };
    },
  },
  {
    key: 'cash-receipts', title: 'Pembayaran & Penerimaan Kas', group: 'pendapatan', perm: 'report.financial', filters: ['period', 'customer'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select p.number, p.paid_at as "paidAt", case p.kind when 'PAYMENT' then (case when p.is_down_payment then 'DP' else 'Pembayaran' end) when 'REFUND' then 'Refund' else 'Reversal' end as kind,
          cu.name as customer, coalesce(t.number, rs.number) as reference, p.method, ca.name as account, p.amount
        from payments p join customers cu on cu.id = p.customer_id left join rental_transactions t on t.id = p.rental_id
        left join reservations rs on rs.id = p.reservation_id left join cash_accounts ca on ca.id = p.cash_account_id
        where p.company_id = ${f.companyId} and ${inRange(sql`p.paid_at`, f.from, f.to, f.tz)} ${opt(f.customerId, sql`and p.customer_id = ${f.customerId}`)}
        union all
        select i.number, (i.income_date::timestamp at time zone ${f.tz}), 'Pemasukan lain', i.category, i.description, i.method, ca.name, i.amount
        from other_incomes i left join cash_accounts ca on ca.id = i.cash_account_id
        where i.company_id = ${f.companyId} and i.status = 'POSTED' and i.income_date between ${f.from}::date and ${f.to}::date and ${!f.customerId}
        order by 2`)).rows;
      return { columns: [c('number', 'No. Bukti'), c('paidAt', 'Tanggal', 'datetime'), c('kind', 'Jenis'), c('customer', 'Customer / Kategori'), c('reference', 'Referensi'),
        c('method', 'Metode'), c('account', 'Akun Kas'), c('amount', 'Nominal', 'money')], rows, totals: { number: 'Total', ...totalOf(rows, 'amount') } };
    },
  },
  {
    key: 'receivables', title: 'Piutang Customer', group: 'piutang', perm: 'report.financial', filters: ['customer'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select t.number, t.invoice_number as invoice, t.customer_snapshot->>'name' as customer, t.customer_snapshot->>'phone' as phone, t.end_at as "dueDate",
          greatest(0, extract(day from now() - t.end_at))::int as days, b.amount_due as total, b.paid, b.balance,
          case when now() <= t.end_at then 'Belum jatuh tempo' when now() - t.end_at <= interval '30 days' then '1–30 hari'
               when now() - t.end_at <= interval '60 days' then '31–60 hari' when now() - t.end_at <= interval '90 days' then '61–90 hari' else '> 90 hari' end as aging
        from rental_transactions t join rental_balances b on b.rental_id = t.id
        where t.company_id = ${f.companyId} and b.balance > 0 ${opt(f.customerId, sql`and t.customer_id = ${f.customerId}`)}
        order by t.end_at`)).rows;
      return { columns: [c('number', 'No. Transaksi'), c('invoice', 'No. Invoice'), c('customer', 'Customer'), c('phone', 'Telepon'), c('dueDate', 'Jatuh Tempo', 'datetime'),
        c('days', 'Umur (hari)', 'number'), c('aging', 'Kelompok Umur'), c('total', 'Tagihan', 'money'), c('paid', 'Dibayar', 'money'), c('balance', 'Sisa Piutang', 'money')],
      rows, totals: { number: 'Total', ...totalOf(rows, 'total', 'paid', 'balance') }, notes: 'Posisi piutang saat ini. Jatuh tempo = rencana tanggal pengembalian.' };
    },
  },
  {
    key: 'expenses', title: 'Pengeluaran Operasional', group: 'pengeluaran', perm: 'report.financial', filters: ['period', 'vehicle'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select e.number, e.expense_date as date, cat.name as category, e.description, v.plate_number as "plateNumber", t.number as "rentalNumber", e.method, ca.name as account, e.amount
        from expenses e join expense_categories cat on cat.id = e.category_id left join vehicles v on v.id = e.vehicle_id
        left join rental_transactions t on t.id = e.rental_id left join cash_accounts ca on ca.id = e.cash_account_id
        where e.company_id = ${f.companyId} and e.status = 'POSTED' and e.expense_date between ${f.from}::date and ${f.to}::date
          ${opt(f.vehicleId, sql`and e.vehicle_id = ${f.vehicleId}`)}
        order by e.expense_date, e.number`)).rows;
      return { columns: [c('number', 'No.'), c('date', 'Tanggal', 'date'), c('category', 'Kategori'), c('description', 'Deskripsi'), c('plateNumber', 'Kendaraan'),
        c('rentalNumber', 'Transaksi'), c('method', 'Metode'), c('account', 'Akun'), c('amount', 'Nominal', 'money')], rows, totals: { number: 'Total', ...totalOf(rows, 'amount') } };
    },
  },
  {
    key: 'cost-by-vehicle', title: 'Biaya per Kendaraan', group: 'pengeluaran', perm: 'report.financial', filters: ['period', 'vehicle'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select v.code, v.plate_number as "plateNumber", v.brand || ' ' || v.model as vehicle,
          coalesce(sum(e.amount) filter (where cat.code = 'BBM'), 0) as fuel,
          coalesce(sum(e.amount) filter (where cat.code in ('SERVIS','SUKU_CADANG')), 0) as maintenance,
          coalesce(sum(e.amount) filter (where cat.code in ('PAJAK_KENDARAAN','ASURANSI')), 0) as "taxInsurance",
          coalesce(sum(e.amount) filter (where cat.code not in ('BBM','SERVIS','SUKU_CADANG','PAJAK_KENDARAAN','ASURANSI')), 0) as other,
          coalesce(sum(e.amount), 0) as total
        from vehicles v left join expenses e on e.vehicle_id = v.id and e.status = 'POSTED' and e.expense_date between ${f.from}::date and ${f.to}::date
        left join expense_categories cat on cat.id = e.category_id
        where v.company_id = ${f.companyId} and (v.archived_at is null or e.id is not null) ${opt(f.vehicleId, sql`and v.id = ${f.vehicleId}`)}
        group by v.id order by total desc, v.plate_number`)).rows;
      return { columns: [c('code', 'Kode'), c('plateNumber', 'No. Polisi'), c('vehicle', 'Kendaraan'), c('fuel', 'BBM', 'money'), c('maintenance', 'Servis & Suku Cadang', 'money'),
        c('taxInsurance', 'Pajak & Asuransi', 'money'), c('other', 'Lainnya', 'money'), c('total', 'Total Biaya', 'money')],
      rows, totals: { vehicle: 'Total', ...totalOf(rows, 'fuel', 'maintenance', 'taxInsurance', 'other', 'total') }, notes: 'Hanya pengeluaran yang dikaitkan dengan kendaraan.' };
    },
  },
  {
    key: 'profit-by-vehicle', title: 'Laba Operasional per Kendaraan', group: 'kendaraan', perm: 'report.financial', filters: ['period', 'vehicle'],
    async run(tx, f) {
      const rows = (await tx.execute(sql`
        select v.code, v.plate_number as "plateNumber", v.brand || ' ' || v.model as vehicle,
          coalesce((select sum(r.amount) from ${recognizedRevenue(f.companyId)} r where r.vehicle_id = v.id and ${inRange(sql`r.recognized_at`, f.from, f.to, f.tz)}), 0) as revenue,
          coalesce((select sum(e.amount) from expenses e where e.vehicle_id = v.id and e.status = 'POSTED' and e.expense_date between ${f.from}::date and ${f.to}::date), 0) as expenses
        from vehicles v where v.company_id = ${f.companyId} and v.archived_at is null ${opt(f.vehicleId, sql`and v.id = ${f.vehicleId}`)}
        order by v.plate_number`)).rows;
      rows.forEach((r) => {
        const p = D(r.revenue as string).minus(r.expenses as string);
        r.profit = p.toFixed(2);
        r.margin = D(r.revenue as string).gt(0) ? p.div(r.revenue as string).times(100).toFixed(1) : '';
      });
      rows.sort((a, b) => D(b.profit as string).cmp(a.profit as string));
      return { columns: [c('code', 'Kode'), c('plateNumber', 'No. Polisi'), c('vehicle', 'Kendaraan'), c('revenue', 'Pendapatan', 'money'), c('expenses', 'Biaya', 'money'),
        c('profit', 'Laba Operasional', 'money'), c('margin', 'Margin', 'percent')], rows, totals: { vehicle: 'Total', ...totalOf(rows, 'revenue', 'expenses', 'profit') },
        notes: 'Biaya umum yang tidak dikaitkan dengan kendaraan tidak dialokasikan ke kendaraan.' };
    },
  },
  {
    key: 'summary', title: 'Ringkasan Pendapatan & Biaya', group: 'pendapatan', perm: 'report.financial', filters: ['period'],
    async run(tx, f) {
      const one = async (q: SQL) => ((await tx.execute<{ v: string }>(q)).rows[0]?.v ?? '0');
      const revenue = await one(sql`select coalesce(sum(r.amount),0) as v from ${recognizedRevenue(f.companyId)} r where ${inRange(sql`r.recognized_at`, f.from, f.to, f.tz)}`);
      const tax = await one(sql`select coalesce(sum(r.tax),0) as v from ${recognizedRevenue(f.companyId)} r where r.status <> 'CANCELLED' and ${inRange(sql`r.recognized_at`, f.from, f.to, f.tz)}`);
      const other = await one(sql`select coalesce(sum(amount),0) as v from other_incomes where company_id = ${f.companyId} and status = 'POSTED' and income_date between ${f.from}::date and ${f.to}::date`);
      const cats = (await tx.execute<{ name: string; v: string }>(sql`select cat.name, coalesce(sum(e.amount),0) as v from expenses e join expense_categories cat on cat.id = e.category_id
        where e.company_id = ${f.companyId} and e.status = 'POSTED' and e.expense_date between ${f.from}::date and ${f.to}::date group by cat.name order by v desc`)).rows;
      const expenses = sum(cats.map((x) => x.v));
      const cashIn = await one(sql`select coalesce(sum(amount),0) as v from payments where company_id = ${f.companyId} and ${inRange(sql`paid_at`, f.from, f.to, f.tz)}`);
      const receivable = await one(sql`select coalesce(sum(greatest(balance,0)),0) as v from rental_balances where company_id = ${f.companyId}`);
      const opProfit = D(revenue).minus(expenses);
      const rows: Record<string, unknown>[] = [
        { item: 'PENDAPATAN', amount: null, section: true },
        { item: 'Pendapatan rental (di luar pajak)', amount: revenue },
        { item: 'Pendapatan lain-lain', amount: other },
        { item: 'Total pendapatan', amount: D(revenue).plus(other).toFixed(2), bold: true },
        { item: 'PENGELUARAN OPERASIONAL', amount: null, section: true },
        ...cats.map((x) => ({ item: x.name, amount: x.v })),
        { item: 'Total pengeluaran', amount: expenses.toFixed(2), bold: true },
        { item: 'LABA', amount: null, section: true },
        { item: 'Laba operasional (pendapatan rental − pengeluaran)', amount: opProfit.toFixed(2), bold: true },
        { item: 'Laba setelah pendapatan lain-lain', amount: opProfit.plus(other).toFixed(2), bold: true },
        { item: 'INFORMASI KAS & PIUTANG', amount: null, section: true },
        { item: 'Penerimaan kas dari customer (neto refund/reversal)', amount: cashIn },
        { item: 'Pajak yang ditagihkan', amount: tax },
        { item: 'Total piutang saat ini', amount: receivable },
      ];
      return { columns: [c('item', 'Keterangan'), c('amount', 'Jumlah', 'money')], rows,
        notes: 'Pendapatan diakui pada tanggal mulai sewa; penerimaan kas pada tanggal pembayaran. Penerimaan kas ditampilkan sebagai informasi dan tidak dijumlahkan dengan pendapatan.' };
    },
  },
];

const filterSchema = z.object({
  from: zOptDate, to: zOptDate, customerId: z.uuid().optional(), vehicleId: z.uuid().optional(), status: z.string().max(20).optional(),
  format: z.enum(['json', 'xlsx', 'csv']).default('json'),
});

function getReport(req: Request) {
  const def = REPORTS.find((r) => r.key === req.params.key);
  if (!def) throw notFound('Laporan');
  if (!can(req, def.perm)) throw forbidden();
  return def;
}

reportsRouter.get('/reports', (req, res) => {
  res.json(REPORTS.filter((r) => can(req, r.perm)).map(({ key, title, group, filters, statusOptions }) => ({ key, title, group, filters, statusOptions })));
});

reportsRouter.get('/reports/:key', async (req: Request, res: Response) => {
  const def = getReport(req);
  const q = parse(filterSchema, req.query);
  const { companyId, timezone, companyName } = req.ctx!;
  const today = localDate(new Date(), timezone);
  const from = q.from ?? `${today.slice(0, 8)}01`;
  const to = q.to ?? today;
  if (from > to) throw badRequest('Tanggal awal harus sebelum tanggal akhir');
  if (q.format !== 'json' && !can(req, 'data.export')) throw forbidden('Anda tidak memiliki izin ekspor data');
  const f: Filters = { from, to, customerId: q.customerId, vehicleId: q.vehicleId, status: q.status, tz: timezone, companyId };
  const result = await withTenant(companyId, async (tx) => {
    const r = await def.run(tx, f);
    if (q.format !== 'json') await audit(tx, req, { action: 'report.export', entityType: 'report', entityId: def.key, summary: `${def.title} (${q.format.toUpperCase()}) ${from} s/d ${to}` });
    return r;
  });
  const meta = { key: def.key, title: def.title, from, to, filters: def.filters, companyName, generatedAt: new Date().toISOString(), timezone };
  if (q.format === 'json') { res.json({ ...meta, ...result }); return; }
  const fileBase = `${def.key}_${from}_${to}`;
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
    res.send(toCsv(result, timezone));
    return;
  }
  const buf = await toXlsx(def.title, meta, result, timezone);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
  res.send(buf);
});

/* ---------------------------------------------------------------- export */

function fmtDateTime(v: unknown, tz: string, withTime: boolean) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v).length === 10 ? `${v}T00:00:00Z` : String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat('id-ID', { timeZone: String(v).length === 10 ? 'UTC' : tz, day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(d);
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Terjadwal', ONGOING: 'Sedang disewa', RETURNED: 'Dikembalikan', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan',
  DRAFT: 'Draft', PENDING: 'Menunggu konfirmasi', CONFIRMED: 'Dikonfirmasi', ACTIVE: 'Aktif',
  UNPAID: 'Belum dibayar', DP_PAID: 'DP dibayar', PARTIAL: 'Sebagian', PAID: 'Lunas', REFUND_DUE: 'Perlu refund',
  AVAILABLE: 'Tersedia', BOOKED: 'Dipesan', RENTED: 'Sedang disewa', MAINTENANCE: 'Perawatan', INACTIVE: 'Tidak aktif',
  IN_PROGRESS: 'Dikerjakan', DONE: 'Selesai',
};

function cellText(v: unknown, type: ColType, tz: string): string {
  if (v === null || v === undefined) return '';
  if (type === 'money') { const d = D(v as string); return d.isInteger() ? d.toFixed(0) : d.toFixed(2).replace('.', ','); }
  if (type === 'number' || type === 'percent') return String(v).replace('.', ',');
  if (type === 'date') return fmtDateTime(v, tz, false);
  if (type === 'datetime') return fmtDateTime(v, tz, true);
  if (type === 'status') return STATUS_LABEL[String(v)] ?? String(v);
  return String(v);
}

/** Semicolon-separated, UTF-8 BOM, comma decimals: opens correctly in Excel with Indonesian locale. */
function toCsv(r: ReportResult, tz: string) {
  const esc = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const guard = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s); // CSV/formula injection
  const lines = [r.columns.map((col) => esc(col.label)).join(';')];
  for (const row of [...r.rows, ...(r.totals ? [r.totals] : [])]) {
    lines.push(r.columns.map((col) => esc(guard(cellText(row[col.key], col.type, tz)))).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}

async function toXlsx(title: string, meta: { companyName: string; from: string; to: string }, r: ReportResult, tz: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rental Management System';
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.addRow([meta.companyName]).font = { bold: true, size: 13 };
  ws.addRow([title]).font = { bold: true, size: 12 };
  ws.addRow([`Periode: ${fmtDateTime(meta.from, tz, false)} s/d ${fmtDateTime(meta.to, tz, false)}`]);
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((col) => col.label));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; });
  const addData = (row: Record<string, unknown>, bold = false) => {
    const values = r.columns.map((col) => {
      const v = row[col.key];
      if (v === null || v === undefined || v === '') return null;
      if (col.type === 'money' || col.type === 'number') return Number(v);
      if (col.type === 'percent') return Number(v) / 100;
      if (col.type === 'date' || col.type === 'datetime' || col.type === 'status') return cellText(v, col.type, tz);
      return String(v);
    });
    const added = ws.addRow(values);
    if (bold || row.bold || row.section) added.font = { bold: true };
  };
  r.rows.forEach((row) => addData(row));
  if (r.totals) addData(r.totals, true);
  r.columns.forEach((col, i) => {
    const column = ws.getColumn(i + 1);
    column.width = Math.min(45, Math.max(12, col.label.length + 4, ...r.rows.slice(0, 200).map((x) => String(x[col.key] ?? '').length + 2)));
    if (col.type === 'money') column.numFmt = '"Rp" #,##0;[Red]-"Rp" #,##0';
    if (col.type === 'percent') column.numFmt = '0.0%';
  });
  if (r.notes) { ws.addRow([]); ws.addRow([r.notes]).font = { italic: true, size: 9 }; }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
