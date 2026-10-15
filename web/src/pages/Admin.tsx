import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction, useFieldErrors } from '../lib/hooks';
import { formatDate, formatDateTime } from '../lib/format';
import { ROLE } from '../lib/labels';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Skeleton, useConfirm, Tabs } from '../components/ui';
import { DataTable, SearchBox, useList, useListState, type Column } from '../components/DataTable';
import { InviteLinkDialog } from '../components/InviteLink';

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'companies' | 'users' | 'log'>('companies');
  if (!user?.isSuperAdmin) return <EmptyState title="Akses ditolak" description="Halaman ini khusus Super Admin platform." />;
  return (
    <>
      <PageHeader title="Super Admin" description="Kelola perusahaan (tenant), status aktif, dan keanggotaan. Super Admin tidak dapat melihat transaksi perusahaan kecuali diundang sebagai anggota." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'companies', label: 'Perusahaan' }, { value: 'users', label: 'Pengguna' }, { value: 'log', label: 'Log platform' }]} />
      {tab === 'companies' ? <Companies /> : tab === 'users' ? <Users /> : <PlatformLog />}
    </>
  );
}

function Companies() {
  const q = useQuery({ queryKey: ['admin-companies'], queryFn: () => api.get<Row[]>('/admin/companies') });
  const confirm = useConfirm();
  const [form, setForm] = useState<Row | null>(null);
  const [members, setMembers] = useState<Row | null>(null);
  const [invite, setInvite] = useState<{ link: string; email: string } | null>(null);
  const fe = useFieldErrors();
  const create = useAction(() => api.post<Row>('/admin/companies', form), {
    success: (r) => (r.owner.invited ? 'Perusahaan dibuat — Owner perlu mengaktifkan akunnya' : 'Perusahaan dibuat — Owner sudah bisa login'),
    fieldErrors: fe, invalidate: ['admin-companies'],
    onSuccess: (r) => { setForm(null); if (r.owner.inviteLink) setInvite({ link: r.owner.inviteLink, email: r.owner.user.email }); },
  });
  const toggle = useAction((c: Row) => api.patch(`/admin/companies/${c.id}`, { isActive: !c.isActive }), { success: 'Status perusahaan diperbarui', invalidate: ['admin-companies'] });
  return (
    <>
      <div className="mb-3 flex justify-end"><Button icon={<Plus className="size-4" />} onClick={() => setForm({ name: '', email: '', phone: '', address: '', ownerEmail: '', ownerName: '' })}>Perusahaan baru</Button></div>
      <Card bodyClassName="p-0">
        {!q.data ? <div className="p-4"><Skeleton /></div> : (
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Perusahaan</th><th>Kontak</th><th className="text-right">Anggota</th><th>Dibuat</th><th>Status</th><th /></tr></thead>
            <tbody>{q.data.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}<span className="block text-[12px] text-muted">{c.slug}</span></td>
                <td className="text-[13px]">{c.email ?? '—'}<span className="block text-muted">{c.phone}</span></td>
                <td className="num text-right">{c.members}</td><td>{formatDate(c.createdAt)}</td>
                <td>{c.isActive ? <Badge tone="teal">Aktif</Badge> : <Badge tone="muted">Nonaktif</Badge>}</td>
                <td className="whitespace-nowrap text-right">
                  <button type="button" className="mr-3 text-sm text-brand hover:underline" onClick={() => setMembers(c)}>Anggota</button>
                  <button type="button" className={`text-sm hover:underline ${c.isActive ? 'text-danger' : 'text-teal'}`} onClick={async () => {
                    if ((await confirm({ title: c.isActive ? `Nonaktifkan ${c.name}?` : `Aktifkan ${c.name}?`, message: c.isActive ? 'Semua anggota tidak dapat membuka data perusahaan ini sampai diaktifkan kembali. Data tidak dihapus.' : 'Anggota dapat kembali mengakses perusahaan.', tone: c.isActive ? 'danger' : 'primary', confirmLabel: c.isActive ? 'Nonaktifkan' : 'Aktifkan' })).ok) toggle.mutate(c);
                  }}>{c.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
                </td>
              </tr>))}</tbody></table></div>
        )}
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title="Perusahaan baru" footer={<><Button variant="secondary" onClick={() => setForm(null)}>Batal</Button><Button loading={create.isPending} onClick={() => create.mutate(undefined)}>Buat perusahaan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Nama perusahaan" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fe.errors.name} />
          <Input label="Email perusahaan" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Telepon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input className="sm:col-span-2" label="Alamat" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Input label="Nama Owner" required value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} error={fe.errors.ownerName} />
          <Input label="Email Owner" required type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} error={fe.errors.ownerEmail} hint="Email baru akan mendapat tautan aktivasi. Email yang sudah punya akun langsung mendapat akses." />
        </div>}
      </Modal>
      {members && <MembersDialog company={members} onClose={() => setMembers(null)} />}
      <InviteLinkDialog link={invite?.link ?? null} email={invite?.email} onClose={() => setInvite(null)} />
    </>
  );
}

function MembersDialog({ company, onClose }: { company: Row; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-members', company.id], queryFn: () => api.get<Row[]>(`/admin/companies/${company.id}/members`) });
  const [add, setAdd] = useState({ email: '', name: '', role: 'OWNER' });
  const [invite, setInvite] = useState<{ link: string; email: string } | null>(null);
  const create = useAction(() => api.post<Row>(`/admin/companies/${company.id}/members`, add), {
    success: 'Anggota ditambahkan', invalidate: ['admin-members', 'admin-companies'],
    onSuccess: (r) => { setAdd({ email: '', name: '', role: 'OWNER' }); if (r.inviteLink) setInvite({ link: r.inviteLink, email: r.user.email }); },
  });
  const update = useAction(({ id, patch }: { id: string; patch: Row }) => api.patch(`/admin/memberships/${id}`, patch), { success: 'Keanggotaan diperbarui', invalidate: ['admin-members'] });
  return (
    <Modal open onClose={onClose} title={`Anggota — ${company.name}`} size="lg">
      <div className="space-y-4">
        {!q.data ? <Skeleton /> : <table className="table-base"><tbody>{q.data.map((m) => (
          <tr key={m.id}><td>{m.name}<span className="block text-[12px] text-muted">{m.email}</span></td>
            <td><select className="input h-9 w-auto" value={m.role} onChange={(e) => update.mutate({ id: m.id, patch: { role: e.target.value } })} aria-label="Role">{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
            <td className="text-right"><button type="button" className="text-sm text-brand hover:underline" onClick={() => update.mutate({ id: m.id, patch: { status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } })}>{m.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}</button></td></tr>
        ))}</tbody></table>}
        <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <Input label="Email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
          <Input label="Nama" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <Select label="Role" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Button loading={create.isPending} onClick={() => create.mutate(undefined)}>Tambah</Button>
        </div>
      </div>
      <InviteLinkDialog link={invite?.link ?? null} email={invite?.email} onClose={() => setInvite(null)} />
    </Modal>
  );
}

function Users() {
  const state = useListState();
  const list = useList<Row>('/admin/users', state);
  const toggle = useAction(({ id, patch }: { id: string; patch: Row }) => api.patch(`/admin/users/${id}`, patch), { success: 'Pengguna diperbarui' });
  const cols: Column<Row>[] = [
    { key: 'name', header: 'Nama', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'email', header: 'Email', render: (r) => r.email },
    { key: 'companies', header: 'Perusahaan', align: 'right', render: (r) => r.companies },
    { key: 'last', header: 'Login terakhir', render: (r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : '—') },
    { key: 'flags', header: 'Status', render: (r) => <span className="flex gap-1">{r.isSuperAdmin && <Badge tone="brand">Super Admin</Badge>}{r.isActive ? <Badge tone="teal">Aktif</Badge> : <Badge tone="muted">Diblokir</Badge>}</span> },
    { key: 'a', header: '', align: 'right', render: (r) => <button type="button" className="text-sm text-brand hover:underline" onClick={() => toggle.mutate({ id: r.id, patch: { isActive: !r.isActive } })}>{r.isActive ? 'Blokir' : 'Aktifkan'}</button> },
  ];
  return <div className="card"><div className="border-b border-line p-3"><SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari email atau nama…" /></div><DataTable columns={cols} query={list} state={state} /></div>;
}

function PlatformLog() {
  const state = useListState();
  const list = useList<Row>('/admin/audit-logs', state);
  const cols: Column<Row>[] = [
    { key: 't', header: 'Waktu', render: (r) => formatDateTime(r.createdAt) },
    { key: 'u', header: 'Pengguna', render: (r) => r.userEmail ?? '—' },
    { key: 'a', header: 'Aksi', render: (r) => <code className="text-[12px]">{r.action}</code> },
    { key: 's', header: 'Keterangan', className: 'wrap', render: (r) => r.summary ?? '—' },
    { key: 'ip', header: 'IP', render: (r) => r.ip ?? '—' },
  ];
  return <div className="card"><DataTable columns={cols} query={list} state={state} /></div>;
}
