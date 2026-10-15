import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import { perm, can } from '../auth/middleware.js';
import { query, zOptDate } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { localDate } from '../lib/dates.js';
import { vehicleStatusSql } from '../services/schedule.js';
import { recognizedRevenue, inRange } from '../services/finance-sql.js';

export const dashboardRouter = Router();

dashboardRouter.get('/dashboard', perm('dashboard.view'), async (req, res) => {
  const { companyId, timezone } = req.ctx!;
  const today = localDate(new Date(), timezone);
  const q = query(req, z.object({ from: zOptDate, to: zOptDate }));
  const from = q.from ?? `${today.slice(0, 8)}01`;
  const to = q.to ?? today;
  if (from > to) throw badRequest('Tanggal awal harus sebelum tanggal akhir');
  const finance = can(req, 'report.financial');
  const tz = timezone;

  const data = await withTenant(companyId, async (tx) => {
    const fleet = (await tx.execute(sql`
      select count(*)::int as total,
        count(*) filter (where status = 'AVAILABLE')::int as available,
        count(*) filter (where status = 'BOOKED')::int as booked,
        count(*) filter (where status = 'RENTED')::int as rented,
        count(*) filter (where status = 'MAINTENANCE')::int as maintenance,
        count(*) filter (where status = 'INACTIVE')::int as inactive,
        (select count(*)::int from rental_transactions r where r.company_id = ${companyId} and r.status = 'ONGOING' and r.end_at < now()) as overdue
      from (select ${vehicleStatusSql} as status from vehicles v where v.company_id = ${companyId} and v.archived_at is null) s`)).rows[0];

    const rentalCount = (await tx.execute(sql`select count(*)::int as n from rental_transactions t
      where t.company_id = ${companyId} and t.status <> 'CANCELLED' and ${inRange(sql`t.start_at`, from, to, tz)}`)).rows[0];

    let money = null;
    let revenueSeries = null;
    let monthly = null;
    let byVehicle = null;
    let byCustomer = null;
    if (finance) {
      money = (await tx.execute(sql`
        select
          (select coalesce(sum(r.amount),0) from ${recognizedRevenue(companyId)} r where ${inRange(sql`r.recognized_at`, from, to, tz)}) as revenue,
          (select coalesce(sum(p.amount),0) from payments p where p.company_id = ${companyId} and ${inRange(sql`p.paid_at`, from, to, tz)}) as "cashIn",
          (select coalesce(sum(i.amount),0) from other_incomes i where i.company_id = ${companyId} and i.status = 'POSTED' and i.income_date between ${from}::date and ${to}::date) as "otherIncome",
          (select coalesce(sum(greatest(b.balance,0)),0) from rental_balances b where b.company_id = ${companyId}) as receivable,
          (select coalesce(sum(e.amount),0) from expenses e where e.company_id = ${companyId} and e.status = 'POSTED' and e.expense_date between ${from}::date and ${to}::date) as expenses`)).rows[0] as Record<string, string>;
      money.profit = (await tx.execute<{ v: string }>(sql`select (${money.revenue}::numeric - ${money.expenses}::numeric)::text as v`)).rows[0].v;

      const days = (await tx.execute<{ d: number }>(sql`select (${to}::date - ${from}::date)::int as d`)).rows[0].d;
      const bucket = days > 92 ? 'month' : 'day';
      revenueSeries = { bucket, points: (await tx.execute(sql`
        with buckets as (
          select generate_series(date_trunc(${bucket}, ${from}::date), date_trunc(${bucket}, ${to}::date), ${'1 ' + bucket}::interval)::date as b
        )
        select to_char(bk.b, ${bucket === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'}) as label,
          coalesce((select sum(r.amount) from ${recognizedRevenue(companyId)} r
            where date_trunc(${bucket}, (r.recognized_at at time zone ${tz})::date)::date = bk.b and ${inRange(sql`r.recognized_at`, from, to, tz)}), 0) as revenue,
          coalesce((select sum(e.amount) from expenses e where e.company_id = ${companyId} and e.status = 'POSTED'
            and date_trunc(${bucket}, e.expense_date)::date = bk.b and e.expense_date between ${from}::date and ${to}::date), 0) as expenses,
          coalesce((select sum(p.amount) from payments p where p.company_id = ${companyId}
            and date_trunc(${bucket}, (p.paid_at at time zone ${tz})::date)::date = bk.b and ${inRange(sql`p.paid_at`, from, to, tz)}), 0) as "cashIn"
        from buckets bk order by bk.b`)).rows };

      monthly = (await tx.execute(sql`
        with months as (
          select generate_series(date_trunc('month', (now() at time zone ${tz})::date) - interval '11 months', date_trunc('month', (now() at time zone ${tz})::date), interval '1 month')::date as m
        )
        select to_char(m.m, 'YYYY-MM') as label,
          coalesce((select sum(r.amount) from ${recognizedRevenue(companyId)} r where date_trunc('month', (r.recognized_at at time zone ${tz})::date)::date = m.m), 0) as revenue,
          coalesce((select sum(e.amount) from expenses e where e.company_id = ${companyId} and e.status = 'POSTED' and date_trunc('month', e.expense_date)::date = m.m), 0) as expenses
        from months m order by m.m`)).rows;

      byVehicle = (await tx.execute(sql`
        select v.id, v.plate_number as "plateNumber", v.brand || ' ' || v.model as name, count(r.rental_id)::int as count, coalesce(sum(r.amount),0) as revenue
        from ${recognizedRevenue(companyId)} r join vehicles v on v.id = r.vehicle_id
        where ${inRange(sql`r.recognized_at`, from, to, tz)}
        group by v.id order by revenue desc limit 8`)).rows;

      byCustomer = (await tx.execute(sql`
        select c.id, c.name, count(r.rental_id)::int as count, coalesce(sum(r.amount),0) as revenue
        from ${recognizedRevenue(companyId)} r join customers c on c.id = r.customer_id
        where ${inRange(sql`r.recognized_at`, from, to, tz)}
        group by c.id order by revenue desc limit 8`)).rows;
    }

    const pickups = (await tx.execute(sql`
      select 'RENTAL' as type, t.id, t.number, t.start_at as "at", t.customer_snapshot->>'name' as "customerName",
        t.vehicle_snapshot->>'plateNumber' as "plateNumber", t.status::text as status, t.pickup_location as location
      from rental_transactions t where t.company_id = ${companyId} and t.status = 'SCHEDULED'
        and (t.start_at at time zone ${tz})::date <= ${today}::date
      union all
      select 'RESERVATION', r.id, r.number, r.start_at, r.customer_snapshot->>'name', r.vehicle_snapshot->>'plateNumber', r.status::text, r.pickup_location
      from reservations r where r.company_id = ${companyId} and r.status in ('PENDING','CONFIRMED')
        and (r.start_at at time zone ${tz})::date = ${today}::date
      order by "at" limit 20`)).rows;

    const returns = (await tx.execute(sql`
      select t.id, t.number, t.end_at as "at", t.customer_snapshot->>'name' as "customerName", t.customer_snapshot->>'phone' as "customerPhone",
        t.vehicle_snapshot->>'plateNumber' as "plateNumber", (t.end_at < now()) as overdue, t.return_location as location
      from rental_transactions t where t.company_id = ${companyId} and t.status = 'ONGOING'
        and (t.end_at at time zone ${tz})::date <= ${today}::date + 1
      order by t.end_at limit 20`)).rows;

    const recent = (await tx.execute(sql`
      (select 'RENTAL' as type, t.id, t.number, t.created_at as "at", t.customer_snapshot->>'name' as label, ${finance ? sql`t.total` : sql`null::numeric`} as amount, t.status::text as status
        from rental_transactions t where t.company_id = ${companyId} order by t.created_at desc limit 6)
      union all
      (select 'PAYMENT', p.id, p.number, p.created_at, c.name, ${finance || can(req, 'payment.view') ? sql`p.amount` : sql`null::numeric`}, p.kind::text
        from payments p join customers c on c.id = p.customer_id where p.company_id = ${companyId} and ${can(req, 'payment.view')} order by p.created_at desc limit 6)
      union all
      (select 'RESERVATION', r.id, r.number, r.created_at, r.customer_snapshot->>'name', null::numeric, r.status::text
        from reservations r where r.company_id = ${companyId} order by r.created_at desc limit 4)
      order by "at" desc limit 10`)).rows;

    return { period: { from, to, today }, fleet, rentalCount: (rentalCount as { n: number }).n, money, revenueSeries, monthly, byVehicle, byCustomer, pickups, returns, recent };
  });
  res.json(data);
});
