import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Download } from 'lucide-react';
import { api, newIdempotencyKey } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction, useFieldErrors } from '../lib/hooks';
import { formatDate, formatDateTime, formatMoney, todayLocal } from '../lib/format';
import { PAYMENT_KIND, PAYMENT_STATUS, RENTAL_STATUS } from '../lib/labels';
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, StatusBadge, Textarea, useConfirm, cx, Tabs } from '../components/ui';
import { DataTable, SearchBox, useList, useListState, type Column } from '../components/DataTable';
import { Combobox, DateInput, FileLink, FileUpload, MoneyInput, Plate } from '../components/inputs';
import { PaymentDialog } from '../components/PaymentDialog';

type Tab = 'payments' | 'incomes' | 'expenses' | 'receivables';

export default function Finance({ tab }: { tab: Tab }) {
  if (tab === 'payments') return <Payments />;
  if (tab === 'incomes') return <Incomes />;
  if (tab === 'expenses') return <Expenses />;
  return <Receivables />;
}

function DateRange({ state }: { state: ReturnType<typeof useListState> }) {
  return <>
    <input type="date" className="input w-auto" value={state.get('from')} onChange={(e) => state.set({ from: e.target.value })} aria-label="Dari tanggal" />
    <input type="date" className="input w-auto" value={state.get('to')} onChange={(e) => state.set({ to: e.target.value })} aria-label="Sampai tanggal" />
  </>;
}

function SumBar({ label, sum }: { label: string; sum?: string }) {
  if (sum === undefined) return null;
  return <div className="flex items-baseline justify-between border-b border-line bg-paper/60 px-4 py-2.5 text-sm"><span className="text-muted">{label}</span><span className="num text-[16px] font-semibold">{formatMoney(sum)}</span></div>;
}

/* ================================================================ payments */

function Payments() {
  const state = useListState({ sort: 'paidAt', dir: 'desc' });
  const list = useList<Row>('/payments', state);
  const { can, settings } = useAuth();
  const confirm = useConfirm();
  const [pick, setPick] = useState(false);
  const [target, setTarget] = useState<Row | null>(null);
  const reverse = useAction(({ id, reason }: { id: string; reason: string }) => api.post(`/payments/${id}/reverse`, { reason }), { success: 'Reversal tercatat' });
  const navigate = useNavigate();
  const cols: Column<Row>[] = [
    { key: 'number', header: 'No. kwitansi', sortKey: 'number', render: (r) => <span className={cx('font-medium', r.reversed && 'line-through text-muted')}>{r.number}</span> },
    { key: 'paidAt', header: 'Tanggal', sortKey: 'paidAt', render: (r) => formatDateTime(r.paidAt) },
    { key: 'customer', header: 'Customer', render: (r) => r.customerName },
    { key: 'ref', header: 'Transaksi', hideBelow: 'md', render: (r) => r.rentalNumber ? <button type="button" className="text-brand hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/rentals/${r.rentalId}`); }}>{r.rentalNumber}</button> : r.reservationNumber ?? '—' },
    { key: 'kind', header: 'Jenis', render: (r) => <span className="flex gap-1"><StatusBadge map={PAYMENT_KIND} value={r.kind} />{r.isDownPayment && <Badge tone="brand">DP</Badge>}</span> },
    { key: 'method', header: 'Metode', hideBelow: 'lg', render: (r) => <span>{settings?.paymentMethods.find((m) => m.code === r.method)?.label ?? r.method}{r.cashAccountName && <span className="block text-[12px] text-muted">{r.cashAccountName}</span>}</span> },
    { key: 'amount', header: 'Nominal', align: 'right', sortKey: 'amount', render: (r) => <span className={cx(Number(r.amount) < 0 && 'text-danger')}>{formatMoney(r.amount)}</span> },
    { key: 'act', header: '', align: 'right', render: (r) => (
      <span className="flex justify-end gap-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        {r.kind !== 'REVERSAL' && <a className="text-sm text-brand hover:underline" href={`/print/receipt/${r.id}`} target="_blank" rel="noopener">Kwitansi</a>}
        {can('payment.reverse') && r.kind !== 'REVERSAL' && !r.reversed && <button type="button" className="text-sm text-danger hover:underline" onClick={async () => {
          const res = await confirm({ title: `Batalkan ${r.number}?`, message: 'Entri reversal dengan nominal berlawanan akan dibuat. Pembayaran asli tidak dihapus.', confirmLabel: 'Buat reversal', tone: 'danger', reason: { label: 'Alasan', required: true } });
          if (res.ok) reverse.mutate({ id: r.id, reason: res.reason });
        }}>Batalkan</button>}
      </span>) },
  ];
  return (
    <>
      <PageHeader title="Pembayaran" description="Semua pembayaran, DP, refund, dan reversal. Pembayaran yang sudah diposting tidak dapat dihapus."
        actions={can('payment.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setPick(true)}>Catat pembayaran</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari no. kwitansi, customer, transaksi…" />
          <DateRange state={state} />
          <select className="input w-auto" value={state.get('method')} onChange={(e) => state.set({ method: e.target.value })} aria-label="Metode">
            <option value="">Semua metode</option>{settings?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <select className="input w-auto" value={state.get('kind')} onChange={(e) => state.set({ kind: e.target.value })} aria-label="Jenis">
            <option value="">Semua jenis</option>{Object.entries(PAYMENT_KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <SumBar label="Total neto (sesuai filter)" sum={list.data?.sum} />
        <DataTable columns={cols} query={list} state={state}
          mobileCard={(r) => <div className="flex justify-between gap-3"><div><p className="font-medium">{r.number}</p><p className="text-[13px] text-muted">{r.customerName} · {formatDate(r.paidAt)}</p></div><span className={cx('num font-medium', Number(r.amount) < 0 && 'text-danger')}>{formatMoney(r.amount)}</span></div>}
          empty={<EmptyState title="Belum ada pembayaran" />} />
      </div>
      <RentalPicker open={pick} onClose={() => setPick(false)} onPick={(r) => { setPick(false); setTarget(r); }} />
      {target && <PaymentDialog open onClose={() => setTarget(null)} target={{ rentalId: target.id, label: `${target.number} — ${target.customerName}` }} balance={target.balance} />}
    </>
  );
}

function RentalPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (r: Row) => void }) {
  const [sel, setSel] = useState<Row | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Pilih transaksi" footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button disabled={!sel} onClick={() => sel && onPick(sel)}>Lanjut</Button></>}>
      <Combobox label="Transaksi dengan sisa tagihan" value={sel?.id ?? null} selectedLabel={sel ? `${sel.number} — ${sel.customerName}` : ''} queryKey={['receivable-lookup']}
        fetchOptions={async (q) => (await api.get<{ data: Row[] }>('/receivables', { q, pageSize: 20 })).data.map((r) => ({ id: r.id, label: `${r.number} — ${r.customerName}`, sub: `Sisa ${formatMoney(r.balance)} · ${PAYMENT_STATUS[r.paymentStatus]?.[0]}`, data: r }))}
        onChange={(_id, o) => setSel((o?.data as Row) ?? null)} />
      <p className="mt-2 text-[13px] text-muted">Untuk uang muka reservasi, buka halaman reservasi lalu pilih "Terima DP".</p>
    </Modal>
  );
}

/* ================================================================ receivables */

function Receivables() {
  const state = useListState();
  const list = useList<Row>('/receivables', state);
  const navigate = useNavigate();
  const { can } = useAuth();
  const [target, setTarget] = useState<Row | null>(null);
  const cols: Column<Row>[] = [
    { key: 'number', header: 'No. transaksi', render: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div>{r.customerName}<div className="text-[12.5px] text-muted">{r.customerPhone}</div></div> },
    { key: 'vehicle', header: 'Kendaraan', hideBelow: 'md', render: (r) => <Plate size="sm">{r.plateNumber}</Plate> },
    { key: 'endAt', header: 'Jatuh tempo', render: (r) => <span>{formatDate(r.endAt)}{r.daysOutstanding > 0 && <span className={cx('block text-[12px]', r.daysOutstanding > 30 ? 'text-danger' : 'text-warn')}>{r.daysOutstanding} hari</span>}</span> },
    { key: 'status', header: 'Status', hideBelow: 'lg', render: (r) => <StatusBadge map={RENTAL_STATUS} value={r.status} /> },
    { key: 'amountDue', header: 'Tagihan', align: 'right', hideBelow: 'sm', render: (r) => formatMoney(r.amountDue) },
    { key: 'paid', header: 'Dibayar', align: 'right', hideBelow: 'md', render: (r) => formatMoney(r.paid) },
    { key: 'balance', header: 'Sisa piutang', align: 'right', render: (r) => <b className="text-warn">{formatMoney(r.balance)}</b> },
    ...(can('payment.manage') ? [{ key: 'a', header: '', align: 'right' as const, render: (r: Row) => <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setTarget(r); }}>Bayar</Button> }] : []),
  ];
  return (
    <>
      <PageHeader title="Piutang" description="Transaksi dengan tagihan yang belum lunas, diurutkan dari jatuh tempo terlama." actions={<Button variant="secondary" onClick={() => navigate('/reports/piutang')}>Laporan piutang</Button>} />
      <div className="card">
        <div className="border-b border-line p-3"><SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari transaksi atau customer…" /></div>
        <SumBar label="Total piutang" sum={list.data?.sum} />
        <DataTable columns={cols} query={list} state={state} onRowClick={(r) => navigate(`/rentals/${r.id}`)}
          mobileCard={(r) => <div className="flex justify-between gap-3"><div><p className="font-medium">{r.customerName}</p><p className="text-[13px] text-muted">{r.number} · {formatDate(r.endAt)}</p></div><b className="num text-warn">{formatMoney(r.balance)}</b></div>}
          empty={<EmptyState title="Tidak ada piutang" description="Semua transaksi sudah lunas." />} />
      </div>
      {target && <PaymentDialog open onClose={() => setTarget(null)} target={{ rentalId: target.id, label: `${target.number} — ${target.customerName}` }} balance={target.balance} />}
    </>
  );
}

/* ================================================================ incomes */

function Incomes() {
  const [tab, setTab] = useState<'ledger' | 'other'>('ledger');
  const ledgerState = useListState({ dir: 'desc' });
  const ledger = useList<Row>('/cash-in', ledgerState);
  const otherState = useListState({ dir: 'desc' });
  const other = useList<Row>('/incomes', otherState);
  const { can, settings, activeCompanyId } = useAuth();
  const confirm = useConfirm();
  const [form, setForm] = useState<Row | null>(null);
  const key = useRef(newIdempotencyKey());
  const accounts = useQuery({ queryKey: ['cash-accounts', activeCompanyId], queryFn: () => api.get<Row[]>('/cash-accounts') });
  const fe = useFieldErrors();
  const save = useAction(() => api.post('/incomes', { ...form, cashAccountId: form!.cashAccountId || null, proofFileId: form!.proof?.id ?? null }, { 'Idempotency-Key': key.current }),
    { success: 'Pemasukan dicatat', fieldErrors: fe, onSuccess: () => setForm(null) });
  const voidIt = useAction(({ id, reason }: { id: string; reason: string }) => api.post(`/incomes/${id}/void`, { reason }), { success: 'Pemasukan di-void' });
  const ledgerCols: Column<Row>[] = [
    { key: 'date', header: 'Tanggal', render: (r) => formatDate(r.date) },
    { key: 'number', header: 'No. bukti', render: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'source', header: 'Sumber', render: (r) => <Badge tone={r.source === 'INCOME' ? 'brand' : 'teal'}>{r.source === 'INCOME' ? 'Pemasukan lain' : PAYMENT_KIND[r.kind]?.[0] ?? 'Pembayaran'}</Badge> },
    { key: 'description', header: 'Keterangan', className: 'wrap', render: (r) => r.description },
    { key: 'account', header: 'Akun', hideBelow: 'lg', render: (r) => r.cashAccountName ?? '—' },
    { key: 'amount', header: 'Nominal', align: 'right', render: (r) => <span className={cx(Number(r.amount) < 0 && 'text-danger')}>{formatMoney(r.amount)}</span> },
  ];
  const otherCols: Column<Row>[] = [
    { key: 'incomeDate', header: 'Tanggal', render: (r) => formatDate(r.incomeDate) },
    { key: 'number', header: 'Nomor', render: (r) => <span className={cx('font-medium', r.status === 'VOID' && 'line-through text-muted')}>{r.number}</span> },
    { key: 'category', header: 'Kategori', render: (r) => r.category },
    { key: 'description', header: 'Keterangan', className: 'wrap', render: (r) => <>{r.description}{r.status === 'VOID' && <span className="block text-[12px] text-danger">Void: {r.voidReason}</span>}</> },
    { key: 'amount', header: 'Nominal', align: 'right', render: (r) => formatMoney(r.amount) },
    { key: 'a', header: '', align: 'right', render: (r) => <span className="flex justify-end gap-3">{r.proofFileId && <FileLink id={r.proofFileId} name="Bukti" />}{can('income.manage') && r.status === 'POSTED' && <button type="button" className="text-sm text-danger hover:underline" onClick={async () => {
      const res = await confirm({ title: `Void ${r.number}?`, message: 'Pemasukan akan dikeluarkan dari laporan. Data tetap tersimpan dan tercatat di audit log.', confirmLabel: 'Void', tone: 'danger', reason: { label: 'Alasan', required: true } });
      if (res.ok) voidIt.mutate({ id: r.id, reason: res.reason });
    }}>Void</button>}</span> },
  ];
  const openForm = () => { key.current = newIdempotencyKey(); setForm({ incomeDate: todayLocal(), category: '', description: '', amount: '', method: settings?.paymentMethods[0]?.code ?? 'CASH', cashAccountId: '', notes: '', proof: null }); };
  return (
    <>
      <PageHeader title="Pemasukan" description="Buku kas masuk: pembayaran customer (neto setelah refund/reversal) ditambah pemasukan di luar rental."
        actions={can('income.manage') && <Button icon={<Plus className="size-4" />} onClick={openForm}>Catat pemasukan lain</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'ledger', label: 'Buku kas masuk' }, { value: 'other', label: 'Pemasukan lain' }]} />
      {tab === 'ledger' ? (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <SearchBox value={ledgerState.search} onChange={ledgerState.setSearch} placeholder="Cari nomor atau keterangan…" />
            <DateRange state={ledgerState} />
            <select className="input w-auto" value={ledgerState.get('cashAccountId')} onChange={(e) => ledgerState.set({ cashAccountId: e.target.value })} aria-label="Akun">
              <option value="">Semua akun</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <SumBar label="Total kas masuk (sesuai filter)" sum={ledger.data?.sum} />
          <DataTable columns={ledgerCols} query={ledger} state={ledgerState} empty={<EmptyState title="Belum ada kas masuk" />} />
        </div>
      ) : (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3"><SearchBox value={otherState.search} onChange={otherState.setSearch} /><DateRange state={otherState} /></div>
          <SumBar label="Total (tidak termasuk void)" sum={other.data?.sum} />
          <DataTable columns={otherCols} query={other} state={otherState} empty={<EmptyState title="Belum ada pemasukan lain" description="Contoh: penjualan aset bekas, komisi, atau pendapatan di luar sewa." />} />
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="Catat pemasukan lain" footer={<><Button variant="secondary" onClick={() => setForm(null)}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Simpan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          <DateInput label="Tanggal" required value={form.incomeDate} onChange={(x) => setForm({ ...form, incomeDate: x })} />
          <Input label="Kategori" required placeholder="Mis. Penjualan aset" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} error={fe.errors.category} />
          <Input className="sm:col-span-2" label="Keterangan" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={fe.errors.description} />
          <MoneyInput label="Nominal" required value={form.amount} onChange={(x) => setForm({ ...form, amount: x })} error={fe.errors.amount} />
          <Select label="Metode" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{settings?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</Select>
          <Select label="Akun kas" value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })}><option value="">—</option>{accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <div className="flex items-end">{form.proof ? <FileLink id={form.proof.id} name={form.proof.originalName} onRemove={() => setForm({ ...form, proof: null })} /> : <FileUpload kind="INCOME_PROOF" label="Unggah bukti" compact onUploaded={(f) => setForm({ ...form, proof: f })} />}</div>
          <Textarea className="sm:col-span-2" label="Catatan" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>}
      </Modal>
    </>
  );
}

/* ================================================================ expenses */

function Expenses() {
  const state = useListState({ sort: 'expenseDate', dir: 'desc' });
  const list = useList<Row>('/expenses', state);
  const { can, settings, activeCompanyId } = useAuth();
  const confirm = useConfirm();
  const cats = useQuery({ queryKey: ['expense-categories', activeCompanyId], queryFn: () => api.get<Row[]>('/expense-categories') });
  const accounts = useQuery({ queryKey: ['cash-accounts', activeCompanyId], queryFn: () => api.get<Row[]>('/cash-accounts') });
  const vehicles = useQuery({ queryKey: ['rates', activeCompanyId], queryFn: () => api.get<Row[]>('/rates') });
  const [form, setForm] = useState<Row | null>(null);
  const key = useRef(newIdempotencyKey());
  const fe = useFieldErrors();
  const save = useAction(() => {
    const p = { ...form, vehicleId: form!.vehicleId || null, rentalId: form!.rentalId || null, cashAccountId: form!.cashAccountId || null, proofFileId: form!.proof?.id ?? form!.proofFileId ?? null };
    return form!.id ? api.put(`/expenses/${form!.id}`, p) : api.post('/expenses', p, { 'Idempotency-Key': key.current });
  }, { success: 'Pengeluaran disimpan', fieldErrors: fe, onSuccess: () => setForm(null) });
  const voidIt = useAction(({ id, reason }: { id: string; reason: string }) => api.post(`/expenses/${id}/void`, { reason }), { success: 'Pengeluaran di-void' });
  const cols: Column<Row>[] = [
    { key: 'expenseDate', header: 'Tanggal', sortKey: 'expenseDate', render: (r) => formatDate(r.expenseDate) },
    { key: 'number', header: 'Nomor', sortKey: 'number', hideBelow: 'md', render: (r) => <span className={cx('font-medium', r.status === 'VOID' && 'line-through text-muted')}>{r.number}</span> },
    { key: 'category', header: 'Kategori', render: (r) => r.categoryName },
    { key: 'description', header: 'Deskripsi', className: 'wrap', render: (r) => <>{r.description}{r.maintenanceId && <span className="block text-[12px] text-muted">Dari catatan perawatan</span>}{r.status === 'VOID' && <span className="block text-[12px] text-danger">Void: {r.voidReason}</span>}</> },
    { key: 'vehicle', header: 'Kendaraan', hideBelow: 'lg', render: (r) => r.plateNumber ? <Plate size="sm">{r.plateNumber}</Plate> : '—' },
    { key: 'amount', header: 'Nominal', align: 'right', sortKey: 'amount', render: (r) => <span className={cx(r.status === 'VOID' && 'text-muted line-through')}>{formatMoney(r.amount)}</span> },
    { key: 'a', header: '', align: 'right', render: (r) => (
      <span className="flex justify-end gap-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        {r.proofFileId && <FileLink id={r.proofFileId} name="Bukti" />}
        {can('expense.manage') && r.status === 'POSTED' && !r.maintenanceId && <button type="button" className="text-sm text-brand hover:underline" onClick={() => setForm({ ...r, amount: String(r.amount).replace(/\.00$/, ''), vehicleId: r.vehicleId ?? '', cashAccountId: r.cashAccountId ?? '', rentalId: r.rentalId ?? '' })}>Ubah</button>}
        {can('expense.void') && r.status === 'POSTED' && !r.maintenanceId && <button type="button" className="text-sm text-danger hover:underline" onClick={async () => {
          const res = await confirm({ title: `Void ${r.number}?`, message: 'Pengeluaran dikeluarkan dari laporan namun tetap tersimpan dan tercatat di audit log.', confirmLabel: 'Void', tone: 'danger', reason: { label: 'Alasan', required: true } });
          if (res.ok) voidIt.mutate({ id: r.id, reason: res.reason });
        }}>Void</button>}
      </span>) },
  ];
  const openNew = () => { key.current = newIdempotencyKey(); setForm({ expenseDate: todayLocal(), categoryId: cats.data?.find((c) => c.isActive)?.id ?? '', vehicleId: '', rentalId: '', description: '', amount: '', method: settings?.paymentMethods[0]?.code ?? 'CASH', cashAccountId: '', notes: '', proof: null }); };
  return (
    <>
      <PageHeader title="Pengeluaran operasional" description="BBM, servis, gaji sopir, pajak, dan biaya lain. Kaitkan dengan kendaraan untuk analisis laba per kendaraan."
        actions={<>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => api.download('/reports/expenses', { format: 'xlsx', from: state.get('from'), to: state.get('to') })} disabled={!can('data.export')}>Ekspor</Button>
          {can('expense.manage') && <Button icon={<Plus className="size-4" />} onClick={openNew}>Catat pengeluaran</Button>}
        </>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari nomor, deskripsi, nopol…" />
          <DateRange state={state} />
          <select className="input w-auto" value={state.get('categoryId')} onChange={(e) => state.set({ categoryId: e.target.value })} aria-label="Kategori">
            <option value="">Semua kategori</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input w-auto" value={state.get('vehicleId')} onChange={(e) => state.set({ vehicleId: e.target.value })} aria-label="Kendaraan">
            <option value="">Semua kendaraan</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
          </select>
          <select className="input w-auto" value={state.get('status')} onChange={(e) => state.set({ status: e.target.value })} aria-label="Status">
            <option value="">Semua</option><option value="POSTED">Diposting</option><option value="VOID">Void</option>
          </select>
        </div>
        <SumBar label="Total pengeluaran (tidak termasuk void)" sum={list.data?.sum} />
        <DataTable columns={cols} query={list} state={state}
          mobileCard={(r) => <div className="flex justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{r.description}</p><p className="text-[13px] text-muted">{r.categoryName} · {formatDate(r.expenseDate)}</p></div><span className="num font-medium">{formatMoney(r.amount)}</span></div>}
          empty={<EmptyState title="Belum ada pengeluaran" />} />
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Ubah ${form.number}` : 'Catat pengeluaran'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Simpan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          <DateInput label="Tanggal" required value={form.expenseDate} onChange={(x) => setForm({ ...form, expenseDate: x })} />
          <Select label="Kategori" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{cats.data?.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Input className="sm:col-span-2" label="Deskripsi" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={fe.errors.description} />
          <MoneyInput label="Nominal" required value={form.amount} onChange={(x) => setForm({ ...form, amount: x })} error={fe.errors.amount} />
          <Select label="Kendaraan terkait (opsional)" value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}><option value="">—</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plateNumber} — {v.brand} {v.model}</option>)}</Select>
          <Select label="Metode pembayaran" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{settings?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</Select>
          <Select label="Akun kas / rekening" value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })}><option value="">—</option>{accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Combobox label="Transaksi rental terkait (opsional)" value={form.rentalId || null} selectedLabel={form.rentalLabel ?? form.rentalNumber ?? ''} queryKey={['rental-lookup']}
            fetchOptions={async (q) => (await api.get<{ data: Row[] }>('/rentals', { q, pageSize: 15 })).data.map((r) => ({ id: r.id, label: r.number, sub: `${r.customerName} · ${r.plateNumber}` }))}
            onChange={(id, o) => setForm({ ...form, rentalId: id ?? '', rentalLabel: o?.label })} />
          <div className="flex items-end">{form.proof ? <FileLink id={form.proof.id} name={form.proof.originalName} onRemove={() => setForm({ ...form, proof: null })} /> : form.proofFileId ? <FileLink id={form.proofFileId} name="Bukti tersimpan" /> : <FileUpload kind="EXPENSE_PROOF" label="Unggah bukti" compact onUploaded={(f) => setForm({ ...form, proof: f })} />}</div>
          <Textarea className="sm:col-span-2" label="Catatan" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>}
      </Modal>
    </>
  );
}
