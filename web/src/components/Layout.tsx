import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CalendarDays, ClipboardList, FileText, KeyRound, Undo2, Users, Car, Tags, UserRound, Wallet, ArrowDownToLine,
  ArrowUpFromLine, Receipt, Wrench, History, BarChart3, Building2, ShieldCheck, Hash, Printer, Settings2, ScrollText, LogOut,
  PanelLeftClose, PanelLeftOpen, Menu, X, ChevronDown, Check, UserCog, Shield,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ROLE } from '../lib/labels';
import { cx } from './ui';

interface NavItem { to: string; label: string; icon: ReactNode; perm?: string[] }
interface NavGroup { label: string | null; items: NavItem[] }

const ic = 'size-[18px] shrink-0';
export const NAV: NavGroup[] = [
  { label: null, items: [{ to: '/', label: 'Dashboard', icon: <LayoutDashboard className={ic} />, perm: ['dashboard.view'] }] },
  { label: 'Operasional', items: [
    { to: '/calendar', label: 'Kalender Rental', icon: <CalendarDays className={ic} />, perm: ['reservation.view'] },
    { to: '/reservations', label: 'Reservasi', icon: <ClipboardList className={ic} />, perm: ['reservation.view'] },
    { to: '/rentals', label: 'Transaksi Rental', icon: <FileText className={ic} />, perm: ['rental.view'] },
    { to: '/handovers', label: 'Serah Terima Kendaraan', icon: <KeyRound className={ic} />, perm: ['rental.view'] },
    { to: '/returns', label: 'Pengembalian Kendaraan', icon: <Undo2 className={ic} />, perm: ['rental.view'] },
  ] },
  { label: 'Master Data', items: [
    { to: '/customers', label: 'Customer', icon: <Users className={ic} />, perm: ['customer.view'] },
    { to: '/vehicles', label: 'Kendaraan', icon: <Car className={ic} />, perm: ['vehicle.view'] },
    { to: '/rates', label: 'Tarif Rental', icon: <Tags className={ic} />, perm: ['vehicle.view'] },
    { to: '/drivers', label: 'Sopir', icon: <UserRound className={ic} />, perm: ['driver.view'] },
  ] },
  { label: 'Keuangan', items: [
    { to: '/payments', label: 'Pembayaran', icon: <Wallet className={ic} />, perm: ['payment.view'] },
    { to: '/incomes', label: 'Pemasukan', icon: <ArrowDownToLine className={ic} />, perm: ['income.view'] },
    { to: '/expenses', label: 'Pengeluaran', icon: <ArrowUpFromLine className={ic} />, perm: ['expense.view'] },
    { to: '/receivables', label: 'Piutang', icon: <Receipt className={ic} />, perm: ['payment.view'] },
  ] },
  { label: 'Perawatan', items: [
    { to: '/maintenance/schedule', label: 'Jadwal Servis', icon: <Wrench className={ic} />, perm: ['maintenance.view'] },
    { to: '/maintenance', label: 'Riwayat Perawatan', icon: <History className={ic} />, perm: ['maintenance.view'] },
  ] },
  { label: 'Laporan', items: [
    { to: '/reports/rental', label: 'Laporan Rental', icon: <BarChart3 className={ic} />, perm: ['report.operational'] },
    { to: '/reports/pendapatan', label: 'Laporan Pendapatan', icon: <BarChart3 className={ic} />, perm: ['report.financial'] },
    { to: '/reports/pengeluaran', label: 'Laporan Pengeluaran', icon: <BarChart3 className={ic} />, perm: ['report.financial'] },
    { to: '/reports/kendaraan', label: 'Laporan per Kendaraan', icon: <BarChart3 className={ic} />, perm: ['report.financial'] },
    { to: '/reports/piutang', label: 'Laporan Piutang', icon: <BarChart3 className={ic} />, perm: ['report.financial'] },
    { to: '/reports/penggunaan', label: 'Penggunaan Kendaraan', icon: <BarChart3 className={ic} />, perm: ['report.operational'] },
  ] },
  { label: 'Pengaturan', items: [
    { to: '/settings/company', label: 'Profil Perusahaan', icon: <Building2 className={ic} />, perm: ['settings.manage'] },
    { to: '/settings/users', label: 'User & Role', icon: <ShieldCheck className={ic} />, perm: ['users.manage'] },
    { to: '/settings/numbering', label: 'Nomor Dokumen', icon: <Hash className={ic} />, perm: ['settings.manage'] },
    { to: '/settings/print', label: 'Template Cetak', icon: <Printer className={ic} />, perm: ['settings.manage'] },
    { to: '/settings/system', label: 'Pengaturan Sistem', icon: <Settings2 className={ic} />, perm: ['settings.manage'] },
    { to: '/settings/audit', label: 'Audit Log', icon: <ScrollText className={ic} />, perm: ['audit.view'] },
  ] },
];

function useCollapsed() {
  const [v, setV] = useState(() => { try { return localStorage.getItem('rms.sidebar') === '1'; } catch { return false; } });
  return [v, (x: boolean) => { setV(x); try { localStorage.setItem('rms.sidebar', x ? '1' : '0'); } catch { /* ignore */ } }] as const;
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can, user } = useAuth();
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Menu utama">
      {NAV.map((g, gi) => {
        const items = g.items.filter((i) => !i.perm || can(...i.perm));
        if (!items.length) return null;
        return (
          <div key={gi} className="mb-3">
            {g.label && !collapsed && <p className="px-3 pb-1 pt-2 text-[11.5px] font-medium text-white/45">{g.label}</p>}
            {g.label && collapsed && <div className="mx-3 my-2 border-t border-white/10" />}
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} end={i.to === '/' || i.to === '/maintenance'} onClick={onNavigate} title={collapsed ? i.label : undefined}
                    className={({ isActive }) => cx('flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors',
                      isActive ? 'bg-white/12 font-medium text-white shadow-[inset_3px_0_0_var(--color-teal)]' : 'text-white/72 hover:bg-white/6 hover:text-white',
                      collapsed && 'justify-center px-0')}>
                    {i.icon}{!collapsed && <span className="truncate">{i.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {user?.isSuperAdmin && (
        <div className="mb-3">
          {!collapsed && <p className="px-3 pb-1 pt-2 text-[11.5px] font-medium text-white/45">Platform</p>}
          <NavLink to="/admin" onClick={onNavigate} title={collapsed ? 'Super Admin' : undefined}
            className={({ isActive }) => cx('flex items-center gap-3 rounded-md px-3 py-2 text-[14px]', isActive ? 'bg-white/12 text-white' : 'text-white/72 hover:bg-white/6 hover:text-white', collapsed && 'justify-center px-0')}>
            <Shield className={ic} />{!collapsed && 'Super Admin'}
          </NavLink>
        </div>
      )}
    </nav>
  );
}

export function CompanySwitcher({ dark }: { dark?: boolean }) {
  const { memberships, activeCompanyId, switchCompany, company } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const current = memberships.find((m) => m.companyId === activeCompanyId);
  const multi = memberships.length > 1;
  return (
    <div className="relative min-w-0">
      <button type="button" disabled={!multi} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className={cx('flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left', multi && (dark ? 'hover:bg-white/8' : 'hover:bg-ink/5'))}>
        <span className={cx('grid size-8 shrink-0 place-items-center rounded-md text-[13px] font-semibold', dark ? 'bg-teal text-white' : 'bg-ink text-white')}>
          {(company?.name ?? current?.name ?? '?').replace(/^(PT|CV)\s+/i, '').slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate text-[14px] font-semibold', dark ? 'text-white' : 'text-ink')}>{current?.name ?? 'Pilih perusahaan'}</span>
          {current && <span className={cx('block truncate text-[12px]', dark ? 'text-white/55' : 'text-muted')}>{ROLE[current.role] ?? current.role}</span>}
        </span>
        {multi && <ChevronDown className={cx('size-4 shrink-0', dark ? 'text-white/60' : 'text-muted')} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <ul role="listbox" className="absolute left-0 z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-white py-1 text-ink shadow-xl">
            <li className="px-3 pb-1 pt-1.5 text-[12px] text-muted">Pindah perusahaan</li>
            {memberships.map((m) => (
              <li key={m.companyId}>
                <button type="button" role="option" aria-selected={m.companyId === activeCompanyId} disabled={!m.companyActive}
                  onClick={() => { setOpen(false); if (m.companyId !== activeCompanyId) { switchCompany(m.companyId); navigate('/'); } }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper disabled:opacity-50">
                  <Check className={cx('size-4 text-brand', m.companyId !== activeCompanyId && 'invisible')} />
                  <span className="min-w-0 flex-1"><span className="block truncate">{m.name}</span><span className="text-[12px] text-muted">{ROLE[m.role]}{!m.companyActive && ' · nonaktif'}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Menu akun" aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink/5">
        <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">{user?.name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-[160px] truncate text-sm sm:block">{user?.name}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-1 w-60 rounded-md border border-line bg-white py-1 shadow-xl">
            <div className="border-b border-line px-3 py-2"><p className="truncate text-sm font-medium">{user?.name}</p><p className="truncate text-[12.5px] text-muted">{user?.email}</p></div>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-paper" onClick={() => { setOpen(false); navigate('/account'); }}><UserCog className="size-4" />Akun saya</button>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-paper" onClick={async () => { await logout(); navigate('/login'); }}><LogOut className="size-4" />Keluar</button>
          </div>
        </>
      )}
    </div>
  );
}

const BOTTOM = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
  { to: '/calendar', label: 'Kalender', icon: CalendarDays, perm: 'reservation.view' },
  { to: '/rentals', label: 'Transaksi', icon: FileText, perm: 'rental.view' },
  { to: '/payments', label: 'Bayar', icon: Wallet, perm: 'payment.view' },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useCollapsed();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  const { can } = useAuth();
  useEffect(() => { setDrawer(false); }, [loc.pathname]);
  return (
    <div className="min-h-dvh">
      {/* desktop sidebar */}
      <aside className={cx('fixed inset-y-0 left-0 z-30 hidden flex-col bg-ink text-white transition-[width] lg:flex', collapsed ? 'w-[68px]' : 'w-64')}>
        <div className={cx('flex items-center gap-1 border-b border-white/10 p-2.5', collapsed && 'flex-col')}>
          {!collapsed ? <div className="min-w-0 flex-1"><CompanySwitcher dark /></div> : <span className="py-1 text-[13px] font-bold">RMS</span>}
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            className="grid size-9 place-items-center rounded-md text-white/60 hover:bg-white/8 hover:text-white">
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          </button>
        </div>
        <NavList collapsed={collapsed} />
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-[84vw] max-w-[320px] flex-col bg-ink text-white" aria-label="Menu">
            <div className="flex items-center gap-1 border-b border-white/10 p-2.5">
              <div className="min-w-0 flex-1"><CompanySwitcher dark /></div>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Tutup menu" className="grid size-10 place-items-center rounded-md text-white/70 hover:bg-white/8"><X className="size-5" /></button>
            </div>
            <NavList collapsed={false} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className={cx('transition-[padding]', collapsed ? 'lg:pl-[68px]' : 'lg:pl-64')}>
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-white/95 px-3 backdrop-blur sm:px-5">
          <button type="button" className="grid size-10 place-items-center rounded-md hover:bg-ink/5 lg:hidden" onClick={() => setDrawer(true)} aria-label="Buka menu"><Menu className="size-5" /></button>
          <div className="min-w-0 flex-1 lg:hidden"><CompanySwitcher /></div>
          <div className="hidden flex-1 lg:block" />
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {/* mobile bottom navigation */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Navigasi cepat">
        {BOTTOM.filter((b) => can(b.perm)).map((b) => (
          <NavLink key={b.to} to={b.to} end={b.to === '/'} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-brand' : 'text-muted')}>
            <b.icon className="size-5" />{b.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted"><Menu className="size-5" />Menu</button>
      </nav>
    </div>
  );
}
