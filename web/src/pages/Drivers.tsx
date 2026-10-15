import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction, useFieldErrors } from '../lib/hooks';
import { formatMoney } from '../lib/format';
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Textarea, useConfirm } from '../components/ui';
import { DataTable, SearchBox, useList, useListState, type Column } from '../components/DataTable';
import { MoneyInput } from '../components/inputs';

export default function Drivers() {
  const state = useListState();
  const list = useList<Row>('/drivers', state);
  const { can } = useAuth();
  const confirm = useConfirm();
  const [form, setForm] = useState<Row | null>(null);
  const fe = useFieldErrors();
  const save = useAction(() => (form!.id ? api.put(`/drivers/${form!.id}`, form) : api.post('/drivers', form)), { success: 'Data sopir disimpan', fieldErrors: fe, onSuccess: () => setForm(null) });
  const archive = useAction((id: string) => api.post(`/drivers/${id}/archive`), { success: 'Sopir diarsipkan' });
  const cols: Column<Row>[] = [
    { key: 'code', header: 'Kode', render: (r) => <span className="text-muted">{r.code}</span> },
    { key: 'name', header: 'Nama', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'phone', header: 'Telepon', render: (r) => r.phone ?? '—' },
    { key: 'licenseNumber', header: 'No. SIM', hideBelow: 'md', render: (r) => r.licenseNumber ?? '—' },
    { key: 'dailyFee', header: 'Fee harian', align: 'right', render: (r) => formatMoney(r.dailyFee) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'ACTIVE' ? 'teal' : 'muted'}>{r.status === 'ACTIVE' ? 'Aktif' : 'Tidak aktif'}</Badge> },
    ...(can('driver.manage') ? [{ key: 'a', header: '', align: 'right' as const, render: (r: Row) => (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="ghost" onClick={() => setForm({ ...r, dailyFee: String(r.dailyFee).replace(/\.00$/, '') })}>Ubah</Button>
        <Button size="sm" variant="ghost" onClick={async () => { if ((await confirm({ title: 'Arsipkan sopir?', message: `${r.name} tidak akan muncul di pilihan sopir.`, confirmLabel: 'Arsipkan' })).ok) archive.mutate(r.id); }}>Arsipkan</Button>
      </span>) }] : []),
  ];
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <PageHeader title="Sopir" description="Daftar sopir untuk layanan sewa dengan sopir." actions={can('driver.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setForm({ name: '', phone: '', licenseNumber: '', dailyFee: '', status: 'ACTIVE', notes: '' })}>Tambah sopir</Button>} />
      <div className="card">
        <div className="border-b border-line p-3"><SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari nama atau telepon…" /></div>
        <DataTable columns={cols} query={list} state={state} empty={<EmptyState title="Belum ada sopir" description="Tambahkan sopir bila perusahaan menyediakan layanan dengan sopir." />} />
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Ubah sopir' : 'Tambah sopir'}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Simpan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Nama" required value={form.name} onChange={set('name')} error={fe.errors.name} />
          <Input label="Telepon" type="tel" value={form.phone ?? ''} onChange={set('phone')} />
          <Input label="No. SIM" value={form.licenseNumber ?? ''} onChange={set('licenseNumber')} />
          <MoneyInput label="Fee harian" value={form.dailyFee ?? ''} onChange={(v) => setForm({ ...form, dailyFee: v })} />
          <Select label="Status" value={form.status} onChange={set('status')}><option value="ACTIVE">Aktif</option><option value="INACTIVE">Tidak aktif</option></Select>
          <Textarea className="sm:col-span-2" label="Catatan" value={form.notes ?? ''} onChange={set('notes')} />
        </div>}
      </Modal>
    </>
  );
}
