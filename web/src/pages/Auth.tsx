import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Building2, ChevronRight, LogOut } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE } from '../lib/labels';
import { Button, Input, Spinner, Field } from '../components/ui';
import { Plate } from '../components/inputs';

function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-10" />
          <span className="text-[17px] font-semibold">Rental Management System</span>
        </div>
        <div className="max-w-md">
          <p className="text-[28px] font-semibold leading-tight tracking-[-0.015em]">Armada, jadwal, dan kas perusahaan rental Anda dalam satu tempat.</p>
          <p className="mt-4 text-[15px] leading-relaxed text-white/65">Setiap perusahaan bekerja di ruang datanya sendiri. Jadwal kendaraan dijaga agar tidak pernah bentrok, dan setiap rupiah tercatat dengan jejak audit.</p>
          <div className="mt-10 flex flex-wrap gap-2.5 opacity-90">
            {['B 1234 RNA', 'D 2201 KJ', 'L 88 TRX', 'H 1001 MP', 'AB 512 YG'].map((p) => <Plate key={p}>{p}</Plate>)}
          </div>
        </div>
        <p className="text-[12.5px] text-white/40">© {new Date().getFullYear()} Rental Management System</p>
      </aside>
      <main className="flex items-center justify-center bg-paper px-5 py-10 lg:bg-white">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden"><img src="/icon.svg" alt="" className="size-9" /><span className="font-semibold">Rental Management System</span></div>
          <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[14.5px] text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}

function PasswordInput({ label, value, onChange, autoComplete, error, hint }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; error?: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} htmlFor={`pw-${autoComplete}`}>
      <div className="relative">
        <input id={`pw-${autoComplete}`} type={show ? 'text' : 'password'} className="input pr-11" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required aria-invalid={!!error} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
          className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink">
          {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      </div>
    </Field>
  );
}

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!loading && user) return <Navigate to={loc.state?.from ?? '/'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email, password); navigate(loc.state?.from ?? '/', { replace: true }); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Tidak dapat terhubung ke server'); }
    finally { setBusy(false); }
  };
  return (
    <AuthShell title="Masuk" subtitle="Gunakan email dan password akun Anda.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</div>}
        <Input label="Email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="flex justify-end"><Link to="/forgot-password" className="text-sm text-brand hover:underline">Lupa password?</Link></div>
        <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>Masuk</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <AuthShell title="Lupa password" subtitle="Kami akan mengirim tautan untuk membuat password baru.">
      {sent ? (
        <div className="space-y-4">
          <div className="rounded-md border border-teal/30 bg-teal-soft px-3 py-3 text-sm text-ink">Jika email tersebut terdaftar, tautan reset password sudah dikirim. Tautan berlaku 1 jam.</div>
          <Link to="/login" className="text-sm text-brand hover:underline">Kembali ke halaman masuk</Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError('');
          try { await api.post('/auth/forgot-password', { email }); setSent(true); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
        }}>
          {error && <div role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</div>}
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <Button type="submit" className="w-full" loading={busy} disabled={!email}>Kirim tautan reset</Button>
          <Link to="/login" className="block text-center text-sm text-brand hover:underline">Kembali ke halaman masuk</Link>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage({ mode }: { mode: 'reset' | 'invite' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ['token-info', token], queryFn: () => api.get<{ purpose: string; email: string; name: string }>('/auth/token-info', { token }), enabled: !!token, retry: false });
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (info.data?.name) setName(info.data.name); }, [info.data]);
  const invite = mode === 'invite';
  return (
    <AuthShell title={invite ? 'Aktifkan akun' : 'Buat password baru'} subtitle={info.data ? info.data.email : undefined}>
      {!token || info.isError ? (
        <div className="space-y-4">
          <div className="rounded-md bg-danger-soft px-3 py-3 text-sm text-danger">Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.</div>
          <Link to={invite ? '/login' : '/forgot-password'} className="text-sm text-brand hover:underline">{invite ? 'Ke halaman masuk' : 'Minta tautan baru'}</Link>
        </div>
      ) : info.isLoading ? <Spinner /> : (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setError('');
          if (pw !== pw2) { setError('Konfirmasi password tidak sama'); return; }
          setBusy(true);
          try { await api.post('/auth/reset-password', { token, password: pw, ...(invite ? { name } : {}) }); navigate('/login', { replace: true }); }
          catch (err) { setError((err as Error).message); } finally { setBusy(false); }
        }}>
          {error && <div role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</div>}
          {invite && <Input label="Nama lengkap" value={name} onChange={(e) => setName(e.target.value)} required />}
          <PasswordInput label="Password baru" value={pw} onChange={setPw} autoComplete="new-password" hint="Minimal 10 karakter, mengandung huruf besar, huruf kecil, dan angka." />
          <PasswordInput label="Ulangi password" value={pw2} onChange={setPw2} autoComplete="new-password-confirm" />
          <Button type="submit" className="w-full" loading={busy} disabled={!pw || !pw2}>{invite ? 'Aktifkan akun' : 'Simpan password'}</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function SelectCompanyPage() {
  const { user, memberships, switchCompany, loading, logout, activeCompanyId } = useAuth();
  const navigate = useNavigate();
  if (loading) return <div className="flex min-h-dvh items-center justify-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (activeCompanyId) return <Navigate to="/" replace />;
  return (
    <AuthShell title="Pilih perusahaan" subtitle={`Halo, ${user.name}. Akun Anda terdaftar di ${memberships.length} perusahaan.`}>
      {memberships.length === 0 ? (
        <div className="space-y-4 text-sm text-muted">
          <p>Akun Anda belum menjadi anggota perusahaan mana pun. Minta Owner perusahaan untuk mengundang email <b className="text-ink">{user.email}</b>.</p>
          {user.isSuperAdmin && <Button onClick={() => navigate('/admin')}>Buka Super Admin</Button>}
        </div>
      ) : (
        <ul className="space-y-2">
          {memberships.map((m) => (
            <li key={m.companyId}>
              <button type="button" disabled={!m.companyActive} onClick={() => { switchCompany(m.companyId); navigate('/'); }}
                className="flex w-full items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-left hover:border-brand disabled:opacity-50">
                <Building2 className="size-5 text-brand" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.name}</span><span className="text-[12.5px] text-muted">{ROLE[m.role]}{!m.companyActive && ' · dinonaktifkan'}</span></span>
                <ChevronRight className="size-4 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={async () => { await logout(); navigate('/login'); }} className="mt-6 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><LogOut className="size-4" />Keluar</button>
    </AuthShell>
  );
}
