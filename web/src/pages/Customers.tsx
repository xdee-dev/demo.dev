import { useState } from 'react';
import { Route, Routes, useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Upload, ArrowLeft, Archive, RotateCcw, Pencil } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction, useFieldErrors } from '../lib/hooks';
import { formatDate, formatMoney } from '../lib/format';
import { CUSTOMER_STATUS, ID_TYPES, PAYMENT_STATUS, RENTAL_STATUS, RESERVATION_STATUS } from '../lib/labels';
import { Badge, Button, Card, DefinitionList, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Textarea, useConfirm, Tabs } from '../components/ui';
import { DataTable, SearchBox, useList, useListState, type Column } from '../components/DataTable';
import { FileLink, FileUpload, Plate } from '../components/inputs';
import { useToast } from '../components/Toast';

export default function Customers() {
  return (
    <Routes>
      <Route index element={<CustomerList />} />
      <Route path=":id" element={<CustomerDetail />} />
    </Routes>
  );
}

function CustomerList() {
  const state = useListState({ archived: 'false' });
  const list = useList<Row>('/customers', state);
  const { can } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<Row | null>(null);
  const archived = state.get('archived') === 'true';
  const cols: Column<Row>[] = [
    { key: 'code', header: 'Kode', sortKey: 'code', hideBelow: 'lg', render: (r) => <span className="text-muted">{r.code}</span> },
    { key: 'name', header: 'Nama', sortKey: 'name', render: (r) => <div><div className="font-medium">{r.name}</div>{r.type === 'COMPANY' && <div className="text-[12.5px] text-muted">Perusahaan{r.contactPerson ? ` — ${r.contactPerson}` : ''}</div>}</div> },
    { key: 'phone', header: 'Telepon', render: (r) => r.phone },
    { key: 'email', header: 'Email', hideBelow: 'lg', render: (r) => r.email ?? '—' },
    { key: 'rentalCount', header: 'Transaksi', align: 'right', hideBelow: 'md', render: (r) => r.rentalCount },
    { key: 'totalBilled', header: 'Total transaksi', align: 'right', sortKey: 'totalBilled', hideBelow: 'md', render: (r) => formatMoney(r.totalBilled) },
    { key: 'receivable', header: 'Piutang', align: 'right', sortKey: 'receivable', render: (r) => <span className={Number(r.receivable) > 0 ? 'font-medium text-warn' : 'text-muted'}>{formatMoney(r.receivable)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge map={CUSTOMER_STATUS} value={r.status} /> },
  ];
  return (
    <>
      <PageHeader title="Customer" description="Data penyewa individu dan perusahaan."
        actions={<>
          {can('customer.import') && <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => navigate('/import/customers')}>Impor Excel/CSV</Button>}
          {can('customer.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setForm({})}>Tambah customer</Button>}
        </>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari nama, telepon, kode, NIK…" />
          <select className="input w-auto" value={state.get('status')} onChange={(e) => state.set({ status: e.target.value })} aria-label="Status">
            <option value="">Semua status</option>{Object.entries(CUSTOMER_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="input w-auto" value={state.get('type')} onChange={(e) => state.set({ type: e.target.value })} aria-label="Jenis">
            <option value="">Semua jenis</option><option value="INDIVIDUAL">Individu</option><option value="COMPANY">Perusahaan</option>
          </select>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="accent-brand" checked={archived} onChange={(e) => state.set({ archived: e.target.checked ? 'true' : 'false' })} />Tampilkan arsip</label>
        </div>
        <DataTable columns={cols} query={list} state={state} onRowClick={(r) => navigate(`/customers/${r.id}`)}
          mobileCard={(r) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="truncate font-medium">{r.name}</p><p className="text-[13px] text-muted">{r.phone}</p></div>
              <div className="text-right"><StatusBadge map={CUSTOMER_STATUS} value={r.status} />{Number(r.receivable) > 0 && <p className="num mt-1 text-[12.5px] text-warn">{formatMoney(r.receivable)}</p>}</div>
            </div>
          )}
          empty={<EmptyState title={archived ? 'Tidak ada customer diarsipkan' : 'Belum ada customer'} description="Tambahkan customer baru atau impor dari Excel."
            action={can('customer.manage') && !archived ? <Button icon={<Plus className="size-4" />} onClick={() => setForm({})}>Tambah customer</Button> : undefined} />} />
      </div>
      <CustomerForm open={!!form} initial={form ?? {}} onClose={() => setForm(null)} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </>
  );
}

const blank = { type: 'INDIVIDUAL', name: '', contactPerson: '', phone: '', email: '', address: '', idType: 'KTP', idNumber: '', notes: '', status: 'ACTIVE' };

export function CustomerForm({ open, initial, onClose, onSaved }: { open: boolean; initial: Row; onClose: () => void; onSaved?: (c: Row) => void }) {
  const [v, setV] = useState<Row>({ ...blank, ...initial });
  const [dups, setDups] = useState<Row[] | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) { setLastOpen(open); if (open) { setV({ ...blank, ...initial }); setDups(null); } }
  const fe = useFieldErrors();
  const editing = !!initial.id;
  const save = useAction((confirmDuplicate: boolean) => (editing ? api.put<Row>(`/customers/${initial.id}`, { ...v, confirmDuplicate }) : api.post<Row>('/customers', { ...v, confirmDuplicate })), {
    success: editing ? 'Customer diperbarui' : 'Customer ditambahkan', fieldErrors: fe,
    onSuccess: (c) => { onClose(); onSaved?.(c); },
  });
  const submit = (confirmDuplicate = false) => save.mutate(confirmDuplicate, {
    onError: (e) => { if (e instanceof ApiError && e.code === 'DUPLICATE_CANDIDATE') setDups((e.details?.duplicates as Row[]) ?? []); },
  });
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Ubah customer' : 'Tambah customer'} size="lg"
      footer={dups ? <>
        <Button variant="secondary" onClick={() => setDups(null)}>Periksa lagi</Button>
        <Button onClick={() => submit(true)} loading={save.isPending}>Tetap simpan sebagai customer baru</Button>
      </> : <>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={() => submit(false)} loading={save.isPending}>{editing ? 'Simpan perubahan' : 'Simpan customer'}</Button>
      </>}>
      {dups ? (
        <div className="space-y-3 text-sm">
          <p>Data ini mirip dengan customer yang sudah ada. Pastikan Anda tidak membuat customer ganda.</p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {dups.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span><b>{d.name}</b> <span className="text-muted">{d.code} · {d.phone}</span></span>
                <Badge tone="warn">{d.reason === 'phone' ? 'Telepon sama' : d.reason === 'idNumber' ? 'No. identitas sama' : 'Nama sama'}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
          <Select label="Jenis customer" value={v.type} onChange={set('type')}><option value="INDIVIDUAL">Individu</option><option value="COMPANY">Perusahaan</option></Select>
          <Select label="Status" value={v.status} onChange={set('status')}>{Object.entries(CUSTOMER_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Input className="sm:col-span-2" label={v.type === 'COMPANY' ? 'Nama perusahaan' : 'Nama lengkap'} required value={v.name} onChange={set('name')} error={fe.errors.name} />
          {v.type === 'COMPANY' && <Input className="sm:col-span-2" label="Kontak person" value={v.contactPerson ?? ''} onChange={set('contactPerson')} />}
          <Input label="Nomor telepon" required type="tel" inputMode="tel" value={v.phone} onChange={set('phone')} error={fe.errors.phone} hint="Contoh: 0812-3456-7890" />
          <Input label="Email" type="email" inputMode="email" value={v.email ?? ''} onChange={set('email')} error={fe.errors.email} />
          <Textarea className="sm:col-span-2" label="Alamat" rows={2} value={v.address ?? ''} onChange={set('address')} />
          <Select label="Jenis identitas" value={v.idType ?? ''} onChange={set('idType')}><option value="">—</option>{ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
          <Input label="Nomor identitas" value={v.idNumber ?? ''} onChange={set('idNumber')} error={fe.errors.idNumber} />
          <Textarea className="sm:col-span-2" label="Catatan" rows={2} value={v.notes ?? ''} onChange={set('notes')} />
        </form>
      )}
    </Modal>
  );
}

function CustomerDetail() {
  const { id } = useParams();
  const { activeCompanyId, can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<'rentals' | 'reservations' | 'docs'>('rentals');
  const q = useQuery({ queryKey: ['customer', activeCompanyId, id], queryFn: () => api.get<Row>(`/customers/${id}`) });
  const docs = useQuery({ queryKey: ['attachments', activeCompanyId, 'customer', id], queryFn: () => api.get<Row[]>('/attachments', { entityType: 'customer', entityId: id }), enabled: tab === 'docs' });
  const archive = useAction(() => api.post(`/customers/${id}/${q.data?.customer.archivedAt ? 'restore' : 'archive'}`), { success: q.data?.customer.archivedAt ? 'Customer dipulihkan' : 'Customer diarsipkan' });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="space-y-3"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-40" /></div>;
  const { customer: c, stats, rentals, reservations } = q.data;
  return (
    <>
      <PageHeader back={<Link to="/customers" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Customer</Link>}
        title={<span className="flex flex-wrap items-center gap-2">{c.name}<StatusBadge map={CUSTOMER_STATUS} value={c.status} />{c.archivedAt && <Badge tone="muted">Diarsipkan</Badge>}</span>}
        description={`${c.code} · ${c.type === 'COMPANY' ? 'Perusahaan' : 'Individu'}`}
        actions={can('customer.manage') && <>
          <Button variant="secondary" icon={c.archivedAt ? <RotateCcw className="size-4" /> : <Archive className="size-4" />} loading={archive.isPending} onClick={async () => {
            const r = await confirm({ title: c.archivedAt ? 'Pulihkan customer?' : 'Arsipkan customer?', message: c.archivedAt ? 'Customer akan muncul lagi di daftar dan formulir transaksi.' : 'Customer tidak akan muncul di formulir transaksi. Riwayat transaksi tetap tersimpan.', confirmLabel: c.archivedAt ? 'Pulihkan' : 'Arsipkan' });
            if (r.ok) archive.mutate(undefined);
          }}>{c.archivedAt ? 'Pulihkan' : 'Arsipkan'}</Button>
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Ubah</Button>
          {can('rental.manage') && !c.archivedAt && c.status !== 'BLACKLISTED' && <Button icon={<Plus className="size-4" />} onClick={() => navigate(`/rentals/new?customerId=${c.id}`)}>Transaksi baru</Button>}
        </>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5 lg:order-2">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <div className="card p-4"><p className="text-[13px] text-muted">Total nilai transaksi</p><p className="num mt-1 text-lg font-semibold">{formatMoney(stats.totalBilled)}</p><p className="text-[12.5px] text-muted">{stats.rentalCount} transaksi</p></div>
            <div className="card p-4"><p className="text-[13px] text-muted">Total pembayaran</p><p className="num mt-1 text-lg font-semibold text-teal">{formatMoney(stats.totalPaid)}</p></div>
            <div className="card col-span-2 p-4 lg:col-span-1"><p className="text-[13px] text-muted">Piutang</p><p className={`num mt-1 text-lg font-semibold ${Number(stats.receivable) > 0 ? 'text-warn' : ''}`}>{formatMoney(stats.receivable)}</p></div>
          </div>
          <Card title="Data customer">
            <DefinitionList className="sm:grid-cols-1" items={[
              ['Telepon', <a href={`tel:${c.phone}`} className="text-brand">{c.phone}</a>], ['Email', c.email], ['Alamat', c.address],
              ...(c.type === 'COMPANY' ? [['Kontak person', c.contactPerson] as [string, string]] : []),
              ['Identitas', c.idNumber ? `${c.idType ?? ''} ${c.idNumber}` : null], ['Catatan', c.notes], ['Terdaftar', formatDate(c.createdAt)],
            ]} />
          </Card>
        </div>
        <div className="card lg:order-1">
          <div className="px-4 pt-2"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'rentals', label: `Riwayat transaksi (${rentals.length})` }, { value: 'reservations', label: `Reservasi (${reservations.length})` }, { value: 'docs', label: 'Dokumen' }]} /></div>
          {tab === 'rentals' && (rentals.length === 0 ? <EmptyState title="Belum ada transaksi" /> : (
            <div className="overflow-x-auto"><table className="table-base">
              <thead><tr><th>No. transaksi</th><th>Kendaraan</th><th>Mulai</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Sisa</th></tr></thead>
              <tbody>{rentals.map((r: Row) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/rentals/${r.id}`)}>
                  <td className="font-medium">{r.number}</td><td><Plate size="sm">{r.plateNumber}</Plate></td><td>{formatDate(r.startAt)}</td>
                  <td><StatusBadge map={RENTAL_STATUS} value={r.status} /></td><td className="num text-right">{formatMoney(r.total)}</td>
                  <td className="num text-right"><span title={PAYMENT_STATUS[r.paymentStatus]?.[0]}>{formatMoney(r.balance)}</span></td>
                </tr>))}</tbody>
            </table></div>
          ))}
          {tab === 'reservations' && (reservations.length === 0 ? <EmptyState title="Tidak ada reservasi aktif" /> : (
            <ul className="divide-y divide-line">{reservations.map((r: Row) => (
              <li key={r.id}><button type="button" onClick={() => navigate(`/reservations/${r.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper">
                <span className="flex-1"><b className="text-sm">{r.number}</b> <span className="text-[13px] text-muted">{formatDate(r.startAt)} – {formatDate(r.endAt)}</span></span>
                <Plate size="sm">{r.plateNumber}</Plate><StatusBadge map={RESERVATION_STATUS} value={r.status} />
              </button></li>))}</ul>
          ))}
          {tab === 'docs' && (
            <div className="space-y-3 p-4">
              <p className="text-sm text-muted">Foto KTP/SIM atau dokumen pendukung (JPG, PNG, WEBP, PDF; maks. 5 MB). File hanya dapat dibuka oleh pengguna perusahaan ini.</p>
              {can('customer.manage') && <FileUpload kind="CUSTOMER_DOC" entityType="customer" entityId={c.id} label="Unggah dokumen" onUploaded={() => docs.refetch()} />}
              <div className="flex flex-wrap gap-2">{docs.data?.map((f) => <FileLink key={f.id} id={f.id} name={f.originalName} />)}</div>
              {docs.data?.length === 0 && <p className="text-sm text-muted">Belum ada dokumen.</p>}
            </div>
          )}
        </div>
      </div>
      <CustomerForm open={edit} initial={c} onClose={() => setEdit(false)} onSaved={() => { q.refetch(); toast.success('Tersimpan'); }} />
    </>
  );
}
