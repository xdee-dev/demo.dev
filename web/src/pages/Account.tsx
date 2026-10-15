import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useFieldErrors } from '../lib/hooks';
import { ROLE } from '../lib/labels';
import { Button, Card, Input, PageHeader } from '../components/ui';

export default function Account() {
  const { user, memberships, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const fe = useFieldErrors();
  const saveName = useAction(() => api.patch('/auth/profile', { name }), { success: 'Nama diperbarui', onSuccess: () => refresh() });
  const savePw = useAction(() => {
    if (pw.newPassword !== pw.confirm) return Promise.reject(new Error('Konfirmasi password tidak sama'));
    return api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
  }, { success: 'Password diganti. Sesi di perangkat lain telah dikeluarkan.', fieldErrors: fe, onSuccess: () => setPw({ currentPassword: '', newPassword: '', confirm: '' }) });
  return (
    <>
      <PageHeader title="Akun saya" description={user?.email} />
      <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
        <Card title="Profil">
          <div className="space-y-4">
            <Input label="Nama" value={name} onChange={(e) => setName(e.target.value)} />
            <Button loading={saveName.isPending} disabled={name.trim().length < 2 || name === user?.name} onClick={() => saveName.mutate(undefined)}>Simpan nama</Button>
          </div>
          <h3 className="mb-2 mt-6 text-[14px] font-semibold">Akses perusahaan</h3>
          <ul className="space-y-1 text-sm">{memberships.map((m) => <li key={m.companyId} className="flex justify-between"><span>{m.name}</span><span className="text-muted">{ROLE[m.role]}</span></li>)}</ul>
        </Card>
        <Card title="Ganti password">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); savePw.mutate(undefined); }}>
            <Input label="Password saat ini" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <Input label="Password baru" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={fe.errors.newPassword} hint="Minimal 10 karakter dengan huruf besar, huruf kecil, dan angka." />
            <Input label="Ulangi password baru" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            <Button type="submit" loading={savePw.isPending} disabled={!pw.currentPassword || !pw.newPassword}>Ganti password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
