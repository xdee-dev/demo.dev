import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction, useFieldErrors } from '../lib/hooks';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import { MAINTENANCE_STATUS } from '../lib/labels';
import { Badge, Button, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Textarea, useConfirm } from '../components/ui';
import { DataTable, SearchBox, useList, useListState, type Column } from '../components/DataTable';
import { DateInput, DateTimeInput, FileLink, FileUpload, MoneyInput, Plate } from '../components/inputs';
import { useToast } from '../components/Toast';

export default function Maintenance({ tab }: { tab: 'schedule' | 'history' }) {
  const [form, setForm] = useState<Row | null>(null);
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  useEffect(() => {
    const v = params.get('new');
    if (v && can('maintenance.manage')) { setForm(newForm(v)); params.delete('new'); setParams(params, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      {tab === 'schedule' ? <Schedule onNew={(vehicleId) => setForm(newForm(vehicleId))} /> : <History onNew={() => setForm(newForm(''))} onEdit={setForm} />}
      <MaintenanceForm value={form} onClose={() => setForm(null)} />
    </>
  );
}

function newForm(vehicleId: string): Row {
  const s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1);
  return { vehicleId, startAt: s.toISOString(), endAt: new Date(s.getTime() + 8 * 3600_000).toISOString(), status: 'SCHEDULED', serviceType: '', km: '', workshop: '', cost: '', nextServiceDate: '', nextServiceKm: '', notes: '', paymentMethod: 'CASH', cashAccountId: '', proof: null };
}

const REMINDER: Record<string, [string, 'danger' | 'warn' | 'teal' | 'muted']> = {
  OVERDUE: ['Lewat jadwal', 'danger'], DUE_SOON: ['Segera', 'warn'], OK: ['Terjadwal', 'teal'], NO_DATA: ['Belum ada data', 'muted'],
};

function Schedule({ onNew }: { onNew: (vehicleId: string) => void }) {
  const { activeCompanyId, can } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['reminders', activeCompanyId], queryFn: () => api.get<Row[]>('/maintenance/reminders') });
  const upcoming = useList<Row>('/maintenance', useListState(), { status: 'SCHEDULED,IN_PROGRESS', dir: 'asc', pageSize: 50 });
  return (
    <>
      <PageHeader title="Jadwal servis" description="Pengingat servis berkala berdasarkan tanggal dan kilometer, serta perawatan yang sedang berjalan."
        actions={can('maintenance.manage') && <Button icon={<Plus className="size-4" />} onClick={() => onNew('')}>Jadwalkan perawatan</Button>} />
      <div className="space-y-5">
        <section className="card">
          <header className="border-b border-line px-4 py-3"><h2 className="text-[15px] font-semibold">Perawatan terjadwal & berjalan</h2></header>
          {upcoming.data?.data.length === 0 ? <p className="px-4 py-5 text-sm text-muted">Tidak ada perawatan yang terjadwal.</p> : (
            <ul className="divide-y divide-line">{upcoming.data?.data.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Plate size="sm">{m.plateNumber}</Plate>
                <span className="min-w-0 flex-1"><span className="block font-medium">{m.serviceType}</span><span className="text-[12.5px] text-muted">{formatDateTime(m.startAt)} – {m.endAt ? formatDateTime(m.endAt) : 'selesai belum ditentukan'}{m.workshop ? ` · ${m.workshop}` : ''}</span></span>
                <StatusBadge map={MAINTENANCE_STATUS} value={m.status} />
              </li>))}</ul>
          )}
        </section>
        <section className="card">
          <header className="border-b border-line px-4 py-3"><h2 className="text-[15px] font-semibold">Pengingat servis berkala</h2></header>
          {q.isError ? <ErrorState error={q.error} /> : !q.data ? <div className="space-y-2 p-4"><Skeleton /><Skeleton /></div> : (
            <div className="overflow-x-auto"><table className="table-base">
              <thead><tr><th>Kendaraan</th><th>Servis terakhir</th><th>Servis berikutnya</th><th className="text-right">Km saat ini</th><th className="text-right">Total biaya perawatan</th><th>Status</th><th /></tr></thead>
              <tbody>{q.data.map((r) => (
                <tr key={r.vehicleId}>
                  <td><button type="button" onClick={() => navigate(`/vehicles/${r.vehicleId}`)} className="flex items-center gap-2 text-left"><Plate size="sm">{r.plateNumber}</Plate><span className="hidden text-[13px] text-muted md:inline">{r.vehicleName}</span></button></td>
                  <td>{r.lastServiceAt ? <>{formatDate(r.lastServiceAt)}<span className="block text-[12px] text-muted">{r.lastServiceType}</span></> : '—'}</td>
                  <td>{r.nextServiceDate ? formatDate(r.nextServiceDate) : '—'}{r.nextServiceKm && <span className="block text-[12px] text-muted">atau {formatNumber(r.nextServiceKm)} km</span>}</td>
                  <td className="num text-right">{r.currentKm != null ? formatNumber(r.currentKm) : '—'}</td>
                  <td className="num text-right">{formatMoney(r.totalCost)}</td>
                  <td><Badge tone={REMINDER[r.reminderStatus][1]}>{REMINDER[r.reminderStatus][0]}</Badge></td>
                  <td className="text-right">{can('maintenance.manage') && <Button size="sm" variant="ghost" icon={<Wrench className="size-4" />} onClick={() => onNew(r.vehicleId)}>Jadwalkan</Button>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}

function History({ onNew, onEdit }: { onNew: () => void; onEdit: (r: Row) => void }) {
  const state = useListState({ dir: 'desc' });
  const list = useList<Row>('/maintenance', state);
  const { can } = useAuth();
  const confirm = useConfirm();
  const [done, setDone] = useState<Row | null>(null);
  const cancel = useAction(({ id, reason }: { id: string; reason: string }) => api.post(`/maintenance/${id}/cancel`, { reason }), { success: 'Perawatan dibatalkan' });
  const cols: Column<Row>[] = [
    { key: 'startAt', header: 'Tanggal', render: (r) => formatDate(r.startAt) },
    { key: 'number', header: 'Nomor', hideBelow: 'lg', render: (r) => <span className="text-muted">{r.number}</span> },
    { key: 'vehicle', header: 'Kendaraan', render: (r) => <Plate size="sm">{r.plateNumber}</Plate> },
    { key: 'serviceType', header: 'Jenis servis', className: 'wrap', render: (r) => <>{r.serviceType}{r.workshop && <span className="block text-[12px] text-muted">{r.workshop}</span>}</> },
    { key: 'km', header: 'Km', align: 'right', hideBelow: 'md', render: (r) => r.km != null ? formatNumber(r.km) : '—' },
    { key: 'next', header: 'Servis berikutnya', hideBelow: 'lg', render: (r) => r.nextServiceDate ? formatDate(r.nextServiceDate) : '—' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge map={MAINTENANCE_STATUS} value={r.status} /> },
    { key: 'cost', header: 'Biaya', align: 'right', render: (r) => <>{formatMoney(r.cost)}{r.expenseNumber && <span className="block text-[11.5px] text-muted">{r.expenseNumber}</span>}</> },
    { key: 'a', header: '', align: 'right', render: (r) => can('maintenance.manage') && ['SCHEDULED', 'IN_PROGRESS'].includes(r.status) ? (
      <span className="flex justify-end gap-3 whitespace-nowrap">
        <button type="button" className="text-sm text-teal hover:underline" onClick={() => setDone({ ...r, completedAt: new Date().toISOString(), cost: String(r.cost).replace(/\.00$/, ''), km: r.km ?? '', nextServiceDate: '', nextServiceKm: '', paymentMethod: 'CASH' })}>Selesai</button>
        <button type="button" className="text-sm text-brand hover:underline" onClick={() => onEdit({ ...r, cost: String(r.cost).replace(/\.00$/, ''), km: r.km ?? '', nextServiceDate: r.nextServiceDate ?? '', nextServiceKm: r.nextServiceKm ?? '', paymentMethod: 'CASH', cashAccountId: '' })}>Ubah</button>
        <button type="button" className="text-sm text-danger hover:underline" onClick={async () => {
          const res = await confirm({ title: `Batalkan ${r.number}?`, message: 'Jadwal kendaraan dibebaskan dan pengeluaran terkait di-void.', confirmLabel: 'Batalkan', tone: 'danger', reason: { label: 'Alasan', required: true } });
          if (res.ok) cancel.mutate({ id: r.id, reason: res.reason });
        }}>Batal</button>
      </span>) : r.proofFileId ? <FileLink id={r.proofFileId} name="Bukti" /> : null },
  ];
  return (
    <>
      <PageHeader title="Riwayat perawatan" description="Semua catatan servis. Biaya perawatan otomatis tercatat sebagai pengeluaran kategori Servis kendaraan."
        actions={can('maintenance.manage') && <Button icon={<Plus className="size-4" />} onClick={onNew}>Catat perawatan</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari jenis servis, bengkel, nopol…" />
          <select className="input w-auto" value={state.get('status')} onChange={(e) => state.set({ status: e.target.value })} aria-label="Status"><option value="">Semua status</option>{Object.entries(MAINTENANCE_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <input type="date" className="input w-auto" value={state.get('from')} onChange={(e) => state.set({ from: e.target.value })} aria-label="Dari" />
          <input type="date" className="input w-auto" value={state.get('to')} onChange={(e) => state.set({ to: e.target.value })} aria-label="Sampai" />
        </div>
        {list.data?.sum && <div className="flex justify-between border-b border-line bg-paper/60 px-4 py-2.5 text-sm"><span className="text-muted">Total biaya (tidak termasuk batal)</span><b className="num">{formatMoney(list.data.sum)}</b></div>}
        <DataTable columns={cols} query={list} state={state} empty={<EmptyState title="Belum ada catatan perawatan" />} />
      </div>
      <CompleteDialog value={done} onClose={() => setDone(null)} />
    </>
  );
}

function useCashAccounts() {
  const { activeCompanyId } = useAuth();
  return useQuery({ queryKey: ['cash-accounts', activeCompanyId], queryFn: () => api.get<Row[]>('/cash-accounts') });
}

function MaintenanceForm({ value, onClose }: { value: Row | null; onClose: () => void }) {
  const { activeCompanyId, settings, can } = useAuth();
  const toast = useToast();
  const [v, setV] = useState<Row | null>(value);
  const [last, setLast] = useState<Row | null>(null);
  if (value !== last) { setLast(value); setV(value); }
  const vehicles = useQuery({ queryKey: ['rates', activeCompanyId], queryFn: () => api.get<Row[]>('/rates'), enabled: !!value });
  const accounts = useCashAccounts();
  const fe = useFieldErrors();
  const save = useAction(() => {
    const p = { ...v, km: v!.km === '' ? null : v!.km, nextServiceKm: v!.nextServiceKm === '' ? null : v!.nextServiceKm, nextServiceDate: v!.nextServiceDate || null, endAt: v!.endAt || null, cost: v!.cost || '0', cashAccountId: v!.cashAccountId || null, proofFileId: v!.proof?.id ?? v!.proofFileId ?? null };
    return v!.id ? api.put(`/maintenance/${v!.id}`, p) : api.post('/maintenance', p);
  }, { success: 'Perawatan disimpan', fieldErrors: fe, onSuccess: onClose, });
  if (!v) return null;
  return (
    <Modal open={!!value} onClose={onClose} title={v.id ? `Ubah ${v.number}` : 'Catat / jadwalkan perawatan'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={() => { if (!v.vehicleId) { toast.error('Pilih kendaraan'); return; } save.mutate(undefined); }}>Simpan</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select className="sm:col-span-2" label="Kendaraan" required value={v.vehicleId} onChange={(e) => setV({ ...v, vehicleId: e.target.value })} error={fe.errors.vehicleId}>
          <option value="">Pilih kendaraan…</option>{vehicles.data?.map((x) => <option key={x.id} value={x.id}>{x.plateNumber} — {x.brand} {x.model}</option>)}
        </Select>
        <Input className="sm:col-span-2" label="Jenis servis" required placeholder="Mis. Servis berkala 40.000 km" value={v.serviceType} onChange={(e) => setV({ ...v, serviceType: e.target.value })} error={fe.errors.serviceType} />
        <Select label="Status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} hint="Selama perawatan, kendaraan tidak dapat disewakan">
          <option value="SCHEDULED">Terjadwal</option><option value="IN_PROGRESS">Sedang dikerjakan</option>
        </Select>
        <Input label="Bengkel" value={v.workshop ?? ''} onChange={(e) => setV({ ...v, workshop: e.target.value })} />
        <DateTimeInput label="Mulai" required value={v.startAt} onChange={(x) => setV({ ...v, startAt: x })} />
        <DateTimeInput label="Perkiraan selesai" required={v.status === 'SCHEDULED'} value={v.endAt ?? ''} onChange={(x) => setV({ ...v, endAt: x })} error={fe.errors.endAt}
          hint={v.status === 'IN_PROGRESS' ? 'Kosongkan bila belum diketahui — kendaraan diblokir sampai ditandai selesai' : undefined} />
        <Input label="Kilometer" inputMode="numeric" value={v.km ?? ''} onChange={(e) => setV({ ...v, km: e.target.value.replace(/\D/g, '') })} />
        <MoneyInput label="Biaya" value={v.cost ?? ''} onChange={(x) => setV({ ...v, cost: x })} hint={can('expense.manage') ? 'Otomatis dicatat sebagai pengeluaran' : undefined} />
        {can('expense.manage') && !v.id && <>
          <Select label="Dibayar dengan" value={v.paymentMethod} onChange={(e) => setV({ ...v, paymentMethod: e.target.value })}>{settings?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</Select>
          <Select label="Akun kas" value={v.cashAccountId} onChange={(e) => setV({ ...v, cashAccountId: e.target.value })}><option value="">—</option>{accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </>}
        <DateInput label="Jadwal servis berikutnya" value={v.nextServiceDate ?? ''} onChange={(x) => setV({ ...v, nextServiceDate: x })} />
        <Input label="Atau pada kilometer" inputMode="numeric" value={v.nextServiceKm ?? ''} onChange={(e) => setV({ ...v, nextServiceKm: e.target.value.replace(/\D/g, '') })} />
        <Textarea className="sm:col-span-2" label="Catatan" value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        <div>{v.proof ? <FileLink id={v.proof.id} name={v.proof.originalName} onRemove={() => setV({ ...v, proof: null })} /> : v.proofFileId ? <FileLink id={v.proofFileId} name="Bukti tersimpan" /> : <FileUpload kind="MAINTENANCE_PROOF" label="Unggah bukti servis" compact onUploaded={(f) => setV({ ...v, proof: f })} />}</div>
      </div>
    </Modal>
  );
}

function CompleteDialog({ value, onClose }: { value: Row | null; onClose: () => void }) {
  const { settings, can } = useAuth();
  const toast = useToast();
  const [v, setV] = useState<Row | null>(value);
  const [last, setLast] = useState<Row | null>(null);
  if (value !== last) { setLast(value); setV(value); }
  const accounts = useCashAccounts();
  const save = useAction(() => api.post<Row>(`/maintenance/${v!.id}/complete`, {
    completedAt: v!.completedAt, cost: v!.cost || '0', km: v!.km === '' ? null : Number(v!.km), nextServiceDate: v!.nextServiceDate || null,
    nextServiceKm: v!.nextServiceKm === '' ? null : Number(v!.nextServiceKm), paymentMethod: v!.paymentMethod, cashAccountId: v!.cashAccountId || null,
  }), { success: 'Perawatan selesai — kendaraan tersedia kembali', onSuccess: (r) => { if (r.warning) toast.error(r.warning); onClose(); } });
  if (!v) return null;
  return (
    <Modal open={!!value} onClose={onClose} title={`Selesaikan ${v.number}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="teal" loading={save.isPending} onClick={() => save.mutate(undefined)}>Tandai selesai</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateTimeInput label="Waktu selesai" required value={v.completedAt} onChange={(x) => setV({ ...v, completedAt: x })} />
        <MoneyInput label="Biaya akhir" value={v.cost} onChange={(x) => setV({ ...v, cost: x })} />
        <Input label="Kilometer" inputMode="numeric" value={v.km} onChange={(e) => setV({ ...v, km: e.target.value.replace(/\D/g, '') })} />
        {can('expense.manage') && <Select label="Dibayar dengan" value={v.paymentMethod} onChange={(e) => setV({ ...v, paymentMethod: e.target.value })}>{settings?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</Select>}
        {can('expense.manage') && <Select label="Akun kas" value={v.cashAccountId ?? ''} onChange={(e) => setV({ ...v, cashAccountId: e.target.value })}><option value="">—</option>{accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
        <DateInput label="Servis berikutnya" value={v.nextServiceDate} onChange={(x) => setV({ ...v, nextServiceDate: x })} />
        <Input label="Atau pada kilometer" inputMode="numeric" value={v.nextServiceKm} onChange={(e) => setV({ ...v, nextServiceKm: e.target.value.replace(/\D/g, '') })} />
      </div>
    </Modal>
  );
}

