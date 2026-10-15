import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { addDays, formatDate, formatDateTime, formatMoney, formatTime, startOfMonth, todayLocal } from '../lib/format';
import { PAYMENT_KIND, RENTAL_STATUS, RESERVATION_STATUS } from '../lib/labels';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Stat, StatusBadge, cx } from '../components/ui';
import { BarChart, RankBars } from '../components/Charts';
import { Plate } from '../components/inputs';

type Preset = 'month' | 'last7' | 'last30' | 'lastMonth' | 'year' | 'custom';

function rangeOf(p: Preset, custom: { from: string; to: string }) {
  const t = todayLocal();
  switch (p) {
    case 'last7': return { from: addDays(t, -6), to: t };
    case 'last30': return { from: addDays(t, -29), to: t };
    case 'lastMonth': { const end = addDays(startOfMonth(t), -1); return { from: startOfMonth(end), to: end }; }
    case 'year': return { from: `${t.slice(0, 4)}-01-01`, to: t };
    case 'custom': return custom;
    default: return { from: startOfMonth(t), to: t };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const monthLabel = (l: string) => `${MONTHS[Number(l.slice(5, 7)) - 1]} ${l.slice(2, 4)}`;
const dayLabel = (l: string) => (l.length === 7 ? monthLabel(l) : `${Number(l.slice(8, 10))} ${MONTHS[Number(l.slice(5, 7)) - 1]}`);

export default function Dashboard() {
  const { activeCompanyId, can, company } = useAuth();
  const navigate = useNavigate();
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState({ from: startOfMonth(), to: todayLocal() });
  const range = rangeOf(preset, custom);
  const q = useQuery({ queryKey: ['dashboard', activeCompanyId, range], queryFn: () => api.get<Row>('/dashboard', range) });
  const d = q.data;
  const go = (path: string) => () => navigate(path);
  const period = `from=${range.from}&to=${range.to}`;

  return (
    <>
      <PageHeader title="Dashboard" description={company?.name}
        actions={<>
          <select className="input h-[42px] w-auto" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label="Periode">
            <option value="month">Bulan ini</option><option value="last7">7 hari terakhir</option><option value="last30">30 hari terakhir</option>
            <option value="lastMonth">Bulan lalu</option><option value="year">Tahun ini</option><option value="custom">Rentang tanggal…</option>
          </select>
          {preset === 'custom' && <>
            <input type="date" className="input h-[42px] w-auto" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="Dari tanggal" />
            <input type="date" className="input h-[42px] w-auto" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Sampai tanggal" />
          </>}
          {can('rental.manage') && <Button icon={<Plus className="size-4" />} onClick={go('/rentals/new')}>Transaksi baru</Button>}
        </>} />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-5">
          {/* fleet */}
          <section aria-label="Status armada" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {!d ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="card space-y-2 p-4"><Skeleton className="w-1/2" /><Skeleton className="h-6 w-1/3" /></div>) : <>
              <Stat label="Total kendaraan" value={d.fleet.total} onClick={go('/vehicles')} />
              <Stat label="Tersedia" value={d.fleet.available} tone="teal" onClick={go('/vehicles?status=AVAILABLE')} />
              <Stat label="Sedang disewa" value={d.fleet.rented} tone="warn" onClick={go('/vehicles?status=RENTED')} sub={d.fleet.booked ? `${d.fleet.booked} dipesan` : undefined} />
              <Stat label="Dalam perawatan" value={d.fleet.maintenance} onClick={go('/vehicles?status=MAINTENANCE')} />
              <Stat label="Terlambat kembali" value={d.fleet.overdue} tone={d.fleet.overdue ? 'danger' : undefined} onClick={go('/returns?overdue=true')} icon={d.fleet.overdue ? <AlertTriangle className="size-3.5 text-danger" /> : undefined} />
              <Stat label="Transaksi periode ini" value={d.rentalCount} onClick={go(`/rentals?${period}`)} />
            </>}
          </section>

          {/* money */}
          {d?.money && (
            <section aria-label="Ringkasan keuangan" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Pendapatan rental" value={formatMoney(d.money.revenue)} sub="diakui pada tanggal mulai sewa" onClick={go(`/reports/pendapatan?${period}`)} />
              <Stat label="Uang diterima" value={formatMoney(d.money.cashIn)} sub="pembayaran masuk (neto)" tone="teal" onClick={go(`/payments?${period}`)} />
              <Stat label="Piutang customer" value={formatMoney(d.money.receivable)} sub="posisi saat ini" tone={Number(d.money.receivable) > 0 ? 'warn' : undefined} onClick={go('/receivables')} />
              <Stat label="Pengeluaran operasional" value={formatMoney(d.money.expenses)} onClick={go(`/expenses?${period}`)} />
              <Stat label="Laba operasional" value={formatMoney(d.money.profit)} sub="pendapatan − pengeluaran" tone={Number(d.money.profit) < 0 ? 'danger' : 'teal'} onClick={go(`/reports/pendapatan?report=summary&${period}`)} />
            </section>
          )}

          {/* schedule today */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card title="Jadwal pengambilan hari ini" actions={<Link to="/handovers" className="text-sm text-brand hover:underline">Serah terima</Link>} bodyClassName="p-0">
              <ScheduleList rows={d?.pickups} loading={!d} empty="Tidak ada pengambilan kendaraan hari ini." kind="pickup" />
            </Card>
            <Card title="Jadwal pengembalian" actions={<Link to="/returns" className="text-sm text-brand hover:underline">Pengembalian</Link>} bodyClassName="p-0">
              <ScheduleList rows={d?.returns} loading={!d} empty="Tidak ada kendaraan yang dijadwalkan kembali hari ini atau besok." kind="return" />
            </Card>
          </div>

          {d?.revenueSeries && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Card title={d.revenueSeries.bucket === 'day' ? 'Pendapatan & pengeluaran harian' : 'Pendapatan & pengeluaran bulanan'}>
                <BarChart data={d.revenueSeries.points} labelFormat={dayLabel} series={[
                  { key: 'revenue', label: 'Pendapatan rental', color: '#1f4e8c' },
                  { key: 'cashIn', label: 'Uang diterima', color: '#0e8c82' },
                  { key: 'expenses', label: 'Pengeluaran', color: '#c9a06a' },
                ]} />
              </Card>
              <Card title="12 bulan terakhir">
                <BarChart data={d.monthly} labelFormat={monthLabel} series={[{ key: 'revenue', label: 'Pendapatan', color: '#1f4e8c' }, { key: 'expenses', label: 'Pengeluaran', color: '#c9a06a' }]} />
              </Card>
            </div>
          )}

          {d?.byVehicle && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card title="Pendapatan per kendaraan" actions={<Link to={`/reports/kendaraan?${period}`} className="text-sm text-brand hover:underline">Laporan</Link>}>
                {d.byVehicle.length ? <RankBars rows={d.byVehicle} labelKey="plateNumber" subKey="name" /> : <EmptyState title="Belum ada pendapatan pada periode ini" />}
              </Card>
              <Card title="Pendapatan per customer" actions={<Link to={`/reports/pendapatan?report=revenue-by-customer&${period}`} className="text-sm text-brand hover:underline">Laporan</Link>}>
                {d.byCustomer.length ? <RankBars rows={d.byCustomer} labelKey="name" /> : <EmptyState title="Belum ada pendapatan pada periode ini" />}
              </Card>
            </div>
          )}

          <Card title="Aktivitas terbaru" bodyClassName="p-0">
            {!d ? <div className="space-y-3 p-4"><Skeleton /><Skeleton /><Skeleton /></div> : d.recent.length === 0 ? <EmptyState title="Belum ada aktivitas" /> : (
              <ul className="divide-y divide-line">
                {d.recent.map((r: Row) => (
                  <li key={r.type + r.id}>
                    <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-paper"
                      onClick={() => navigate(r.type === 'RENTAL' ? `/rentals/${r.id}` : r.type === 'RESERVATION' ? `/reservations/${r.id}` : `/payments?q=${encodeURIComponent(r.number)}`)}>
                      <span className="w-24 shrink-0 text-[12.5px] text-muted">{r.type === 'RENTAL' ? 'Transaksi' : r.type === 'RESERVATION' ? 'Reservasi' : 'Pembayaran'}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.number} — {r.label}</span><span className="text-[12.5px] text-muted">{formatDateTime(r.at)}</span></span>
                      {r.amount != null && <span className={cx('num hidden text-sm sm:block', Number(r.amount) < 0 && 'text-danger')}>{formatMoney(r.amount)}</span>}
                      <StatusBadge map={r.type === 'RENTAL' ? RENTAL_STATUS : r.type === 'RESERVATION' ? RESERVATION_STATUS : PAYMENT_KIND} value={r.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function ScheduleList({ rows, loading, empty, kind }: { rows?: Row[]; loading: boolean; empty: string; kind: 'pickup' | 'return' }) {
  const navigate = useNavigate();
  if (loading) return <div className="space-y-3 p-4"><Skeleton /><Skeleton /></div>;
  if (!rows?.length) return <p className="px-4 py-6 text-sm text-muted">{empty}</p>;
  const today = todayLocal();
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => navigate(r.type === 'RESERVATION' ? `/reservations/${r.id}` : `/rentals/${r.id}`)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper">
            <span className={cx('num w-14 shrink-0 text-[15px] font-semibold', r.overdue ? 'text-danger' : 'text-ink')}>{formatTime(r.at)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2"><Plate size="sm">{r.plateNumber}</Plate><span className="truncate text-sm font-medium">{r.customerName}</span></span>
              <span className="mt-0.5 block truncate text-[12.5px] text-muted">{r.number}{r.location ? ` · ${r.location}` : ''}{formatDate(r.at) !== formatDate(today) && ` · ${formatDate(r.at)}`}</span>
            </span>
            {kind === 'return' && r.overdue && <span className="text-[12.5px] font-medium text-danger">Terlambat</span>}
            {kind === 'pickup' && r.type === 'RESERVATION' && <StatusBadge map={RESERVATION_STATUS} value={r.status} />}
          </button>
        </li>
      ))}
    </ul>
  );
}
