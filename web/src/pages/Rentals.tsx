import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { formatDateTime, formatMoney } from '../lib/format';
import { PAYMENT_STATUS, RENTAL_STATUS } from '../lib/labels';
import { Badge, Button, EmptyState, PageHeader, StatusBadge, cx } from '../components/ui';
import { DataTable, SearchBox, useList, useListState, type Column } from '../components/DataTable';
import { Plate } from '../components/inputs';

const MODES = {
  all: { title: 'Transaksi rental', description: 'Semua kontrak sewa, tagihan, dan status pembayarannya.', defaults: {} as Record<string, string> },
  handover: { title: 'Serah terima kendaraan', description: 'Transaksi terjadwal yang menunggu kendaraan diserahkan ke customer.', defaults: { status: 'SCHEDULED', sort: 'startAt', dir: 'asc' } },
  return: { title: 'Pengembalian kendaraan', description: 'Kendaraan yang sedang disewa. Yang terlambat ditandai merah.', defaults: { status: 'ONGOING', sort: 'endAt', dir: 'asc' } },
};

export default function Rentals({ mode }: { mode: keyof typeof MODES }) {
  const cfg = MODES[mode];
  const state = useListState(cfg.defaults);
  const list = useList<Row>('/rentals', state);
  const { can } = useAuth();
  const navigate = useNavigate();
  const cols: Column<Row>[] = [
    { key: 'number', header: 'No. transaksi', sortKey: 'number', render: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><div className="max-w-[200px] truncate">{r.customerName}</div><div className="text-[12.5px] text-muted">{r.customerPhone}</div></div> },
    { key: 'vehicle', header: 'Kendaraan', render: (r) => <div className="flex items-center gap-2"><Plate size="sm">{r.plateNumber}</Plate><span className="hidden whitespace-nowrap text-[13px] text-muted xl:inline">{r.vehicleName}</span></div> },
    { key: 'startAt', header: 'Mulai', sortKey: 'startAt', hideBelow: 'md', render: (r) => formatDateTime(r.startAt) },
    { key: 'endAt', header: 'Kembali', sortKey: 'endAt', render: (r) => <span className={cx(r.overdue && 'font-medium text-danger')}>{formatDateTime(r.endAt)}{r.overdue && <AlertTriangle className="ml-1 inline size-3.5" />}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge map={RENTAL_STATUS} value={r.status} /> },
    { key: 'payment', header: 'Pembayaran', hideBelow: 'lg', render: (r) => (r.status === 'CANCELLED' && Number(r.amountDue) === 0 && Number(r.paid) === 0 ? <span className="text-muted">—</span> : <StatusBadge map={PAYMENT_STATUS} value={r.paymentStatus} />) },
    { key: 'total', header: 'Total', align: 'right', sortKey: 'total', hideBelow: 'sm', render: (r) => formatMoney(r.amountDue) },
    { key: 'balance', header: 'Sisa', align: 'right', sortKey: 'balance', render: (r) => <span className={cx(Number(r.balance) > 0 ? 'text-warn' : Number(r.balance) < 0 ? 'text-danger' : 'text-muted')}>{formatMoney(r.balance)}</span> },
  ];
  return (
    <>
      <PageHeader title={cfg.title} description={cfg.description}
        actions={can('rental.manage') && mode === 'all' && <Button icon={<Plus className="size-4" />} onClick={() => navigate('/rentals/new')}>Transaksi baru</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari nomor, customer, nopol…" />
          {mode === 'all' && <>
            <select className="input w-auto" value={state.get('status')} onChange={(e) => state.set({ status: e.target.value })} aria-label="Status">
              <option value="">Semua status</option>{Object.entries(RENTAL_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className="input w-auto" value={state.get('paymentStatus')} onChange={(e) => state.set({ paymentStatus: e.target.value })} aria-label="Status pembayaran">
              <option value="">Semua pembayaran</option>{Object.entries(PAYMENT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input type="date" className="input w-auto" value={state.get('from')} onChange={(e) => state.set({ from: e.target.value })} aria-label="Mulai dari" />
            <input type="date" className="input w-auto" value={state.get('to')} onChange={(e) => state.set({ to: e.target.value })} aria-label="Mulai sampai" />
          </>}
          {mode === 'return' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={state.get('overdue') === 'true'} onChange={(e) => state.set({ overdue: e.target.checked ? 'true' : '' })} />Hanya yang terlambat</label>}
          {mode === 'handover' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={state.get('dueToday') === 'start'} onChange={(e) => state.set({ dueToday: e.target.checked ? 'start' : '' })} />Hanya hari ini</label>}
          {(state.get('from') || state.get('to') || state.get('overdue')) && mode === 'all' && <Badge tone="brand">Filter tanggal aktif</Badge>}
        </div>
        <DataTable columns={cols} query={list} state={state} onRowClick={(r) => navigate(`/rentals/${r.id}`)}
          mobileCard={(r) => (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.number}</span><StatusBadge map={RENTAL_STATUS} value={r.status} /></div>
              <div className="flex items-center gap-2 text-sm"><Plate size="sm">{r.plateNumber}</Plate><span className="truncate">{r.customerName}</span></div>
              <div className="flex items-center justify-between text-[12.5px] text-muted">
                <span className={cx(r.overdue && 'font-medium text-danger')}>Kembali {formatDateTime(r.endAt)}</span>
                <span className="num">Sisa {formatMoney(r.balance)}</span>
              </div>
            </div>
          )}
          empty={<EmptyState title={mode === 'handover' ? 'Tidak ada kendaraan yang menunggu serah terima' : mode === 'return' ? 'Tidak ada kendaraan yang sedang disewa' : 'Belum ada transaksi'}
            action={can('rental.manage') && mode === 'all' ? <Button icon={<Plus className="size-4" />} onClick={() => navigate('/rentals/new')}>Buat transaksi</Button> : undefined} />} />
      </div>
    </>
  );
}
