import { Route, Routes, useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, ArrowLeft, Pencil, CheckCircle2, XCircle, FileText, Wallet, Printer, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction } from '../lib/hooks';
import { formatDateTime, formatMoney, isPositive, toCents, subMoney } from '../lib/format';
import { RESERVATION_STATUS, RENTAL_TYPE, UNIT, PAYMENT_KIND } from '../lib/labels';
import { Button, Card, DefinitionList, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge, useConfirm } from '../components/ui';
import { DataTable, SearchBox, useList, useListState, type Column } from '../components/DataTable';
import { Plate } from '../components/inputs';
import { BookingForm, valuesFrom } from '../components/BookingForm';
import { PaymentDialog } from '../components/PaymentDialog';

export default function Reservations() {
  return (
    <Routes>
      <Route index element={<ReservationList />} />
      <Route path="new" element={<ReservationEditor />} />
      <Route path=":id/edit" element={<ReservationEditor />} />
      <Route path=":id" element={<ReservationDetail />} />
    </Routes>
  );
}

function ReservationList() {
  const state = useListState({ status: 'DRAFT,PENDING,CONFIRMED', sort: 'startAt', dir: 'asc' });
  const list = useList<Row>('/reservations', state);
  const { can } = useAuth();
  const navigate = useNavigate();
  const cols: Column<Row>[] = [
    { key: 'number', header: 'No. reservasi', sortKey: 'number', render: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div><div>{r.customerName}</div><div className="text-[12.5px] text-muted">{r.customerPhone}</div></div> },
    { key: 'vehicle', header: 'Kendaraan', render: (r) => <Plate size="sm">{r.plateNumber}</Plate> },
    { key: 'startAt', header: 'Mulai', sortKey: 'startAt', render: (r) => formatDateTime(r.startAt) },
    { key: 'endAt', header: 'Selesai', hideBelow: 'md', render: (r) => formatDateTime(r.endAt) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge map={RESERVATION_STATUS} value={r.status} /> },
    { key: 'total', header: 'Total', align: 'right', sortKey: 'total', hideBelow: 'sm', render: (r) => formatMoney(r.total) },
    { key: 'paid', header: 'DP diterima', align: 'right', hideBelow: 'lg', render: (r) => formatMoney(r.paid) },
  ];
  const statusOptions = [['DRAFT,PENDING,CONFIRMED', 'Aktif (draft, menunggu, dikonfirmasi)'], ['ALL', 'Semua status'], ...Object.entries(RESERVATION_STATUS).map(([k, [l]]) => [k, l])];
  return (
    <>
      <PageHeader title="Reservasi" description="Pemesanan kendaraan sebelum menjadi transaksi rental."
        actions={<>
          <Button variant="secondary" onClick={() => navigate('/calendar')}>Lihat kalender</Button>
          {can('reservation.manage') && <Button icon={<Plus className="size-4" />} onClick={() => navigate('/reservations/new')}>Reservasi baru</Button>}
        </>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari nomor, customer, nopol…" />
          <select className="input w-auto" value={state.get('status')} onChange={(e) => state.set({ status: e.target.value })} aria-label="Status">
            {statusOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input type="date" className="input w-auto" value={state.get('from')} onChange={(e) => state.set({ from: e.target.value })} aria-label="Dari" />
          <input type="date" className="input w-auto" value={state.get('to')} onChange={(e) => state.set({ to: e.target.value })} aria-label="Sampai" />
        </div>
        <DataTable columns={cols} query={list} state={state} onRowClick={(r) => navigate(`/reservations/${r.id}`)}
          mobileCard={(r) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between"><span className="font-medium">{r.number}</span><StatusBadge map={RESERVATION_STATUS} value={r.status} /></div>
              <div className="flex items-center gap-2 text-sm"><Plate size="sm">{r.plateNumber}</Plate>{r.customerName}</div>
              <div className="text-[12.5px] text-muted">{formatDateTime(r.startAt)} – {formatDateTime(r.endAt)}</div>
            </div>
          )}
          empty={<EmptyState title="Tidak ada reservasi" description="Reservasi mengunci jadwal kendaraan sebelum transaksi dibuat."
            action={can('reservation.manage') ? <Button icon={<Plus className="size-4" />} onClick={() => navigate('/reservations/new')}>Reservasi baru</Button> : undefined} />} />
      </div>
    </>
  );
}

function ReservationEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { activeCompanyId, can } = useAuth();
  const q = useQuery({ queryKey: ['reservation', activeCompanyId, id], queryFn: () => api.get<Row>(`/reservations/${id}`), enabled: !!id });
  const save = useAction((payload: Row) => (id ? api.put<Row>(`/reservations/${id}`, payload) : api.post<Row>('/reservations', payload)),
    { success: id ? 'Reservasi diperbarui' : 'Reservasi dibuat', onSuccess: (r) => navigate(`/reservations/${r.id}`, { replace: true }) });
  if (!can('reservation.manage')) return <EmptyState title="Akses ditolak" />;
  if (id && q.isError) return <ErrorState error={q.error} />;
  if (id && !q.data) return <Skeleton className="h-64" />;
  const r = q.data?.reservation;
  const defaults = { startAt: params.get('start') ?? undefined, endAt: params.get('end') ?? undefined, vehicleId: params.get('vehicleId') ?? undefined };
  return (
    <>
      <PageHeader back={<Link to={id ? `/reservations/${id}` : '/reservations'} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Reservasi</Link>}
        title={id ? `Ubah reservasi ${r?.number}` : 'Reservasi baru'} />
      <BookingForm kind="reservation" initial={valuesFrom(r ?? null, defaults)} existing={r}
        editing={r ? { type: 'RESERVATION', id: r.id, total: r.total, status: r.status } : null}
        submitting={save.isPending} onSubmit={(payload) => save.mutate(payload)} />
    </>
  );
}

function ReservationDetail() {
  const { id } = useParams();
  const { activeCompanyId, can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [pay, setPay] = useState<null | 'PAYMENT' | 'REFUND'>(null);
  const q = useQuery({ queryKey: ['reservation', activeCompanyId, id], queryFn: () => api.get<Row>(`/reservations/${id}`) });
  const setStatus = useAction(({ status, reason }: { status: string; reason?: string }) => api.post(`/reservations/${id}/status`, { status, reason }), { success: 'Status reservasi diperbarui' });
  const convert = useAction(() => api.post<Row>(`/reservations/${id}/convert`), { success: (r) => `Transaksi ${r.number} dibuat`, onSuccess: (r) => navigate(`/rentals/${r.id}`) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const { reservation: r, balance, payments, rental } = q.data;
  const open = ['DRAFT', 'PENDING', 'CONFIRMED'].includes(r.status);
  const overpaid = toCents(balance.balance) < 0n;
  return (
    <>
      <PageHeader back={<Link to="/reservations" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Reservasi</Link>}
        title={<span className="flex flex-wrap items-center gap-2">{r.number}<StatusBadge map={RESERVATION_STATUS} value={r.status} /></span>}
        description={rental ? <>Sudah menjadi transaksi <Link className="text-brand hover:underline" to={`/rentals/${rental.id}`}>{rental.number}</Link></> : `Dibuat ${formatDateTime(r.createdAt)}`}
        actions={<>
          <a href={`/print/reservation/${r.id}`} target="_blank" rel="noopener"><Button variant="secondary" icon={<Printer className="size-4" />}>Surat reservasi</Button></a>
          {can('reservation.manage') && open && <>
            <Button variant="danger" icon={<XCircle className="size-4" />} onClick={async () => {
              const res = await confirm({ title: 'Batalkan reservasi?', message: 'Jadwal kendaraan akan dibebaskan.', confirmLabel: 'Batalkan reservasi', tone: 'danger', reason: { label: 'Alasan pembatalan', required: true } });
              if (res.ok) setStatus.mutate({ status: 'CANCELLED', reason: res.reason });
            }}>Batalkan</Button>
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => navigate(`/reservations/${r.id}/edit`)}>Ubah</Button>
            {r.status !== 'CONFIRMED' && <Button variant="secondary" icon={<CheckCircle2 className="size-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate({ status: 'CONFIRMED' })}>Konfirmasi</Button>}
          </>}
          {can('payment.manage') && open && toCents(balance.balance) > 0n && <Button variant="secondary" icon={<Wallet className="size-4" />} onClick={() => setPay('PAYMENT')}>Terima DP</Button>}
          {can('payment.manage') && overpaid && <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => setPay('REFUND')}>Catat refund</Button>}
          {can('reservation.manage', 'rental.manage') && open && <Button icon={<FileText className="size-4" />} loading={convert.isPending} onClick={async () => {
            if ((await confirm({ title: 'Jadikan transaksi rental?', message: 'Transaksi dibuat dengan customer, kendaraan, jadwal, dan harga reservasi ini. Uang muka yang sudah diterima ikut dipindahkan.', confirmLabel: 'Buat transaksi' })).ok) convert.mutate(undefined);
          }}>Jadikan transaksi</Button>}
        </>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card title="Detail reservasi">
            <DefinitionList items={[
              ['Customer', <Link to={`/customers/${r.customerId}`} className="text-brand hover:underline">{r.customerSnapshot.name}</Link>], ['Telepon', r.customerSnapshot.phone],
              ['Kendaraan', <span className="flex items-center gap-2"><Plate size="sm">{r.vehicleSnapshot.plateNumber}</Plate>{r.vehicleSnapshot.brand} {r.vehicleSnapshot.model}</span>],
              ['Layanan', `${RENTAL_TYPE[r.rentalType]} · ${r.withDriver ? 'dengan sopir' : 'tanpa sopir'}`],
              ['Mulai', formatDateTime(r.startAt)], ['Selesai', formatDateTime(r.endAt)], ['Lokasi ambil', r.pickupLocation], ['Lokasi kembali', r.returnLocation],
            ]} />
            {r.notes && <p className="mt-3 text-sm text-muted">Catatan: {r.notes}</p>}
            {r.status === 'CANCELLED' && <p className="mt-3 rounded-md bg-paper px-3 py-2 text-sm">Dibatalkan: {r.cancelledReason}</p>}
            {r.status === 'DRAFT' && <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">Draft belum mengunci jadwal kendaraan. Konfirmasi untuk mengamankan kendaraan.</p>}
          </Card>
          <Card title="Uang muka diterima" bodyClassName="p-0">
            {payments.length === 0 ? <p className="px-4 py-5 text-sm text-muted">Belum ada pembayaran.</p> : (
              <table className="table-base"><tbody>{payments.map((p: Row) => (
                <tr key={p.id}><td className="font-medium">{p.number}</td><td>{formatDateTime(p.paidAt)}</td><td><StatusBadge map={PAYMENT_KIND} value={p.kind} /></td><td>{p.method}</td><td className="num text-right">{formatMoney(p.amount)}</td>
                  <td className="text-right">{p.kind !== 'REVERSAL' && <a href={`/print/receipt/${p.id}`} target="_blank" rel="noopener" className="text-sm text-brand hover:underline">Kwitansi</a>}</td></tr>
              ))}</tbody></table>
            )}
          </Card>
        </div>
        <Card title="Rincian harga">
          <div className="space-y-2.5 text-[14px]">
            <div className="flex justify-between"><span className="text-muted">{r.quantity} {UNIT[r.rentalType]} × {formatMoney(r.unitPrice)}</span><span className="num">{formatMoney(r.subtotal)}</span></div>
            {isPositive(r.discount) && <div className="flex justify-between"><span className="text-muted">Diskon</span><span className="num">−{formatMoney(r.discount)}</span></div>}
            {isPositive(r.extraCharges) && <div className="flex justify-between"><span className="text-muted">Biaya tambahan</span><span className="num">{formatMoney(r.extraCharges)}</span></div>}
            {isPositive(r.taxAmount) && <div className="flex justify-between"><span className="text-muted">Pajak</span><span className="num">{formatMoney(r.taxAmount)}</span></div>}
            <div className="flex justify-between border-t border-line pt-2.5 font-semibold"><span>Total</span><span className="num">{formatMoney(r.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Rencana DP</span><span className="num">{formatMoney(r.dpAmount)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Diterima</span><span className="num text-teal">{formatMoney(balance.paid)}</span></div>
          </div>
        </Card>
      </div>
      <PaymentDialog open={!!pay} kind={pay ?? 'PAYMENT'} onClose={() => setPay(null)} target={{ reservationId: r.id, label: r.number }}
        balance={pay === 'PAYMENT' && isPositive(r.dpAmount) && toCents(r.dpAmount) - toCents(balance.paid) > 0n ? subMoney(r.dpAmount, balance.paid) : balance.balance} />
    </>
  );
}
