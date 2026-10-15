import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil, KeyRound, Undo2, Wallet, XCircle, CheckCircle2, Printer, RotateCcw, ChevronDown, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction } from '../lib/hooks';
import { addMoney, formatDateTime, formatDuration, formatMoney, formatNumber, isPositive, toCents } from '../lib/format';
import { PAYMENT_KIND, PAYMENT_STATUS, RENTAL_STATUS, RENTAL_TYPE, UNIT } from '../lib/labels';
import { Badge, Button, Card, Checkbox, DefinitionList, ErrorState, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Textarea, useConfirm, cx } from '../components/ui';
import { DateTimeInput, FileLink, MoneyInput, Plate } from '../components/inputs';
import { PaymentDialog } from '../components/PaymentDialog';
import { useToast } from '../components/Toast';

const CHECKLIST = [['stnk', 'STNK'], ['kunci', 'Kunci & remote'], ['banSerep', 'Ban serep'], ['dongkrak', 'Dongkrak & kunci roda'], ['p3k', 'Kotak P3K'], ['kebersihan', 'Kebersihan kendaraan']] as const;
const FUEL_LEVELS = ['Kosong', '1/4', '1/2', '3/4', 'Penuh'];

export default function RentalDetail() {
  const { id } = useParams();
  const { activeCompanyId, can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<null | 'pay' | 'refund' | 'handover' | 'return' | 'cancel'>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const q = useQuery({ queryKey: ['rental', activeCompanyId, id], queryFn: () => api.get<Row>(`/rentals/${id}`) });
  const complete = useAction(() => api.post(`/rentals/${id}/complete`), { success: 'Transaksi diselesaikan' });
  const reverse = useAction(({ pid, reason }: { pid: string; reason: string }) => api.post(`/payments/${pid}/reverse`, { reason }), { success: 'Pembayaran dibatalkan dengan entri reversal' });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="space-y-3"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-72" /></div>;
  const { rental: r, balance: b, payments, handover, return: ret, driver, reservation, expenses } = q.data;
  const cs = r.customerSnapshot; const vs = r.vehicleSnapshot;
  const overdue = r.status === 'ONGOING' && new Date(r.endAt) < new Date();
  const refundDue = b.paymentStatus === 'REFUND_DUE';

  return (
    <>
      <PageHeader back={<Link to="/rentals" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Transaksi rental</Link>}
        title={<span className="flex flex-wrap items-center gap-2">{r.number}<StatusBadge map={RENTAL_STATUS} value={r.status} /><StatusBadge map={PAYMENT_STATUS} value={b.paymentStatus} />{overdue && <Badge tone="danger"><AlertTriangle className="size-3" />Terlambat</Badge>}</span>}
        description={`Invoice ${r.invoiceNumber} · Kontrak ${r.contractNumber}${reservation ? ` · dari reservasi ${reservation.number}` : ''}`}
        actions={<>
          <div className="relative">
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => setPrintOpen((o) => !o)}>Cetak <ChevronDown className="size-4" /></Button>
            {printOpen && <>
              <div className="fixed inset-0 z-30" onClick={() => setPrintOpen(false)} aria-hidden />
              <div className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-line bg-white py-1 shadow-xl">
                {[['invoice', 'Invoice'], ['contract', 'Surat perjanjian sewa'], ['handover', 'Form serah terima'], ['return', 'Form pengembalian']].map(([k, l]) => (
                  <a key={k} href={`/print/${k}/${r.id}`} target="_blank" rel="noopener" onClick={() => setPrintOpen(false)} className="block px-3 py-2 text-sm hover:bg-paper">{l}</a>
                ))}
              </div>
            </>}
          </div>
          {can('rental.cancel') && r.status === 'SCHEDULED' && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setDialog('cancel')}>Batalkan</Button>}
          {can('rental.manage') && ['SCHEDULED', 'ONGOING'].includes(r.status) && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => navigate(`/rentals/${r.id}/edit`)}>{r.status === 'ONGOING' ? 'Perpanjang / ubah' : 'Ubah'}</Button>}
          {can('payment.manage') && refundDue && <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => setDialog('refund')}>Catat refund</Button>}
          {can('payment.manage') && toCents(b.balance) > 0n && <Button variant={r.status === 'RETURNED' ? 'primary' : 'secondary'} icon={<Wallet className="size-4" />} onClick={() => setDialog('pay')}>Catat pembayaran</Button>}
          {can('handover.manage') && r.status === 'SCHEDULED' && <Button variant="teal" icon={<KeyRound className="size-4" />} onClick={() => setDialog('handover')}>Serah terima</Button>}
          {can('handover.manage') && r.status === 'ONGOING' && <Button variant="teal" icon={<Undo2 className="size-4" />} onClick={() => setDialog('return')}>Pengembalian</Button>}
          {can('rental.manage') && r.status === 'RETURNED' && <Button icon={<CheckCircle2 className="size-4" />} loading={complete.isPending} onClick={async () => {
            if ((await confirm({ title: 'Selesaikan transaksi?', message: toCents(b.balance) > 0n ? `Masih ada sisa tagihan ${formatMoney(b.balance)}. Transaksi hanya dapat diselesaikan jika pengaturan perusahaan mengizinkan piutang.` : 'Kendaraan sudah kembali dan tagihan lunas.', confirmLabel: 'Selesaikan' })).ok) complete.mutate(undefined);
          }}>Selesaikan</Button>}
        </>} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card title="Customer & kendaraan">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <p className="text-[12.5px] text-muted">Customer</p>
                <Link to={`/customers/${r.customerId}`} className="mt-0.5 block font-medium text-brand hover:underline">{cs.name}</Link>
                <p className="text-sm">{cs.phone}</p>
                {cs.address && <p className="text-sm text-muted">{cs.address}</p>}
                {cs.idNumber && <p className="text-sm text-muted">{cs.idType} {cs.idNumber}</p>}
              </div>
              <div>
                <p className="text-[12.5px] text-muted">Kendaraan</p>
                <div className="mt-1 flex items-center gap-2"><Plate>{vs.plateNumber}</Plate><Link to={`/vehicles/${r.vehicleId}`} className="font-medium text-brand hover:underline">{vs.brand} {vs.model}</Link></div>
                <p className="mt-1 text-sm text-muted">{[vs.year, vs.color, vs.transmission === 'AUTOMATIC' ? 'Otomatis' : 'Manual'].filter(Boolean).join(' · ')}</p>
                <p className="text-sm">{r.withDriver ? `Dengan sopir${driver ? `: ${driver.name}` : ''}` : 'Tanpa sopir'}</p>
              </div>
            </div>
          </Card>
          <Card title="Jadwal">
            <DefinitionList items={[
              ['Mulai (rencana)', formatDateTime(r.startAt)], ['Kembali (rencana)', <span className={cx(overdue && 'font-medium text-danger')}>{formatDateTime(r.endAt)}</span>],
              ['Serah terima', r.actualStartAt ? formatDateTime(r.actualStartAt) : 'Belum'], ['Dikembalikan', r.actualEndAt ? formatDateTime(r.actualEndAt) : 'Belum'],
              ['Lokasi ambil', r.pickupLocation], ['Lokasi kembali', r.returnLocation],
              ['Jenis rental', `${RENTAL_TYPE[r.rentalType]} · ${r.quantity} ${UNIT[r.rentalType]}`], ['Durasi rencana', formatDuration(Math.round((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 60000))],
            ]} />
            {r.status === 'CANCELLED' && <p className="mt-3 rounded-md bg-paper px-3 py-2 text-sm">Dibatalkan {formatDateTime(r.cancelledAt)}: {r.cancelledReason}</p>}
            {r.notes && <p className="mt-3 text-sm text-muted">Catatan: {r.notes}</p>}
          </Card>

          <Card title="Pembayaran" bodyClassName="p-0" actions={can('payment.manage') && toCents(b.balance) > 0n && <Button size="sm" icon={<Wallet className="size-4" />} onClick={() => setDialog('pay')}>Catat pembayaran</Button>}>
            {payments.length === 0 ? <p className="px-4 py-6 text-sm text-muted">Belum ada pembayaran.</p> : (
              <div className="overflow-x-auto"><table className="table-base">
                <thead><tr><th>No. kwitansi</th><th>Tanggal</th><th>Jenis</th><th>Metode</th><th className="text-right">Nominal</th><th /></tr></thead>
                <tbody>{payments.map((p: Row) => (
                  <tr key={p.id} className={cx(p.reversed && 'text-muted line-through decoration-muted/50')}>
                    <td className="font-medium">{p.number}</td><td>{formatDateTime(p.paidAt)}</td>
                    <td><span className="flex flex-wrap gap-1"><StatusBadge map={PAYMENT_KIND} value={p.kind} />{p.isDownPayment && <Badge tone="brand">DP</Badge>}</span></td>
                    <td>{p.method}{p.cashAccountName ? ` · ${p.cashAccountName}` : ''}{p.reference ? <span className="block text-[12px] text-muted">{p.reference}</span> : null}</td>
                    <td className={cx('num text-right', Number(p.amount) < 0 && 'text-danger')}>{formatMoney(p.amount)}</td>
                    <td className="whitespace-nowrap text-right">
                      {p.proofFileId && <FileLink id={p.proofFileId} name="Bukti" />}
                      {p.kind !== 'REVERSAL' && <a href={`/print/receipt/${p.id}`} target="_blank" rel="noopener" className="ml-2 text-sm text-brand hover:underline">Kwitansi</a>}
                      {can('payment.reverse') && p.kind !== 'REVERSAL' && !p.reversed && <button type="button" className="ml-3 text-sm text-danger hover:underline" onClick={async () => {
                        const res = await confirm({ title: `Batalkan ${p.number}?`, message: <>Sistem akan membuat entri <b>reversal</b> sebesar {formatMoney(String(-Number(p.amount)))}. Pembayaran asli tetap tersimpan dan tercatat di audit log.</>, confirmLabel: 'Buat reversal', tone: 'danger', reason: { label: 'Alasan pembatalan', required: true } });
                        if (res.ok) reverse.mutate({ pid: p.id, reason: res.reason });
                      }}>Batalkan</button>}
                    </td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>

          {(handover || ret) && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {handover && <Card title="Serah terima">
                <DefinitionList className="sm:grid-cols-2" items={[['Waktu', formatDateTime(handover.handedAt)], ['Kilometer', handover.km != null ? `${formatNumber(handover.km)} km` : null], ['BBM', handover.fuelLevel], ['Petugas', handover.staffName], ['Penerima', handover.receiverName]]} />
                <Checklist data={handover.checklist} />
                {handover.conditionNotes && <p className="mt-2 text-sm text-muted">{handover.conditionNotes}</p>}
              </Card>}
              {ret && <Card title="Pengembalian">
                <DefinitionList className="sm:grid-cols-2" items={[['Waktu', formatDateTime(ret.returnedAt)], ['Kilometer', ret.km != null ? `${formatNumber(ret.km)} km` : null], ['BBM', ret.fuelLevel],
                  ['Keterlambatan', ret.lateMinutes > 0 ? formatDuration(ret.lateMinutes) : 'Tepat waktu'], ['Denda', formatMoney(ret.lateFee)], ['Biaya kerusakan', formatMoney(ret.damageFee)]]} />
                <Checklist data={ret.checklist} />
                {ret.damageNotes && <p className="mt-2 text-sm">Kerusakan: {ret.damageNotes}</p>}
                {ret.conditionNotes && <p className="mt-1 text-sm text-muted">{ret.conditionNotes}</p>}
              </Card>}
            </div>
          )}

          {expenses.length > 0 && <Card title="Pengeluaran terkait" bodyClassName="p-0">
            <table className="table-base"><tbody>{expenses.map((e: Row) => <tr key={e.id}><td>{e.number}</td><td>{e.categoryName}</td><td>{e.description}</td><td className="num text-right">{formatMoney(e.amount)}</td></tr>)}</tbody></table>
          </Card>}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-[72px] lg:self-start">
          <Card title="Rincian tagihan">
            <div className="space-y-2.5 text-[14px]">
              <Row2 label={`${r.quantity} ${UNIT[r.rentalType]} × ${formatMoney(r.unitPrice)}`} value={formatMoney(r.subtotal)} />
              {isPositive(r.discount) && <Row2 label="Diskon" value={`−${formatMoney(r.discount)}`} />}
              {isPositive(r.extraCharges) && <Row2 label={r.extraChargesNote ? `Biaya tambahan (${r.extraChargesNote})` : 'Biaya tambahan'} value={formatMoney(r.extraCharges)} />}
              {isPositive(r.lateFee) && <Row2 label="Denda keterlambatan" value={formatMoney(r.lateFee)} />}
              {isPositive(r.damageFee) && <Row2 label="Biaya kerusakan" value={formatMoney(r.damageFee)} />}
              {isPositive(r.taxAmount) && <Row2 label={`Pajak ${Number(r.taxPercent)}%`} value={formatMoney(r.taxAmount)} />}
              <div className="flex items-baseline justify-between border-t border-line pt-2.5"><span className="font-medium">Total tagihan</span><span className="num text-lg font-semibold">{formatMoney(r.total)}</span></div>
              {r.status === 'CANCELLED' && <Row2 label="Biaya pembatalan (ditagihkan)" value={formatMoney(r.cancellationFee)} />}
              <Row2 label="Sudah dibayar" value={formatMoney(b.paid)} />
              <div className="flex items-baseline justify-between rounded-md bg-paper px-3 py-2">
                <span className="font-medium">{refundDue ? 'Kelebihan bayar' : 'Sisa tagihan'}</span>
                <span className={cx('num text-lg font-semibold', refundDue ? 'text-danger' : toCents(b.balance) > 0n ? 'text-warn' : 'text-teal')}>{formatMoney(refundDue ? String(-Number(b.balance)) : b.balance)}</span>
              </div>
            </div>
          </Card>
        </aside>
      </div>

      <PaymentDialog open={dialog === 'pay'} onClose={() => setDialog(null)} target={{ rentalId: r.id, label: r.number }} balance={b.balance} />
      <PaymentDialog open={dialog === 'refund'} onClose={() => setDialog(null)} target={{ rentalId: r.id, label: r.number }} balance={b.balance} kind="REFUND" />
      <HandoverDialog open={dialog === 'handover'} onClose={() => setDialog(null)} rental={r} />
      <ReturnDialog open={dialog === 'return'} onClose={() => setDialog(null)} rental={r} handover={handover} paid={b.paid} />
      <CancelDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} rental={r} paid={b.paid} />
    </>
  );
}

function Row2({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-muted">{label}</span><span className="num whitespace-nowrap text-right">{value}</span></div>;
}

function Checklist({ data }: { data: Record<string, boolean | string> }) {
  const items = CHECKLIST.filter(([k]) => k in (data ?? {}));
  if (!items.length) return null;
  return <ul className="mt-3 flex flex-wrap gap-1.5">{items.map(([k, l]) => <li key={k}><Badge tone={data[k] ? 'teal' : 'danger'}>{data[k] ? '✓' : '✗'} {l}</Badge></li>)}</ul>;
}

function ChecklistEditor({ value, onChange }: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  return (
    <fieldset className="rounded-md border border-line p-3">
      <legend className="px-1 text-[13px] font-medium">Kelengkapan & kondisi</legend>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">{CHECKLIST.map(([k, l]) => <Checkbox key={k} label={l} checked={!!value[k]} onChange={(x) => onChange({ ...value, [k]: x })} />)}</div>
    </fieldset>
  );
}

const allChecked = () => Object.fromEntries(CHECKLIST.map(([k]) => [k, true]));

function HandoverDialog({ open, onClose, rental }: { open: boolean; onClose: () => void; rental: Row }) {
  const { user } = useAuth();
  const [v, setV] = useState<Row>({});
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) { setLastOpen(open); if (open) setV({ handedAt: new Date().toISOString(), km: '', fuelLevel: 'Penuh', checklist: allChecked(), conditionNotes: '', staffName: user?.name ?? '', receiverName: rental.customerSnapshot.name }); }
  const save = useAction(() => api.post(`/rentals/${rental.id}/handover`, { ...v, km: v.km === '' ? null : Number(v.km) }), { success: 'Kendaraan diserahkan — status: sedang disewa', onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} title={`Serah terima ${rental.vehicleSnapshot.plateNumber}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="teal" loading={save.isPending} onClick={() => save.mutate(undefined)}>Simpan serah terima</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateTimeInput label="Waktu serah terima" required value={v.handedAt ?? ''} onChange={(x) => setV({ ...v, handedAt: x })} />
        <Input label="Kilometer awal" inputMode="numeric" value={v.km ?? ''} onChange={(e) => setV({ ...v, km: e.target.value.replace(/\D/g, '') })} />
        <Select label="Level BBM" value={v.fuelLevel} onChange={(e) => setV({ ...v, fuelLevel: e.target.value })}>{FUEL_LEVELS.map((f) => <option key={f}>{f}</option>)}</Select>
        <div />
        <div className="sm:col-span-2"><ChecklistEditor value={v.checklist ?? {}} onChange={(c) => setV({ ...v, checklist: c })} /></div>
        <Textarea className="sm:col-span-2" label="Catatan kondisi" placeholder="Mis. baret halus di pintu kiri belakang" value={v.conditionNotes ?? ''} onChange={(e) => setV({ ...v, conditionNotes: e.target.value })} />
        <Input label="Petugas" value={v.staffName ?? ''} onChange={(e) => setV({ ...v, staffName: e.target.value })} />
        <Input label="Diterima oleh" value={v.receiverName ?? ''} onChange={(e) => setV({ ...v, receiverName: e.target.value })} />
      </div>
    </Modal>
  );
}

function ReturnDialog({ open, onClose, rental, handover, paid }: { open: boolean; onClose: () => void; rental: Row; handover: Row | null; paid: string }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const [v, setV] = useState<Row>({});
  const [lastOpen, setLastOpen] = useState(false);
  const [preview, setPreview] = useState<Row | null>(null);
  const [lateOverride, setLateOverride] = useState(false);
  if (open !== lastOpen) { setLastOpen(open); if (open) { setV({ returnedAt: new Date().toISOString(), km: '', fuelLevel: 'Penuh', checklist: allChecked(), conditionNotes: '', damageFee: '', damageNotes: '', lateFee: '', staffName: user?.name ?? '', returnerName: rental.customerSnapshot.name }); setLateOverride(false); } }
  useEffect(() => {
    if (!open || !v.returnedAt) return;
    const t = setTimeout(() => api.post<Row>(`/rentals/${rental.id}/return-preview`, { returnedAt: v.returnedAt }).then(setPreview).catch(() => setPreview(null)), 250);
    return () => clearTimeout(t);
  }, [open, v.returnedAt, rental.id]);
  const lateFee = lateOverride ? (v.lateFee || '0') : (preview?.lateFee ?? '0');
  const base = addMoney(rental.subtotal, `-${rental.discount}`, rental.extraCharges, lateFee, v.damageFee || '0');
  const save = useAction(() => api.post<Row>(`/rentals/${rental.id}/return`, {
    ...v, km: v.km === '' ? null : Number(v.km), damageFee: v.damageFee || '0', lateFee: lateOverride ? (v.lateFee || '0') : null,
  }), { success: 'Pengembalian tercatat', onSuccess: (res) => { if (res.warning) toast.error(res.warning); onClose(); } });
  return (
    <Modal open={open} onClose={onClose} title={`Pengembalian ${rental.vehicleSnapshot.plateNumber}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="teal" loading={save.isPending} onClick={() => save.mutate(undefined)}>Simpan pengembalian</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateTimeInput label="Waktu kembali" required value={v.returnedAt ?? ''} onChange={(x) => setV({ ...v, returnedAt: x })} hint={`Rencana: ${formatDateTime(rental.endAt)}`} />
        <Input label="Kilometer akhir" inputMode="numeric" value={v.km ?? ''} onChange={(e) => setV({ ...v, km: e.target.value.replace(/\D/g, '') })} hint={handover?.km != null ? `Kilometer awal: ${formatNumber(handover.km)}` : undefined} />
        <Select label="Level BBM" value={v.fuelLevel} onChange={(e) => setV({ ...v, fuelLevel: e.target.value })}>{FUEL_LEVELS.map((f) => <option key={f}>{f}</option>)}</Select>
        <div />
        <div className="sm:col-span-2"><ChecklistEditor value={v.checklist ?? {}} onChange={(c) => setV({ ...v, checklist: c })} /></div>
        <div className="sm:col-span-2 rounded-md bg-paper p-3 text-sm">
          {preview && preview.lateMinutes > 0 ? <>
            <p>Terlambat <b>{formatDuration(preview.lateMinutes)}</b> (toleransi {preview.graceMinutes} menit). Denda otomatis: <b className="num">{formatMoney(preview.lateFee)}</b> ({preview.units} {preview.mode === 'PER_HOUR' ? 'jam' : 'hari'}).</p>
          </> : <p>Dikembalikan tepat waktu — tidak ada denda keterlambatan.</p>}
          {can('rental.price_override') && <div className="mt-2"><Checkbox label="Ubah denda keterlambatan" checked={lateOverride} onChange={setLateOverride} /></div>}
          {lateOverride && <div className="mt-2 max-w-xs"><MoneyInput label="Denda keterlambatan" value={v.lateFee ?? ''} onChange={(x) => setV({ ...v, lateFee: x })} /></div>}
        </div>
        <MoneyInput label="Biaya kerusakan" value={v.damageFee ?? ''} onChange={(x) => setV({ ...v, damageFee: x })} />
        <Input label="Keterangan kerusakan" value={v.damageNotes ?? ''} onChange={(e) => setV({ ...v, damageNotes: e.target.value })} />
        <Textarea className="sm:col-span-2" label="Catatan kondisi" value={v.conditionNotes ?? ''} onChange={(e) => setV({ ...v, conditionNotes: e.target.value })} />
        <Input label="Petugas" value={v.staffName ?? ''} onChange={(e) => setV({ ...v, staffName: e.target.value })} />
        <Input label="Dikembalikan oleh" value={v.returnerName ?? ''} onChange={(e) => setV({ ...v, returnerName: e.target.value })} />
        <div className="sm:col-span-2 flex items-baseline justify-between rounded-md border border-line px-3 py-2.5 text-sm">
          <span className="text-muted">Perkiraan total baru{Number(rental.taxPercent) > 0 ? ' (sebelum pajak)' : ''} · sudah dibayar {formatMoney(paid)}</span>
          <b className="num text-base">{formatMoney(base)}</b>
        </div>
      </div>
    </Modal>
  );
}

function CancelDialog({ open, onClose, rental, paid }: { open: boolean; onClose: () => void; rental: Row; paid: string }) {
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('');
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) { setLastOpen(open); if (open) { setReason(''); setFee(''); } }
  const save = useAction(() => api.post(`/rentals/${rental.id}/cancel`, { reason, cancellationFee: fee || '0' }), { success: 'Transaksi dibatalkan — jadwal kendaraan dibebaskan', onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} title={`Batalkan ${rental.number}?`}
      footer={<><Button variant="secondary" onClick={onClose}>Kembali</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate(undefined)}>Batalkan transaksi</Button></>}>
      <div className="space-y-4 text-sm">
        <p>Jadwal kendaraan akan dibebaskan. Transaksi tetap tersimpan dengan status dibatalkan dan tercatat di audit log.</p>
        {toCents(paid) > 0n && <p className="rounded-md bg-warn-soft px-3 py-2 text-warn">Customer sudah membayar {formatMoney(paid)}. Setelah dibatalkan, catat refund untuk kelebihan bayar.</p>}
        <Textarea label="Alasan pembatalan" required value={reason} onChange={(e) => setReason(e.target.value)} />
        <MoneyInput label="Biaya pembatalan (opsional)" value={fee} onChange={setFee} hint={`Maksimal ${formatMoney(rental.total)}`} />
      </div>
    </Modal>
  );
}
