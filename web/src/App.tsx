import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/Layout';
import { Spinner, EmptyState } from './components/ui';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage, SelectCompanyPage } from './pages/Auth';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const Reservations = lazy(() => import('./pages/Reservations'));
const Rentals = lazy(() => import('./pages/Rentals'));
const RentalForm = lazy(() => import('./pages/RentalForm'));
const RentalDetail = lazy(() => import('./pages/RentalDetail'));
const Customers = lazy(() => import('./pages/Customers'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const Rates = lazy(() => import('./pages/Rates'));
const Drivers = lazy(() => import('./pages/Drivers'));
const Finance = lazy(() => import('./pages/Finance'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const Reports = lazy(() => import('./pages/Reports'));
const ImportPage = lazy(() => import('./pages/Import'));
const Settings = lazy(() => import('./pages/settings/Settings'));
const Admin = lazy(() => import('./pages/Admin'));
const Account = lazy(() => import('./pages/Account'));
const PrintPage = lazy(() => import('./print/PrintPage'));

const Loading = () => <div className="flex min-h-[40vh] items-center justify-center"><Spinner className="size-6" /></div>;

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, activeCompanyId } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="flex min-h-dvh items-center justify-center"><Spinner className="size-6" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (!activeCompanyId && !loc.pathname.startsWith('/admin') && loc.pathname !== '/account') return <Navigate to="/select-company" replace />;
  return <>{children}</>;
}

function Guard({ perm, children }: { perm: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...perm)) return <EmptyState title="Akses ditolak" description="Role Anda tidak memiliki izin untuk membuka halaman ini. Hubungi Owner perusahaan bila Anda memerlukannya." />;
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <Dashboard />;
  return <Navigate to="/rentals" replace />;
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage mode="reset" />} />
        <Route path="/accept-invite" element={<ResetPasswordPage mode="invite" />} />
        <Route path="/select-company" element={<SelectCompanyPage />} />
        <Route path="/print/*" element={<RequireAuth><PrintPage /></RequireAuth>} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="calendar" element={<Guard perm={['reservation.view']}><CalendarPage /></Guard>} />
          <Route path="reservations/*" element={<Guard perm={['reservation.view']}><Reservations /></Guard>} />
          <Route path="rentals" element={<Guard perm={['rental.view']}><Rentals mode="all" /></Guard>} />
          <Route path="handovers" element={<Guard perm={['rental.view']}><Rentals mode="handover" /></Guard>} />
          <Route path="returns" element={<Guard perm={['rental.view']}><Rentals mode="return" /></Guard>} />
          <Route path="rentals/new" element={<Guard perm={['rental.manage']}><RentalForm /></Guard>} />
          <Route path="rentals/:id/edit" element={<Guard perm={['rental.manage']}><RentalForm /></Guard>} />
          <Route path="rentals/:id" element={<Guard perm={['rental.view']}><RentalDetail /></Guard>} />
          <Route path="customers/*" element={<Guard perm={['customer.view']}><Customers /></Guard>} />
          <Route path="vehicles/*" element={<Guard perm={['vehicle.view']}><Vehicles /></Guard>} />
          <Route path="rates" element={<Guard perm={['vehicle.view']}><Rates /></Guard>} />
          <Route path="drivers" element={<Guard perm={['driver.view']}><Drivers /></Guard>} />
          <Route path="payments" element={<Guard perm={['payment.view']}><Finance tab="payments" /></Guard>} />
          <Route path="incomes" element={<Guard perm={['income.view']}><Finance tab="incomes" /></Guard>} />
          <Route path="expenses" element={<Guard perm={['expense.view']}><Finance tab="expenses" /></Guard>} />
          <Route path="receivables" element={<Guard perm={['payment.view']}><Finance tab="receivables" /></Guard>} />
          <Route path="maintenance/schedule" element={<Guard perm={['maintenance.view']}><Maintenance tab="schedule" /></Guard>} />
          <Route path="maintenance" element={<Guard perm={['maintenance.view']}><Maintenance tab="history" /></Guard>} />
          <Route path="reports/:group" element={<Reports />} />
          <Route path="import/:entity" element={<ImportPage />} />
          <Route path="settings/:section" element={<Settings />} />
          <Route path="admin" element={<Admin />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<EmptyState title="Halaman tidak ditemukan" description="Periksa alamat atau gunakan menu di samping." />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
