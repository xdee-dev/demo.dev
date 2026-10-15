import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant } from '../db/tenant.js';
import type { Tx } from '../db/client.js';
import { expenses, otherIncomes } from '../db/schema.js';
import { perm } from '../auth/middleware.js';
import { body, parse, query, listQuery, paged, zUuid, zOptDate, zDate, zMoney, zOptText, zOptUuid, zText, likeTerm, idempotencyKey } from '../lib/http.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { nextNumber } from '../lib/numbering.js';
import { getSettings, type CompanySettings } from '../lib/settings.js';
import { formatIDR, D } from '../lib/money.js';
import { paymentInput, postPayment, reversePayment } from '../services/payment.js';

export const financeRouter = Router();

/* ================================================================ payments */

financeRouter.get('/payments', perm('payment.view'), async (req, res) => {
  const q = query(req, listQuery.extend({
    from: zOptDate, to: zOptDate, method: z.string().max(20).optional(), cashAccountId: z.uuid().optional(),
    kind: z.enum(['PAYMENT', 'REFUND', 'REVERSAL']).optional(), rentalId: z.uuid().optional(), customerId: z.uuid().optional(),
  }));
  const { companyId, timezone } = req.ctx!;
  const sortCols: Record<string, string> = { paidAt: 'p.paid_at', amount: 'p.amount', number: 'p.number' };
  const result = await withTenant(companyId, async (tx) => {
    const where = sql`p.company_id = ${companyId}
      ${q.from ? sql`and p.paid_at >= (${q.from}::date)::timestamp at time zone ${timezone}` : sql``}
      ${q.to ? sql`and p.paid_at < ((${q.to}::date + 1)::timestamp at time zone ${timezone})` : sql``}
      ${q.method ? sql`and p.method = ${q.method}` : sql``}
      ${q.cashAccountId ? sql`and p.cash_account_id = ${q.cashAccountId}` : sql``}
      ${q.kind ? sql`and p.kind = ${q.kind}` : sql``}
      ${q.rentalId ? sql`and p.rental_id = ${q.rentalId}` : sql``}
      ${q.customerId ? sql`and p.customer_id = ${q.customerId}` : sql``}
      ${q.q ? sql`and (p.number ilike ${likeTerm(q.q)} or p.reference ilike ${likeTerm(q.q)} or c.name ilike ${likeTerm(q.q)} or t.number ilike ${likeTerm(q.q)} or rs.number ilike ${likeTerm(q.q)})` : sql``}`;
    const from = sql`from payments p join customers c on c.id = p.customer_id
      left join rental_transactions t on t.id = p.rental_id left join reservations rs on rs.id = p.reservation_id
      left join cash_accounts ca on ca.id = p.cash_account_id`;
    const agg = await tx.execute<{ n: number; total: string }>(sql`select count(*)::int as n, coalesce(sum(p.amount),0) as total ${from} where ${where}`);
    const rows = await tx.execute(sql`
      select p.id, p.number, p.kind, p.amount, p.paid_at as "paidAt", p.method, p.reference, p.is_down_payment as "isDownPayment",
        p.rental_id as "rentalId", t.number as "rentalNumber", p.reservation_id as "reservationId", rs.number as "reservationNumber",
        c.id as "customerId", c.name as "customerName", ca.name as "cashAccountName", p.reverses_payment_id as "reversesPaymentId",
        exists (select 1 from payments r where r.reverses_payment_id = p.id) as reversed
      ${from} where ${where}
      order by ${sql.raw(sortCols[q.sort ?? ''] ?? 'p.paid_at')} ${sql.raw(q.dir)}, p.created_at desc
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return { ...paged(rows.rows, agg.rows[0].n, q), sum: agg.rows[0].total };
  });
  res.json(result);
});

financeRouter.get('/payments/:id', perm('payment.view'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  const data = await withTenant(companyId, async (tx) => {
    const r = await tx.execute(sql`
      select p.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, ca.name as cash_account_name,
        ca.bank_name, ca.account_number, u.name as created_by_name,
        exists (select 1 from payments r where r.reverses_payment_id = p.id) as reversed,
        (select number from payments o where o.id = p.reverses_payment_id) as reverses_number
      from payments p join customers c on c.id = p.customer_id left join cash_accounts ca on ca.id = p.cash_account_id
      left join users u on u.id = p.created_by
      where p.id = ${id} and p.company_id = ${companyId}`);
    if (!r.rows.length) throw notFound('Pembayaran');
    const p = r.rows[0] as Record<string, unknown>;
    let rental = null; let balance = null; let reservation = null;
    if (p.rental_id) {
      rental = (await tx.execute(sql`select id, number, invoice_number as "invoiceNumber", start_at as "startAt", end_at as "endAt", total, status,
        customer_snapshot as "customerSnapshot", vehicle_snapshot as "vehicleSnapshot", company_snapshot as "companySnapshot", rental_type as "rentalType", quantity
        from rental_transactions where id = ${p.rental_id as string}`)).rows[0];
      // balance as of this payment (receipts must not change when later payments arrive)
      balance = (await tx.execute(sql`
        select b.amount_due as "amountDue",
          (select coalesce(sum(x.amount),0) from payments x where x.rental_id = ${p.rental_id as string} and (x.paid_at, x.created_at) <= (${p.paid_at as Date}::timestamptz, ${p.created_at as Date}::timestamptz)) as "paidToDate"
        from rental_balances b where b.rental_id = ${p.rental_id as string}`)).rows[0];
    } else if (p.reservation_id) {
      reservation = (await tx.execute(sql`select id, number, start_at as "startAt", end_at as "endAt", total, customer_snapshot as "customerSnapshot",
        vehicle_snapshot as "vehicleSnapshot", company_snapshot as "companySnapshot" from reservations where id = ${p.reservation_id as string}`)).rows[0];
    }
    return { payment: p, rental, reservation, balance };
  });
  res.json(data);
});

financeRouter.post('/payments', perm('payment.manage'), async (req, res) => {
  const input = body(req, paymentInput);
  const key = idempotencyKey(req);
  const { companyId, timezone } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => postPayment(tx, req, companyId, timezone, await getSettings(tx, companyId), input, key));
  res.status(result.replay ? 200 : 201).json({ ...result.payment, replay: result.replay });
});

financeRouter.post('/payments/:id/reverse', perm('payment.reverse'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { reason } = body(req, z.object({ reason: zText(500).min(3, 'Alasan wajib diisi') }));
  const { companyId, timezone } = req.ctx!;
  const rev = await withTenant(companyId, async (tx) => reversePayment(tx, req, companyId, timezone, await getSettings(tx, companyId), id, reason));
  res.status(201).json(rev);
});

/* ====================================================== receivables (piutang) */

financeRouter.get('/receivables', perm('payment.view'), async (req, res) => {
  const q = query(req, listQuery.extend({ customerId: z.uuid().optional() }));
  const { companyId } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    const where = sql`t.company_id = ${companyId} and b.balance > 0
      ${q.customerId ? sql`and t.customer_id = ${q.customerId}` : sql``}
      ${q.q ? sql`and (t.number ilike ${likeTerm(q.q)} or t.customer_snapshot->>'name' ilike ${likeTerm(q.q)})` : sql``}`;
    const agg = await tx.execute<{ n: number; total: string }>(sql`select count(*)::int as n, coalesce(sum(b.balance),0) as total
      from rental_transactions t join rental_balances b on b.rental_id = t.id where ${where}`);
    const rows = await tx.execute(sql`
      select t.id, t.number, t.invoice_number as "invoiceNumber", t.status, t.start_at as "startAt", t.end_at as "endAt",
        t.customer_id as "customerId", t.customer_snapshot->>'name' as "customerName", t.customer_snapshot->>'phone' as "customerPhone",
        t.vehicle_snapshot->>'plateNumber' as "plateNumber", b.amount_due as "amountDue", b.paid, b.balance, b.payment_status as "paymentStatus",
        greatest(0, extract(day from now() - t.end_at))::int as "daysOutstanding"
      from rental_transactions t join rental_balances b on b.rental_id = t.id
      where ${where} order by t.end_at asc
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return { ...paged(rows.rows, agg.rows[0].n, q), sum: agg.rows[0].total };
  });
  res.json(result);
});

/* ======================================================= expenses & incomes */

const expenseInput = z.object({
  expenseDate: zDate,
  categoryId: zUuid,
  vehicleId: zOptUuid,
  rentalId: zOptUuid,
  description: zText(300).min(2, 'Deskripsi wajib diisi'),
  amount: zMoney.refine((v) => D(v).gt(0), 'Nominal harus lebih dari 0'),
  method: z.string().trim().min(1).max(20),
  cashAccountId: zOptUuid,
  proofFileId: zOptUuid,
  notes: zOptText(1000),
});

const incomeInput = z.object({
  incomeDate: zDate,
  category: zText(60).min(2),
  description: zText(300).min(2, 'Deskripsi wajib diisi'),
  amount: zMoney.refine((v) => D(v).gt(0), 'Nominal harus lebih dari 0'),
  method: z.string().trim().min(1).max(20),
  cashAccountId: zOptUuid,
  proofFileId: zOptUuid,
  notes: zOptText(1000),
});

async function validateFinanceRefs(tx: Tx, companyId: string, settings: CompanySettings, v: { method: string; cashAccountId?: string | null; proofFileId?: string | null; vehicleId?: string | null; rentalId?: string | null; categoryId?: string }, proofKind: string) {
  if (!settings.paymentMethods.some((m) => m.code === v.method)) throw badRequest('Metode pembayaran tidak dikenal');
  const checks: [string | null | undefined, ReturnType<typeof sql>, string][] = [
    [v.cashAccountId, sql`select 1 from cash_accounts where id = ${v.cashAccountId ?? null} and company_id = ${companyId}`, 'Akun kas tidak valid'],
    [v.proofFileId, sql`select 1 from file_attachments where id = ${v.proofFileId ?? null} and company_id = ${companyId} and kind = ${proofKind}`, 'Bukti tidak valid'],
    [v.vehicleId, sql`select 1 from vehicles where id = ${v.vehicleId ?? null} and company_id = ${companyId}`, 'Kendaraan tidak valid'],
    [v.rentalId, sql`select 1 from rental_transactions where id = ${v.rentalId ?? null} and company_id = ${companyId}`, 'Transaksi tidak valid'],
    [v.categoryId, sql`select 1 from expense_categories where id = ${v.categoryId ?? null} and company_id = ${companyId} and is_active`, 'Kategori tidak valid'],
  ];
  for (const [val, q, msg] of checks) {
    if (val && !(await tx.execute(q)).rows.length) throw badRequest(msg);
  }
}

financeRouter.get('/expenses', perm('expense.view'), async (req, res) => {
  const q = query(req, listQuery.extend({
    from: zOptDate, to: zOptDate, categoryId: z.uuid().optional(), vehicleId: z.uuid().optional(), status: z.enum(['POSTED', 'VOID']).optional(),
  }));
  const { companyId } = req.ctx!;
  const sortCols: Record<string, string> = { expenseDate: 'e.expense_date', amount: 'e.amount', number: 'e.number' };
  const result = await withTenant(companyId, async (tx) => {
    const where = sql`e.company_id = ${companyId}
      ${q.from ? sql`and e.expense_date >= ${q.from}::date` : sql``}
      ${q.to ? sql`and e.expense_date <= ${q.to}::date` : sql``}
      ${q.categoryId ? sql`and e.category_id = ${q.categoryId}` : sql``}
      ${q.vehicleId ? sql`and e.vehicle_id = ${q.vehicleId}` : sql``}
      ${q.status ? sql`and e.status = ${q.status}` : sql``}
      ${q.q ? sql`and (e.number ilike ${likeTerm(q.q)} or e.description ilike ${likeTerm(q.q)} or v.plate_number ilike ${likeTerm(q.q)})` : sql``}`;
    const from = sql`from expenses e join expense_categories c on c.id = e.category_id left join vehicles v on v.id = e.vehicle_id
      left join rental_transactions t on t.id = e.rental_id left join cash_accounts ca on ca.id = e.cash_account_id`;
    const agg = await tx.execute<{ n: number; total: string }>(sql`select count(*)::int as n, coalesce(sum(e.amount) filter (where e.status = 'POSTED'),0) as total ${from} where ${where}`);
    const rows = await tx.execute(sql`
      select e.id, e.number, e.expense_date as "expenseDate", e.category_id as "categoryId", c.name as "categoryName", e.description, e.amount,
        e.method, e.cash_account_id as "cashAccountId", ca.name as "cashAccountName", e.vehicle_id as "vehicleId", v.plate_number as "plateNumber",
        e.rental_id as "rentalId", t.number as "rentalNumber", e.maintenance_id as "maintenanceId", e.proof_file_id as "proofFileId",
        e.notes, e.status, e.void_reason as "voidReason", e.created_at as "createdAt"
      ${from} where ${where}
      order by ${sql.raw(sortCols[q.sort ?? ''] ?? 'e.expense_date')} ${sql.raw(q.dir)}, e.created_at desc
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return { ...paged(rows.rows, agg.rows[0].n, q), sum: agg.rows[0].total };
  });
  res.json(result);
});

financeRouter.post('/expenses', perm('expense.manage'), async (req, res) => {
  const input = body(req, expenseInput);
  const key = idempotencyKey(req);
  const { companyId, timezone } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    if (key) {
      const existing = await tx.query.expenses.findFirst({ where: and(eq(expenses.companyId, companyId), eq(expenses.idempotencyKey, key)) });
      if (existing) return { row: existing, replay: true };
    }
    const settings = await getSettings(tx, companyId);
    await validateFinanceRefs(tx, companyId, settings, input, 'EXPENSE_PROOF');
    const number = await nextNumber(tx, companyId, 'EXPENSE', settings, timezone);
    const [e] = await tx.insert(expenses).values({ ...input, companyId, number, idempotencyKey: key, createdBy: req.user!.id, updatedBy: req.user!.id }).returning();
    if (input.proofFileId) await tx.execute(sql`update file_attachments set entity_type = 'expense', entity_id = ${e.id} where id = ${input.proofFileId}`);
    await audit(tx, req, { action: 'expense.create', entityType: 'expense', entityId: e.id, summary: `${e.number} ${formatIDR(e.amount)} — ${e.description}` });
    return { row: e, replay: false };
  });
  res.status(result.replay ? 200 : 201).json(result.row);
});

financeRouter.put('/expenses/:id', perm('expense.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const input = body(req, expenseInput);
  const { companyId } = req.ctx!;
  const row = await withTenant(companyId, async (tx) => {
    const before = await tx.query.expenses.findFirst({ where: and(eq(expenses.id, id), eq(expenses.companyId, companyId)) });
    if (!before) throw notFound('Pengeluaran');
    if (before.status === 'VOID') throw badRequest('Pengeluaran yang sudah di-void tidak dapat diubah');
    if (before.maintenanceId) throw badRequest('Pengeluaran ini berasal dari catatan perawatan — ubah melalui menu Perawatan');
    await validateFinanceRefs(tx, companyId, await getSettings(tx, companyId), input, 'EXPENSE_PROOF');
    const [e] = await tx.update(expenses).set({ ...input, updatedBy: req.user!.id }).where(eq(expenses.id, id)).returning();
    const d = diff(before as Record<string, unknown>, input);
    if (d.changed) await audit(tx, req, { action: 'expense.update', entityType: 'expense', entityId: id, summary: e.number, before: d.before, after: d.after });
    return e;
  });
  res.json(row);
});

async function voidPosting(req: Request, table: 'expenses' | 'other_incomes', id: string, reason: string) {
  const { companyId } = req.ctx!;
  return withTenant(companyId, async (tx) => {
    const tbl = table === 'expenses' ? expenses : otherIncomes;
    const before = await tx.select().from(tbl).where(and(eq(tbl.id, id), eq(tbl.companyId, companyId))).limit(1);
    if (!before.length) throw notFound(table === 'expenses' ? 'Pengeluaran' : 'Pemasukan');
    const b = before[0] as { status: string; number: string; amount: string; maintenanceId?: string | null };
    if (b.status === 'VOID') throw badRequest('Sudah di-void');
    if (b.maintenanceId) throw badRequest('Pengeluaran ini berasal dari catatan perawatan — batalkan melalui menu Perawatan');
    const [row] = await tx.update(tbl).set({ status: 'VOID', voidReason: reason, voidedAt: new Date(), voidedBy: req.user!.id }).where(eq(tbl.id, id)).returning();
    await audit(tx, req, { action: `${table === 'expenses' ? 'expense' : 'income'}.void`, entityType: table === 'expenses' ? 'expense' : 'income', entityId: id,
      summary: `${b.number} ${formatIDR(b.amount)} di-void: ${reason}`, before: { status: 'POSTED' }, after: { status: 'VOID', reason } });
    return row;
  });
}

financeRouter.post('/expenses/:id/void', perm('expense.void'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { reason } = body(req, z.object({ reason: zText(500).min(3, 'Alasan wajib diisi') }));
  res.json(await voidPosting(req, 'expenses', id, reason));
});

financeRouter.get('/incomes', perm('income.view'), async (req, res) => {
  const q = query(req, listQuery.extend({ from: zOptDate, to: zOptDate, status: z.enum(['POSTED', 'VOID']).optional() }));
  const { companyId } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    const where = sql`i.company_id = ${companyId}
      ${q.from ? sql`and i.income_date >= ${q.from}::date` : sql``}
      ${q.to ? sql`and i.income_date <= ${q.to}::date` : sql``}
      ${q.status ? sql`and i.status = ${q.status}` : sql``}
      ${q.q ? sql`and (i.number ilike ${likeTerm(q.q)} or i.description ilike ${likeTerm(q.q)} or i.category ilike ${likeTerm(q.q)})` : sql``}`;
    const agg = await tx.execute<{ n: number; total: string }>(sql`select count(*)::int as n, coalesce(sum(i.amount) filter (where i.status='POSTED'),0) as total from other_incomes i where ${where}`);
    const rows = await tx.execute(sql`
      select i.id, i.number, i.income_date as "incomeDate", i.category, i.description, i.amount, i.method, i.cash_account_id as "cashAccountId",
        ca.name as "cashAccountName", i.proof_file_id as "proofFileId", i.notes, i.status, i.void_reason as "voidReason"
      from other_incomes i left join cash_accounts ca on ca.id = i.cash_account_id where ${where}
      order by i.income_date ${sql.raw(q.dir)}, i.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return { ...paged(rows.rows, agg.rows[0].n, q), sum: agg.rows[0].total };
  });
  res.json(result);
});

/** Unified cash-in ledger: rental payments (net of refunds/reversals) + other income. */
financeRouter.get('/cash-in', perm('payment.view', 'income.view'), async (req, res) => {
  const q = query(req, listQuery.extend({ from: zOptDate, to: zOptDate, cashAccountId: z.uuid().optional() }));
  const { companyId, timezone } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    const base = sql`
      select 'PAYMENT' as source, p.id, p.number, (p.paid_at at time zone ${timezone})::date as date, p.paid_at as ts, p.kind::text as kind,
        coalesce(t.number, rs.number) || ' — ' || c.name as description, p.amount, p.method, ca.name as "cashAccountName", p.cash_account_id as cash_account_id
      from payments p join customers c on c.id = p.customer_id left join rental_transactions t on t.id = p.rental_id
      left join reservations rs on rs.id = p.reservation_id left join cash_accounts ca on ca.id = p.cash_account_id
      where p.company_id = ${companyId}
      union all
      select 'INCOME', i.id, i.number, i.income_date, i.income_date::timestamp at time zone ${timezone}, 'INCOME', i.category || ' — ' || i.description, i.amount, i.method, ca.name, i.cash_account_id
      from other_incomes i left join cash_accounts ca on ca.id = i.cash_account_id
      where i.company_id = ${companyId} and i.status = 'POSTED'`;
    const where = sql`true
      ${q.from ? sql`and x.date >= ${q.from}::date` : sql``}
      ${q.to ? sql`and x.date <= ${q.to}::date` : sql``}
      ${q.cashAccountId ? sql`and x.cash_account_id = ${q.cashAccountId}` : sql``}
      ${q.q ? sql`and (x.number ilike ${likeTerm(q.q)} or x.description ilike ${likeTerm(q.q)})` : sql``}`;
    const agg = await tx.execute<{ n: number; total: string }>(sql`select count(*)::int as n, coalesce(sum(x.amount),0) as total from (${base}) x where ${where}`);
    const rows = await tx.execute(sql`select x.* from (${base}) x where ${where} order by x.ts ${sql.raw(q.dir)} limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return { ...paged(rows.rows, agg.rows[0].n, q), sum: agg.rows[0].total };
  });
  res.json(result);
});

financeRouter.post('/incomes', perm('income.manage'), async (req, res) => {
  const input = body(req, incomeInput);
  const key = idempotencyKey(req);
  const { companyId, timezone } = req.ctx!;
  const result = await withTenant(companyId, async (tx) => {
    if (key) {
      const existing = await tx.query.otherIncomes.findFirst({ where: and(eq(otherIncomes.companyId, companyId), eq(otherIncomes.idempotencyKey, key)) });
      if (existing) return { row: existing, replay: true };
    }
    const settings = await getSettings(tx, companyId);
    await validateFinanceRefs(tx, companyId, settings, input, 'INCOME_PROOF');
    const number = await nextNumber(tx, companyId, 'INCOME', settings, timezone);
    const [i] = await tx.insert(otherIncomes).values({ ...input, companyId, number, idempotencyKey: key, createdBy: req.user!.id }).returning();
    await audit(tx, req, { action: 'income.create', entityType: 'income', entityId: i.id, summary: `${i.number} ${formatIDR(i.amount)} — ${i.description}` });
    return { row: i, replay: false };
  });
  res.status(result.replay ? 200 : 201).json(result.row);
});

financeRouter.post('/incomes/:id/void', perm('income.manage'), async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { reason } = body(req, z.object({ reason: zText(500).min(3, 'Alasan wajib diisi') }));
  res.json(await voidPosting(req, 'other_incomes', id, reason));
});
