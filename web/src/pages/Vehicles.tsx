import { useState } from 'react';
import { Route, Routes, useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Upload, ArrowLeft, Archive, RotateCcw, Pencil, Car, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction, useFieldErrors } from '../lib/hooks';
import { formatDate, formatDateTime, formatMoney, formatNumber, subMoney } from '../lib/format';
import { FUEL, MAINTENANCE_STATUS, RENTAL_STATUS, RESERVATION_STATUS, RENTAL_TYPE, TRANSMISSION, VEHICLE_STATUS } from '../lib/labels';
import { Badge, Button, Card, DefinitionList, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Textarea, useConfirm, Checkbox } from '../components/ui';
import { DataTable, SearchBox, useList, useListState, type Column } from '../components/DataTable';
import { AuthImage, DateInput, FileUpload, MoneyInput, Plate } from '../components/inputs';

export default function Vehicles() {
  return (
    <Routes>
      <Route index element={<VehicleList />} />
      <Route path=":id" element={<VehicleDetail />} />
    </Routes>
  );
}

const dailyRate = (r: Row) => (r.rates as Row[] | null)?.find((x) => x.rentalType === 'DAILY' && !x.withDriver)?.price;

function VehicleList() {
  const state = useListState({ archived: 'false' });
  const list = useList<Row>('/vehicles', state);
  const { can } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<Row | null>(null);
  const cols: Column<Row>[] = [
    { key: 'plateNumber', header: 'No. polisi', sortKey: 'plateNumber', render: (r) => <Plate>{r.plateNumber}</Plate> },
    { key: 'name', header: 'Kendaraan', sortKey: 'brand', render: (r) => <div><div className="font-medium">{r.brand} {r.model}</div><div className="text-[12.5px] text-muted">{r.code} · {TRANSMISSION[r.transmission]} · {r.seats ?? '–'} kursi</div></div> },
    { key: 'year', header: 'Tahun', sortKey: 'year', hideBelow: 'md', render: (r) => r.year ?? '—' },
    { key: 'color', header: 'Warna', hideBelow: 'lg', render: (r) => r.color ?? '—' },
    { key: 'rate', header: 'Tarif harian', align: 'right', hideBelow: 'sm', render: (r) => formatMoney(dailyRate(r)) },
    { key: 'status', header: 'Status', render: (r) => <span className="flex flex-wrap gap-1"><StatusBadge map={VEHICLE_STATUS} value={r.status} />{r.overdue && <Badge tone="danger">Terlambat</Badge>}</span> },
    { key: 'next', header: 'Jadwal berikutnya', hideBelow: 'lg', render: (r) => r.nextBookingAt ? formatDateTime(r.nextBookingAt) : <span className="text-muted">—</span> },
  ];
  return (
    <>
      <PageHeader title="Kendaraan" description="Armada, status ketersediaan, dan tarif."
        actions={<>
          {can('vehicle.import') && <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => navigate('/import/vehicles')}>Impor Excel/CSV</Button>}
          {can('vehicle.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setForm({})}>Tambah kendaraan</Button>}
        </>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari nopol, merek, model…" />
          <select className="input w-auto" value={state.get('status')} onChange={(e) => state.set({ status: e.target.value })} aria-label="Status">
            <option value="">Semua status</option>{Object.entries(VEHICLE_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}<option value="OVERDUE">Terlambat dikembalikan</option>
          </select>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="accent-brand" checked={state.get('archived') === 'true'} onChange={(e) => state.set({ archived: e.target.checked ? 'true' : 'false' })} />Tampilkan arsip</label>
        </div>
        <DataTable columns={cols} query={list} state={state} onRowClick={(r) => navigate(`/vehicles/${r.id}`)}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1"><Plate size="sm">{r.plateNumber}</Plate><p className="mt-1 truncate text-sm font-medium">{r.brand} {r.model}</p><p className="num text-[12.5px] text-muted">{formatMoney(dailyRate(r))}/hari</p></div>
              <StatusBadge map={VEHICLE_STATUS} value={r.status} />
            </div>
          )}
          empty={<EmptyState icon={<Car className="size-9" strokeWidth={1.4} />} title="Belum ada kendaraan" description="Tambahkan kendaraan pertama atau impor daftar armada dari Excel."
            action={can('vehicle.manage') ? <Button icon={<Plus className="size-4" />} onClick={() => setForm({})}>Tambah kendaraan</Button> : undefined} />} />
      </div>
      <VehicleForm open={!!form} initial={form ?? {}} onClose={() => setForm(null)} onSaved={(v) => navigate(`/vehicles/${v.id}`)} />
    </>
  );
}

export const RATE_GRID: [string, boolean][] = [['DAILY', false], ['WEEKLY', false], ['MONTHLY', false], ['DAILY', true], ['WEEKLY', true], ['MONTHLY', true]];

export function RatesEditor({ rates, onChange, disabled }: { rates: Record<string, string>; onChange: (r: Record<string, string>) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[false, true].map((driver) => (
        <fieldset key={String(driver)} className="space-y-2 rounded-md border border-line p-3">
          <legend className="px-1 text-[13px] font-medium text-ink-2">{driver ? 'Dengan sopir' : 'Tanpa sopir (lepas kunci)'}</legend>
          {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((t) => (
            <MoneyInput key={t} label={RENTAL_TYPE[t]} disabled={disabled} value={rates[`${t}-${driver}`] ?? ''} onChange={(v) => onChange({ ...rates, [`${t}-${driver}`]: v })} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

export const ratesToMap = (rates: Row[] | null | undefined) =>
  Object.fromEntries((rates ?? []).map((r) => [`${r.rentalType}-${r.withDriver}`, String(r.price).replace(/\.00$/, '')]));
export const mapToRates = (m: Record<string, string>) =>
  RATE_GRID.filter(([t, d]) => m[`${t}-${d}`] !== undefined && m[`${t}-${d}`] !== '').map(([t, d]) => ({ rentalType: t, withDriver: d, price: m[`${t}-${d}`] }));

const blank = { plateNumber: '', brand: '', model: '', year: '', color: '', transmission: 'MANUAL', fuelType: 'BENSIN', seats: '', chassisNumber: '', engineNumber: '', purchaseDate: '', purchasePrice: '', currentKm: '', isActive: true, notes: '' };

function VehicleForm({ open, initial, onClose, onSaved }: { open: boolean; initial: Row; onClose: () => void; onSaved?: (v: Row) => void }) {
  const { can } = useAuth();
  const [v, setV] = useState<Row>({ ...blank });
  const [rates, setRates] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setV({ ...blank, ...Object.fromEntries(Object.entries(initial).map(([k, x]) => [k, x ?? ''])), purchasePrice: initial.purchasePrice ? String(initial.purchasePrice).replace(/\.00$/, '') : '' });
      setRates(ratesToMap(initial.rates));
    }
  }
  const fe = useFieldErrors();
  const editing = !!initial.id;
  const save = useAction(() => {
    const payload = { ...v, year: v.year || null, seats: v.seats || null, currentKm: v.currentKm || null, purchasePrice: v.purchasePrice || null, purchaseDate: v.purchaseDate || null, rates: can('rate.manage') ? mapToRates(rates) : undefined };
    return editing ? api.put<Row>(`/vehicles/${initial.id}`, payload) : api.post<Row>('/vehicles', payload);
  }, { success: editing ? 'Kendaraan diperbarui' : 'Kendaraan ditambahkan', fieldErrors: fe, onSuccess: (r) => { onClose(); onSaved?.(r); } });
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Ubah kendaraan' : 'Tambah kendaraan'} size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{editing ? 'Simpan perubahan' : 'Simpan kendaraan'}</Button></>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Nomor polisi" required value={v.plateNumber} onChange={set('plateNumber')} error={fe.errors.plateNumber} hint="Contoh: B 1234 XYZ" autoCapitalize="characters" />
          <Input label="Merek" required value={v.brand} onChange={set('brand')} error={fe.errors.brand} />
          <Input label="Model / tipe" required value={v.model} onChange={set('model')} error={fe.errors.model} />
          <Input label="Tahun" inputMode="numeric" value={v.year} onChange={set('year')} error={fe.errors.year} />
          <Input label="Warna" value={v.color} onChange={set('color')} />
          <Input label="Kapasitas penumpang" inputMode="numeric" value={v.seats} onChange={set('seats')} error={fe.errors.seats} />
          <Select label="Transmisi" value={v.transmission} onChange={set('transmission')}>{Object.entries(TRANSMISSION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Select label="Bahan bakar" value={v.fuelType} onChange={set('fuelType')}>{Object.entries(FUEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Input label="Kilometer saat ini" inputMode="numeric" value={v.currentKm} onChange={set('currentKm')} />
          <Input label="Nomor rangka" value={v.chassisNumber} onChange={set('chassisNumber')} />
          <Input label="Nomor mesin" value={v.engineNumber} onChange={set('engineNumber')} />
          <DateInput label="Tanggal pembelian" value={v.purchaseDate} onChange={(x) => setV({ ...v, purchaseDate: x })} />
          {can('report.financial') && <MoneyInput label="Harga perolehan" value={v.purchasePrice} onChange={(x) => setV({ ...v, purchasePrice: x })} />}
          <div className="flex items-end"><Checkbox label="Kendaraan aktif" hint="Nonaktifkan untuk mengeluarkan dari daftar sewa" checked={!!v.isActive} onChange={(x) => setV({ ...v, isActive: x })} /></div>
        </div>
        <div>
          <h3 className="mb-2 text-[14px] font-semibold">Tarif rental</h3>
          {!can('rate.manage') && <p className="mb-2 text-[13px] text-muted">Anda tidak memiliki izin mengubah tarif.</p>}
          <RatesEditor rates={rates} onChange={setRates} disabled={!can('rate.manage')} />
        </div>
        <Textarea label="Catatan" rows={2} value={v.notes} onChange={set('notes')} />
      </form>
    </Modal>
  );
}

function VehicleDetail() {
  const { id } = useParams();
  const { activeCompanyId, can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['vehicle', activeCompanyId, id], queryFn: () => api.get<Row>(`/vehicles/${id}`) });
  const photo = useAction((fileId: string) => api.put(`/vehicles/${id}`, { ...q.data!.vehicle, purchasePrice: q.data!.vehicle.purchasePrice, photoFileId: fileId }), { success: 'Foto diperbarui' });
  const archive = useAction(() => api.post(`/vehicles/${id}/${q.data?.vehicle.archivedAt ? 'restore' : 'archive'}`), { success: 'Status arsip diperbarui' });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="space-y-3"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-60" /></div>;
  const { vehicle: v, schedule, stats, maintenance } = q.data;
  return (
    <>
      <PageHeader back={<Link to="/vehicles" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Kendaraan</Link>}
        title={<span className="flex flex-wrap items-center gap-2.5"><Plate>{v.plateNumber}</Plate>{v.brand} {v.model}<StatusBadge map={VEHICLE_STATUS} value={v.status} /></span>}
        description={`${v.code}${v.year ? ` · ${v.year}` : ''}${v.color ? ` · ${v.color}` : ''}`}
        actions={<>
          {can('vehicle.manage') && <Button variant="secondary" icon={v.archivedAt ? <RotateCcw className="size-4" /> : <Archive className="size-4" />} onClick={async () => {
            if ((await confirm({ title: v.archivedAt ? 'Pulihkan kendaraan?' : 'Arsipkan kendaraan?', message: v.archivedAt ? 'Kendaraan akan muncul lagi di daftar.' : 'Kendaraan tidak akan ditawarkan untuk sewa. Riwayat tetap tersimpan.', confirmLabel: v.archivedAt ? 'Pulihkan' : 'Arsipkan' })).ok) archive.mutate(undefined);
          }}>{v.archivedAt ? 'Pulihkan' : 'Arsipkan'}</Button>}
          {can('maintenance.manage') && <Button variant="secondary" icon={<Wrench className="size-4" />} onClick={() => navigate(`/maintenance?new=${v.id}`)}>Catat perawatan</Button>}
          {can('vehicle.manage') && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Ubah</Button>}
          {can('rental.manage') && v.status !== 'INACTIVE' && <Button icon={<Plus className="size-4" />} onClick={() => navigate(`/rentals/new?vehicleId=${v.id}`)}>Sewakan</Button>}
        </>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="card overflow-hidden">
            {v.photoFileId ? <AuthImage fileId={v.photoFileId} alt={`Foto ${v.plateNumber}`} className="aspect-[4/3] w-full object-cover" />
              : <div className="grid aspect-[4/3] place-items-center bg-paper text-muted"><Car className="size-14" strokeWidth={1} /></div>}
            {can('vehicle.manage') && <div className="p-3"><FileUpload kind="VEHICLE_PHOTO" entityType="vehicle" entityId={v.id} accept="image/jpeg,image/png,image/webp" label={v.photoFileId ? 'Ganti foto' : 'Unggah foto'} compact onUploaded={(f) => photo.mutate(f.id)} /></div>}
          </div>
          <Card title="Spesifikasi">
            <DefinitionList items={[
              ['Transmisi', TRANSMISSION[v.transmission]], ['Bahan bakar', FUEL[v.fuelType]], ['Kapasitas', v.seats ? `${v.seats} penumpang` : null],
              ['Kilometer', v.currentKm != null ? `${formatNumber(v.currentKm)} km` : null], ['No. rangka', v.chassisNumber], ['No. mesin', v.engineNumber],
              ['Tgl. pembelian', v.purchaseDate ? formatDate(v.purchaseDate) : null], ...(v.purchasePrice ? [['Harga perolehan', formatMoney(v.purchasePrice)] as [string, string]] : []),
            ]} />
            {v.notes && <p className="mt-3 text-sm text-muted">{v.notes}</p>}
          </Card>
        </div>
        <div className="space-y-5">
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <div className="card p-4"><p className="text-[13px] text-muted">Pendapatan</p><p className="num mt-1 font-semibold">{formatMoney(stats.revenue)}</p><p className="text-[12px] text-muted">{stats.rentalCount} transaksi</p></div>
              <div className="card p-4"><p className="text-[13px] text-muted">Biaya</p><p className="num mt-1 font-semibold">{formatMoney(stats.expenses)}</p></div>
              <div className="card p-4"><p className="text-[13px] text-muted">Laba operasional</p><p className="num mt-1 font-semibold text-teal">{formatMoney(subMoney(stats.revenue, stats.expenses))}</p></div>
            </div>
          )}
          <Card title="Tarif" actions={can('rate.manage') && <Link to="/rates" className="text-sm text-brand hover:underline">Kelola tarif</Link>} bodyClassName="p-0">
            <table className="table-base"><thead><tr><th>Jenis</th><th className="text-right">Tanpa sopir</th><th className="text-right">Dengan sopir</th></tr></thead>
              <tbody>{(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((t) => {
                const m = ratesToMap(v.rates);
                return <tr key={t}><td>{RENTAL_TYPE[t]}</td><td className="num text-right">{formatMoney(m[`${t}-false`])}</td><td className="num text-right">{formatMoney(m[`${t}-true`])}</td></tr>;
              })}</tbody></table>
          </Card>
          <Card title="Jadwal" actions={<Link to={`/calendar?vehicleId=${v.id}`} className="text-sm text-brand hover:underline">Lihat kalender</Link>} bodyClassName="p-0">
            {schedule.length === 0 ? <EmptyState title="Tidak ada jadwal" description="Kendaraan belum memiliki reservasi, transaksi, atau perawatan." /> : (
              <ul className="divide-y divide-line">{schedule.map((s: Row) => (
                <li key={s.sourceId}>
                  <button type="button" onClick={() => navigate(s.sourceType === 'RENTAL' ? `/rentals/${s.sourceId}` : s.sourceType === 'RESERVATION' ? `/reservations/${s.sourceId}` : '/maintenance')}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-paper">
                    <span className="w-24 shrink-0 text-[12.5px] text-muted">{s.sourceType === 'RENTAL' ? 'Transaksi' : s.sourceType === 'RESERVATION' ? 'Reservasi' : 'Perawatan'}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.number} — {s.label}</span><span className="text-[12.5px] text-muted">{formatDateTime(s.startAt)} – {s.endAt ? formatDateTime(s.endAt) : 'belum ditentukan'}</span></span>
                    <StatusBadge map={s.sourceType === 'RENTAL' ? RENTAL_STATUS : s.sourceType === 'RESERVATION' ? RESERVATION_STATUS : MAINTENANCE_STATUS} value={s.status} />
                  </button>
                </li>))}</ul>
            )}
          </Card>
          <Card title="Riwayat perawatan" bodyClassName="p-0">
            {maintenance.length === 0 ? <EmptyState title="Belum ada catatan perawatan" /> : (
              <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Tanggal</th><th>Jenis servis</th><th>Bengkel</th><th>Status</th><th className="text-right">Biaya</th></tr></thead>
                <tbody>{maintenance.map((m: Row) => <tr key={m.id}><td>{formatDate(m.startAt)}</td><td>{m.serviceType}</td><td>{m.workshop ?? '—'}</td><td><StatusBadge map={MAINTENANCE_STATUS} value={m.status} /></td><td className="num text-right">{formatMoney(m.cost)}</td></tr>)}</tbody></table></div>
            )}
          </Card>
        </div>
      </div>
      <VehicleForm open={edit} initial={v} onClose={() => setEdit(false)} />
    </>
  );
}
