import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Mail } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth, type Settings as SettingsT } from '../../lib/auth';
import type { Row } from '../../lib/types';
import { useAction, useFieldErrors } from '../../lib/hooks';
import { formatDateTime } from '../../lib/format';
import { ROLE } from '../../lib/labels';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton, Textarea, useConfirm, cx } from '../../components/ui';
import { AuthImage, FileUpload, MoneyInput } from '../../components/inputs';
import { DataTable, SearchBox, useList, useListState, type Column } from '../../components/DataTable';
import { InviteLinkDialog } from '../../components/InviteLink';

export default function Settings() {
  const { section } = useParams();
  const { can } = useAuth();
  const need = section === 'users' ? 'users.manage' : section === 'audit' ? 'audit.view' : 'settings.manage';
  if (!can(need)) return <EmptyState title="Akses ditolak" description="Hanya Owner atau pengguna dengan izin pengaturan yang dapat membuka halaman ini." />;
  switch (section) {
    case 'company': return <CompanyProfile />;
    case 'users': return <UsersRoles />;
    case 'numbering': return <Numbering />;
    case 'print': return <PrintTemplates />;
    case 'system': return <SystemSettings />;
    case 'audit': return <AuditLog />;
    default: return <EmptyState title="Halaman tidak ditemukan" />;
  }
}

/** Shared load/save of the company settings JSON. */
function useSettingsEditor() {
  const { settings, refresh } = useAuth();
  const [draft, setDraft] = useState<SettingsT | null>(null);
  const v = draft ?? settings;
  const save = useAction(() => api.put('/company/settings', v), { success: 'Pengaturan disimpan', onSuccess: () => { setDraft(null); refresh(); } });
  return { v, set: (patch: Partial<SettingsT>) => setDraft({ ...(v as SettingsT), ...patch }), dirty: !!draft, save, reset: () => setDraft(null) };
}

function SaveBar({ dirty, onSave, onReset, loading }: { dirty: boolean; onSave: () => void; onReset: () => void; loading: boolean }) {
  return (
    <div className="sticky bottom-[70px] z-10 mt-5 flex justify-end gap-2 lg:bottom-4">
      {dirty && <Button variant="secondary" onClick={onReset}>Batalkan perubahan</Button>}
      <Button disabled={!dirty} loading={loading} onClick={onSave}>Simpan pengaturan</Button>
    </div>
  );
}

/* --------------------------------------------------------- company profile */

function CompanyProfile() {
  const { company } = useAuth();
  const [v, setV] = useState<Row | null>(null);
  const cur = v ?? company;
  const fe = useFieldErrors();
  const save = useAction(() => api.put('/company/profile', cur), { success: 'Profil perusahaan disimpan', fieldErrors: fe, onSuccess: () => setV(null) });
  if (!cur) return <Skeleton className="h-60" />;
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...cur, [k]: e.target.value });
  const banks = (cur.bankAccounts ?? []) as Row[];
  return (
    <>
      <PageHeader title="Profil perusahaan" description="Nama, logo, kontak, dan rekening ini dicetak pada invoice, kwitansi, dan kontrak. Dokumen lama tetap memakai data saat transaksi dibuat." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card title="Identitas & kontak">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input className="sm:col-span-2" label="Nama perusahaan" required value={cur.name} onChange={set('name')} error={fe.errors.name} />
            <Textarea className="sm:col-span-2" label="Alamat" rows={2} value={cur.address ?? ''} onChange={set('address')} />
            <Input label="Kota" value={cur.city ?? ''} onChange={set('city')} />
            <Input label="Telepon" value={cur.phone ?? ''} onChange={set('phone')} />
            <Input label="Email" type="email" value={cur.email ?? ''} onChange={set('email')} error={fe.errors.email} />
            <Input label="Website" value={cur.website ?? ''} onChange={set('website')} />
            <Input label="NPWP (opsional)" value={cur.npwp ?? ''} onChange={set('npwp')} />
            <Select label="Zona waktu" value={cur.timezone} onChange={set('timezone')}>
              <option value="Asia/Jakarta">WIB — Asia/Jakarta</option><option value="Asia/Makassar">WITA — Asia/Makassar</option><option value="Asia/Jayapura">WIT — Asia/Jayapura</option>
            </Select>
          </div>
          <h3 className="mb-2 mt-6 text-[14px] font-semibold">Rekening bank</h3>
          <div className="space-y-2">
            {banks.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-end gap-2">
                <Input label={i === 0 ? 'Bank' : undefined} value={b.bank} onChange={(e) => setV({ ...cur, bankAccounts: banks.map((x, j) => (j === i ? { ...x, bank: e.target.value } : x)) })} />
                <Input label={i === 0 ? 'No. rekening' : undefined} value={b.accountNumber} onChange={(e) => setV({ ...cur, bankAccounts: banks.map((x, j) => (j === i ? { ...x, accountNumber: e.target.value } : x)) })} />
                <Input label={i === 0 ? 'Atas nama' : undefined} value={b.accountHolder} onChange={(e) => setV({ ...cur, bankAccounts: banks.map((x, j) => (j === i ? { ...x, accountHolder: e.target.value } : x)) })} />
                <button type="button" aria-label="Hapus rekening" onClick={() => setV({ ...cur, bankAccounts: banks.filter((_, j) => j !== i) })} className="grid size-[42px] place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setV({ ...cur, bankAccounts: [...banks, { bank: '', accountNumber: '', accountHolder: cur.name }] })}>Tambah rekening</Button>
          </div>
        </Card>
        <Card title="Logo">
          <div className="grid aspect-square place-items-center rounded-md border border-line bg-paper p-4">
            {cur.logoFileId ? <AuthImage fileId={cur.logoFileId} alt="Logo perusahaan" className="max-h-full max-w-full object-contain" /> : <span className="text-sm text-muted">Belum ada logo</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <FileUpload kind="COMPANY_LOGO" accept="image/png,image/jpeg,image/webp" label="Unggah logo" compact onUploaded={(f) => setV({ ...cur, logoFileId: f.id })} />
            {cur.logoFileId && <Button size="sm" variant="ghost" onClick={() => setV({ ...cur, logoFileId: null })}>Hapus</Button>}
          </div>
          <p className="mt-2 text-[12.5px] text-muted">PNG transparan disarankan, maks. 5 MB.</p>
        </Card>
      </div>
      <SaveBar dirty={!!v} loading={save.isPending} onSave={() => save.mutate(undefined)} onReset={() => setV(null)} />
    </>
  );
}

/* ------------------------------------------------------------ users & roles */

function UsersRoles() {
  const { activeCompanyId, user, role } = useAuth();
  const confirm = useConfirm();
  const members = useQuery({ queryKey: ['members', activeCompanyId], queryFn: () => api.get<Row[]>('/company/members') });
  const roles = useQuery({ queryKey: ['roles', activeCompanyId], queryFn: () => api.get<Row>('/company/roles') });
  const [invite, setInvite] = useState<Row | null>(null);
  const [editRole, setEditRole] = useState<string>('ADMIN');
  const [matrix, setMatrix] = useState<Record<string, string[]> | null>(null);
  const fe = useFieldErrors();
  const [link, setLink] = useState<{ link: string; email: string } | null>(null);
  const add = useAction(() => api.post<Row>('/company/members', invite), {
    success: (r) => (r.inviteLink ? 'Pengguna ditambahkan — salin tautan aktivasinya' : r.invited ? 'Undangan dikirim ke email pengguna' : 'Pengguna ditambahkan'), fieldErrors: fe,
    onSuccess: (r) => { setInvite(null); if (r.inviteLink) setLink({ link: r.inviteLink, email: r.user.email }); },
  });
  const update = useAction(({ id, patch }: { id: string; patch: Row }) => api.patch(`/company/members/${id}`, patch), { success: 'Keanggotaan diperbarui' });
  const resend = useAction(({ id, email }: { id: string; email: string }) => api.post<Row>(`/company/members/${id}/resend-invite`).then((r): Row => ({ ...r, email })), {
    success: (r) => (r.inviteLink ? 'Tautan aktivasi baru dibuat' : 'Undangan dikirim ulang'),
    onSuccess: (r) => { if (r.inviteLink) setLink({ link: r.inviteLink, email: r.email }); },
  });
  const savePerms = useAction(() => api.put(`/company/roles/${editRole}`, { permissions: (matrix ?? roles.data!.matrix)[editRole] }), { success: 'Izin role disimpan', onSuccess: () => setMatrix(null) });
  const m = matrix ?? roles.data?.matrix;
  const toggle = (p: string) => { const cur = m![editRole] as string[]; setMatrix({ ...m!, [editRole]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] }); };
  return (
    <>
      <PageHeader title="User & role" description="Undang pengguna ke perusahaan ini dan atur hak aksesnya. Izin diperiksa di server pada setiap permintaan."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setInvite({ email: '', name: '', role: 'OPERATOR' })}>Undang pengguna</Button>} />
      <div className="space-y-5">
        <Card title="Anggota perusahaan" bodyClassName="p-0">
          {members.isError ? <ErrorState error={members.error} /> : !members.data ? <div className="p-4"><Skeleton /></div> : (
            <div className="overflow-x-auto"><table className="table-base">
              <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Login terakhir</th><th /></tr></thead>
              <tbody>{members.data.map((x) => {
                const self = x.userId === user?.id;
                const ownerLocked = x.role === 'OWNER' && role !== 'OWNER';
                return (
                  <tr key={x.id}>
                    <td className="font-medium">{x.name}{self && <span className="ml-1 text-[12px] text-muted">(Anda)</span>}</td>
                    <td>{x.email}</td>
                    <td>{self || ownerLocked ? ROLE[x.role] : (
                      <select className="input h-9 w-auto py-1" value={x.role} aria-label={`Role ${x.name}`} onChange={(e) => update.mutate({ id: x.id, patch: { role: e.target.value } })}>
                        {Object.entries(ROLE).filter(([k]) => k !== 'OWNER' || role === 'OWNER').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>)}</td>
                    <td>{!x.hasPassword ? <Badge tone="warn">Menunggu aktivasi</Badge> : x.status === 'ACTIVE' ? <Badge tone="teal">Aktif</Badge> : <Badge tone="muted">Nonaktif</Badge>}</td>
                    <td className="text-[13px] text-muted">{x.lastLoginAt ? formatDateTime(x.lastLoginAt) : '—'}</td>
                    <td className="whitespace-nowrap text-right">
                      {!x.hasPassword && <button type="button" className="mr-3 inline-flex items-center gap-1 text-sm text-brand hover:underline" onClick={() => resend.mutate({ id: x.id, email: x.email })}><Mail className="size-3.5" />Kirim ulang</button>}
                      {!self && !ownerLocked && <button type="button" className={cx('text-sm hover:underline', x.status === 'ACTIVE' ? 'text-danger' : 'text-teal')} onClick={async () => {
                        if ((await confirm({ title: x.status === 'ACTIVE' ? `Nonaktifkan ${x.name}?` : `Aktifkan ${x.name}?`, message: x.status === 'ACTIVE' ? 'Pengguna tidak dapat lagi membuka data perusahaan ini.' : 'Pengguna dapat kembali mengakses perusahaan ini.', confirmLabel: x.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan', tone: x.status === 'ACTIVE' ? 'danger' : 'primary' })).ok)
                          update.mutate({ id: x.id, patch: { status: x.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } });
                      }}>{x.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Card>

        {m && roles.data && (
          <Card title="Hak akses per role" actions={<Select aria-label="Role" value={editRole} onChange={(e) => setEditRole(e.target.value)}>{roles.data.roles.map((r: Row) => <option key={r.role} value={r.role}>{r.label}</option>)}</Select>}>
            {editRole === 'OWNER' ? <p className="text-sm text-muted">Company Owner selalu memiliki semua izin agar perusahaan tidak terkunci.</p> : (
              <>
                <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(roles.data.permissions as Record<string, string>).map(([p, l]) => (
                    <Checkbox key={p} label={l} hint={p} checked={(m[editRole] as string[]).includes(p)} onChange={() => toggle(p)} />
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setMatrix({ ...m, [editRole]: roles.data!.defaults[editRole] })}>Kembalikan ke bawaan</Button>
                  <Button disabled={!matrix} loading={savePerms.isPending} onClick={() => savePerms.mutate(undefined)}>Simpan izin {ROLE[editRole]}</Button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
      <InviteLinkDialog link={link?.link ?? null} email={link?.email} onClose={() => setLink(null)} />
      <Modal open={!!invite} onClose={() => setInvite(null)} title="Undang pengguna"
        footer={<><Button variant="secondary" onClick={() => setInvite(null)}>Batal</Button><Button loading={add.isPending} onClick={() => add.mutate(undefined)}>Kirim undangan</Button></>}>
        {invite && <div className="space-y-4">
          <Input label="Email" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} error={fe.errors.email} hint="Bila email sudah terdaftar (mis. di perusahaan lain), pengguna langsung mendapat akses ke perusahaan ini." />
          <Input label="Nama" required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} error={fe.errors.name} />
          <Select label="Role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
            {Object.entries(ROLE).filter(([k]) => k !== 'OWNER' || role === 'OWNER').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>}
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- numbering */

const DOC_LABEL: Record<string, string> = {
  CUSTOMER: 'Customer', VEHICLE: 'Kendaraan', DRIVER: 'Sopir', RESERVATION: 'Reservasi', RENTAL: 'Transaksi rental', INVOICE: 'Invoice',
  CONTRACT: 'Surat perjanjian', PAYMENT: 'Kwitansi pembayaran', EXPENSE: 'Pengeluaran', INCOME: 'Pemasukan lain', MAINTENANCE: 'Perawatan',
};
const preview = (f: Row) => {
  const now = new Date();
  return String(f.pattern).replaceAll('{PREFIX}', f.prefix).replaceAll('{YYYY}', String(now.getFullYear())).replaceAll('{YY}', String(now.getFullYear()).slice(2))
    .replaceAll('{MM}', String(now.getMonth() + 1).padStart(2, '0')).replaceAll('{DD}', String(now.getDate()).padStart(2, '0')).replaceAll('{SEQ}', '1'.padStart(Number(f.pad) || 1, '0'));
};

function Numbering() {
  const { v, set, dirty, save, reset } = useSettingsEditor();
  if (!v) return <Skeleton className="h-60" />;
  const fmts = v.documentFormats;
  const upd = (k: string, patch: Row) => set({ documentFormats: { ...fmts, [k]: { ...fmts[k], ...patch } } });
  return (
    <>
      <PageHeader title="Pengaturan nomor dokumen" description="Nomor dibuat otomatis, unik per perusahaan, dan berurutan. Variabel: {PREFIX} {YYYY} {YY} {MM} {DD} {SEQ}." />
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Dokumen</th><th>Prefix</th><th>Pola</th><th>Reset nomor</th><th>Digit</th><th>Contoh</th></tr></thead>
          <tbody>{Object.keys(DOC_LABEL).map((k) => fmts[k] && (
            <tr key={k}>
              <td className="font-medium">{DOC_LABEL[k]}</td>
              <td><input className="input h-9 w-24" value={fmts[k].prefix} onChange={(e) => upd(k, { prefix: e.target.value.toUpperCase() })} aria-label={`Prefix ${DOC_LABEL[k]}`} /></td>
              <td><input className="input h-9 w-56" value={fmts[k].pattern} onChange={(e) => upd(k, { pattern: e.target.value })} aria-label={`Pola ${DOC_LABEL[k]}`} /></td>
              <td><select className="input h-9 w-auto" value={fmts[k].reset} onChange={(e) => upd(k, { reset: e.target.value })} aria-label="Reset"><option value="NEVER">Tidak pernah</option><option value="YEARLY">Tiap tahun</option><option value="MONTHLY">Tiap bulan</option></select></td>
              <td><input className="input h-9 w-16" inputMode="numeric" value={fmts[k].pad} onChange={(e) => upd(k, { pad: Math.max(1, Math.min(8, Number(e.target.value.replace(/\D/g, '')) || 1)) })} aria-label="Digit" /></td>
              <td className="num whitespace-nowrap text-brand">{preview(fmts[k])}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-muted">Perubahan hanya berlaku untuk dokumen baru. Pastikan pola berbeda antar periode reset agar nomor tetap unik (mis. pola tanpa {'{MM}'} sebaiknya tidak di-reset tiap bulan).</p>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(undefined)} onReset={reset} />
    </>
  );
}

/* ------------------------------------------------------------- print templates */

function PrintTemplates() {
  const { v, set, dirty, save, reset } = useSettingsEditor();
  if (!v) return <Skeleton className="h-60" />;
  const p = v.print;
  const upd = (patch: Partial<SettingsT['print']>) => set({ print: { ...p, ...patch } });
  return (
    <>
      <PageHeader title="Template cetak" description="Teks yang muncul pada invoice, kwitansi, dan surat perjanjian. Logo dan identitas diambil dari Profil Perusahaan." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Surat perjanjian sewa">
          <Textarea label="Ketentuan sewa (satu poin per baris)" rows={10} value={p.rentalTerms} onChange={(e) => upd({ rentalTerms: e.target.value })} />
        </Card>
        <Card title="Invoice & kwitansi">
          <div className="space-y-4">
            <Textarea label="Catatan invoice" rows={3} value={p.invoiceNotes} onChange={(e) => upd({ invoiceNotes: e.target.value })} />
            <Textarea label="Catatan kwitansi" rows={2} value={p.receiptNotes} onChange={(e) => upd({ receiptNotes: e.target.value })} />
            <Input label="Teks footer" value={p.footerText} onChange={(e) => upd({ footerText: e.target.value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Label tanda tangan perusahaan" value={p.signatureCompanyLabel} onChange={(e) => upd({ signatureCompanyLabel: e.target.value })} />
              <Input label="Label tanda tangan customer" value={p.signatureCustomerLabel} onChange={(e) => upd({ signatureCustomerLabel: e.target.value })} />
            </div>
            <Select label="Ukuran kwitansi" value={p.receiptSize} onChange={(e) => upd({ receiptSize: e.target.value as 'A4' | 'A5' })}><option value="A5">A5 (setengah A4)</option><option value="A4">A4</option></Select>
            <Checkbox label="Tampilkan rekening bank pada invoice" checked={p.showBankAccounts} onChange={(x) => upd({ showBankAccounts: x })} />
          </div>
        </Card>
      </div>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(undefined)} onReset={reset} />
    </>
  );
}

/* ------------------------------------------------------------ system settings */

function SystemSettings() {
  const { v, set, dirty, save, reset } = useSettingsEditor();
  const { activeCompanyId } = useAuth();
  const accounts = useQuery({ queryKey: ['cash-accounts', activeCompanyId], queryFn: () => api.get<Row[]>('/cash-accounts') });
  const cats = useQuery({ queryKey: ['expense-categories', activeCompanyId], queryFn: () => api.get<Row[]>('/expense-categories') });
  const [acc, setAcc] = useState<Row | null>(null);
  const [cat, setCat] = useState<Row | null>(null);
  const saveAcc = useAction(() => (acc!.id ? api.put(`/cash-accounts/${acc!.id}`, acc) : api.post('/cash-accounts', acc)), { success: 'Akun kas disimpan', onSuccess: () => setAcc(null) });
  const saveCat = useAction(() => (cat!.id ? api.put(`/expense-categories/${cat!.id}`, { name: cat!.name, isActive: cat!.isActive }) : api.post('/expense-categories', cat)), { success: 'Kategori disimpan', onSuccess: () => setCat(null) });
  if (!v) return <Skeleton className="h-60" />;
  return (
    <>
      <PageHeader title="Pengaturan sistem" description="Aturan perhitungan, metode pembayaran, akun kas, dan kategori pengeluaran." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Perhitungan & tagihan">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Pajak (%)" inputMode="decimal" value={v.taxPercent} onChange={(e) => set({ taxPercent: e.target.value.replace(',', '.').replace(/[^\d.]/g, '') })} hint="0 bila tidak memungut pajak" />
            <Select label="Pembulatan nominal" value={String(v.moneyDecimals)} onChange={(e) => set({ moneyDecimals: Number(e.target.value) as 0 | 2 })}><option value="0">Rupiah penuh (tanpa desimal)</option><option value="2">2 angka desimal</option></Select>
            <Input label="Toleransi keterlambatan (menit)" inputMode="numeric" value={String(v.graceMinutes)} onChange={(e) => set({ graceMinutes: Number(e.target.value.replace(/\D/g, '')) || 0 })} hint="Juga dipakai saat menghitung durasi sewa" />
            <Select label="Denda keterlambatan" value={v.lateFeeMode} onChange={(e) => set({ lateFeeMode: e.target.value as 'PER_DAY' | 'PER_HOUR' })}><option value="PER_DAY">Per hari (tarif harian)</option><option value="PER_HOUR">Per jam</option></Select>
            {v.lateFeeMode === 'PER_HOUR' && <MoneyInput label="Denda per jam" value={String(v.lateFeePerHour).replace(/\.00$/, '')} onChange={(x) => set({ lateFeePerHour: x })} />}
            <div className="sm:col-span-2 space-y-1">
              <Checkbox label="Transaksi hanya bisa diselesaikan bila lunas" checked={v.requireFullPaymentToComplete} onChange={(x) => set({ requireFullPaymentToComplete: x })} hint="Bila dimatikan, transaksi bisa diselesaikan dengan sisa piutang" />
              <Checkbox label="Reservasi draft ikut mengunci jadwal kendaraan" checked={v.reservationBlocksDraft} onChange={(x) => set({ reservationBlocksDraft: x })} />
            </div>
          </div>
        </Card>
        <Card title="Metode pembayaran">
          <div className="space-y-2">
            {v.paymentMethods.map((m, i) => (
              <div key={i} className="grid grid-cols-[110px_1fr_auto] items-center gap-2">
                <input className="input h-9" value={m.code} aria-label="Kode" onChange={(e) => set({ paymentMethods: v.paymentMethods.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') } : x)) })} />
                <input className="input h-9" value={m.label} aria-label="Nama" onChange={(e) => set({ paymentMethods: v.paymentMethods.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <button type="button" aria-label="Hapus metode" disabled={v.paymentMethods.length <= 1} onClick={() => set({ paymentMethods: v.paymentMethods.filter((_, j) => j !== i) })} className="grid size-9 place-items-center rounded-md text-muted hover:text-danger disabled:opacity-30"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set({ paymentMethods: [...v.paymentMethods, { code: 'BARU', label: 'Metode baru' }] })}>Tambah metode</Button>
          </div>
        </Card>
        <Card title="Akun kas & rekening" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAcc({ name: '', type: 'BANK', bankName: '', accountNumber: '', accountHolder: '', openingBalance: '0', isActive: true })}>Tambah</Button>} bodyClassName="p-0">
          <table className="table-base"><tbody>{accounts.data?.map((a) => (
            <tr key={a.id}><td className="font-medium">{a.name}<span className="block text-[12px] text-muted">{a.type === 'CASH' ? 'Kas' : a.type === 'BANK' ? `${a.bankName ?? 'Bank'} ${a.accountNumber ?? ''}` : 'E-wallet / QRIS'}</span></td>
              <td>{a.isActive ? <Badge tone="teal">Aktif</Badge> : <Badge tone="muted">Nonaktif</Badge>}</td>
              <td className="text-right"><button type="button" className="text-sm text-brand hover:underline" onClick={() => setAcc({ ...a, openingBalance: String(a.openingBalance).replace(/\.00$/, '') })}>Ubah</button></td></tr>
          ))}</tbody></table>
        </Card>
        <Card title="Kategori pengeluaran" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCat({ code: '', name: '', isActive: true })}>Tambah</Button>} bodyClassName="p-0">
          <table className="table-base"><tbody>{cats.data?.map((c) => (
            <tr key={c.id}><td>{c.name}<span className="block text-[12px] text-muted">{c.code}</span></td><td>{c.isActive ? <Badge tone="teal">Aktif</Badge> : <Badge tone="muted">Nonaktif</Badge>}</td>
              <td className="text-right"><button type="button" className="text-sm text-brand hover:underline" onClick={() => setCat(c)}>Ubah</button></td></tr>
          ))}</tbody></table>
        </Card>
      </div>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(undefined)} onReset={reset} />
      <Modal open={!!acc} onClose={() => setAcc(null)} title={acc?.id ? 'Ubah akun kas' : 'Tambah akun kas'} footer={<><Button variant="secondary" onClick={() => setAcc(null)}>Batal</Button><Button loading={saveAcc.isPending} onClick={() => saveAcc.mutate(undefined)}>Simpan</Button></>}>
        {acc && <div className="grid gap-4 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Nama akun" required value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} />
          <Select label="Jenis" value={acc.type} onChange={(e) => setAcc({ ...acc, type: e.target.value })}><option value="CASH">Kas tunai</option><option value="BANK">Rekening bank</option><option value="EWALLET">E-wallet / QRIS</option></Select>
          <Input label="Bank" value={acc.bankName ?? ''} onChange={(e) => setAcc({ ...acc, bankName: e.target.value })} />
          <Input label="No. rekening" value={acc.accountNumber ?? ''} onChange={(e) => setAcc({ ...acc, accountNumber: e.target.value })} />
          <Input label="Atas nama" value={acc.accountHolder ?? ''} onChange={(e) => setAcc({ ...acc, accountHolder: e.target.value })} />
          <MoneyInput label="Saldo awal" value={acc.openingBalance} onChange={(x) => setAcc({ ...acc, openingBalance: x })} />
          <div className="flex items-end"><Checkbox label="Aktif" checked={acc.isActive} onChange={(x) => setAcc({ ...acc, isActive: x })} /></div>
        </div>}
      </Modal>
      <Modal open={!!cat} onClose={() => setCat(null)} title={cat?.id ? 'Ubah kategori' : 'Tambah kategori'} footer={<><Button variant="secondary" onClick={() => setCat(null)}>Batal</Button><Button loading={saveCat.isPending} onClick={() => saveCat.mutate(undefined)}>Simpan</Button></>}>
        {cat && <div className="space-y-4">
          {!cat.id && <Input label="Kode" required value={cat.code} onChange={(e) => setCat({ ...cat, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} hint="Huruf besar, angka, garis bawah" />}
          <Input label="Nama kategori" required value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
          <Checkbox label="Aktif" checked={cat.isActive} onChange={(x) => setCat({ ...cat, isActive: x })} />
        </div>}
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- audit log */

function AuditLog() {
  const state = useListState();
  const list = useList<Row>('/audit-logs', state);
  const [detail, setDetail] = useState<Row | null>(null);
  const cols: Column<Row>[] = [
    { key: 'createdAt', header: 'Waktu', render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    { key: 'user', header: 'Pengguna', render: (r) => r.userName ?? <span className="text-muted">Sistem</span> },
    { key: 'action', header: 'Aksi', render: (r) => <code className="rounded bg-paper px-1.5 py-0.5 text-[12px]">{r.action}</code> },
    { key: 'summary', header: 'Keterangan', className: 'wrap', render: (r) => r.summary ?? '—' },
    { key: 'ip', header: 'IP', hideBelow: 'lg', render: (r) => <span className="text-[12.5px] text-muted">{r.ip ?? '—'}</span> },
  ];
  return (
    <>
      <PageHeader title="Audit log" description="Catatan permanen atas login, perubahan tarif, transaksi, pembayaran, pembatalan, impor, dan pengaturan akses. Tidak dapat diubah atau dihapus." />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={state.search} onChange={state.setSearch} placeholder="Cari keterangan atau aksi…" />
          <select className="input w-auto" value={state.get('action')} onChange={(e) => state.set({ action: e.target.value })} aria-label="Jenis aksi">
            <option value="">Semua aksi</option>
            {[['payment', 'Pembayaran'], ['rental', 'Transaksi'], ['reservation', 'Reservasi'], ['rate', 'Tarif'], ['expense', 'Pengeluaran'], ['import', 'Impor'], ['membership', 'Akses pengguna'], ['role', 'Izin role'], ['settings', 'Pengaturan'], ['customer', 'Customer'], ['vehicle', 'Kendaraan'], ['maintenance', 'Perawatan'], ['report', 'Ekspor laporan']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input type="date" className="input w-auto" value={state.get('from')} onChange={(e) => state.set({ from: e.target.value })} aria-label="Dari" />
          <input type="date" className="input w-auto" value={state.get('to')} onChange={(e) => state.set({ to: e.target.value })} aria-label="Sampai" />
        </div>
        <DataTable columns={cols} query={list} state={state} onRowClick={setDetail} empty={<EmptyState title="Belum ada catatan" />} />
      </div>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.action ?? ''} size="lg">
        {detail && <div className="space-y-3 text-sm">
          <p>{detail.summary}</p>
          <p className="text-muted">{formatDateTime(detail.createdAt)} · {detail.userName ?? 'Sistem'} ({detail.userEmail ?? '—'}) · {detail.ip}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div><p className="mb-1 font-medium">Sebelum</p><pre className="max-h-80 overflow-auto rounded-md bg-paper p-3 text-[12px]">{JSON.stringify(detail.before, null, 2) ?? '—'}</pre></div>
            <div><p className="mb-1 font-medium">Sesudah</p><pre className="max-h-80 overflow-auto rounded-md bg-paper p-3 text-[12px]">{JSON.stringify(detail.after, null, 2) ?? '—'}</pre></div>
          </div>
        </div>}
      </Modal>
    </>
  );
}
