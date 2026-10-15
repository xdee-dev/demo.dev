import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { addDays, formatDateTime, fromLocalInput, todayLocal, zoned } from '../lib/format';
import { MAINTENANCE_STATUS, RENTAL_STATUS, RESERVATION_STATUS } from '../lib/labels';
import { Button, ErrorState, PageHeader, Skeleton, Tabs, cx } from '../components/ui';
import { Plate } from '../components/inputs';

type View = 'day' | 'week' | 'month';
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function rangeFor(view: View, anchor: string) {
  if (view === 'day') return { start: anchor, days: 1 };
  if (view === 'week') {
    const dow = new Date(`${anchor}T00:00:00Z`).getUTCDay();
    return { start: addDays(anchor, -((dow + 6) % 7)), days: 7 };
  }
  const first = `${anchor.slice(0, 8)}01`;
  const next = new Date(`${first}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  return { start: first, days: Math.round((next.getTime() - new Date(`${first}T00:00:00Z`).getTime()) / 86400_000) };
}

function eventStyle(e: Row) {
  if (e.sourceType === 'MAINTENANCE') return 'bg-[repeating-linear-gradient(135deg,#fbe9e3_0_6px,#f6d5c9_6px_12px)] text-danger ring-1 ring-danger/30';
  if (e.overdue) return 'bg-danger text-white';
  if (e.sourceType === 'RENTAL') {
    if (e.status === 'ONGOING') return 'bg-teal text-white';
    if (e.status === 'SCHEDULED') return 'bg-brand text-white';
    return 'bg-ink/15 text-ink-2';
  }
  if (e.status === 'DRAFT') return 'border border-dashed border-muted bg-white text-muted';
  if (e.status === 'PENDING') return 'bg-warn-soft text-warn ring-1 ring-warn/40';
  return 'bg-brand-soft text-brand ring-1 ring-brand/40';
}

export default function CalendarPage() {
  const { activeCompanyId, can } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(todayLocal());
  const vehicleFilter = params.get('vehicleId') ?? undefined;
  const { start, days } = rangeFor(view, anchor);
  const fromDate = fromLocalInput(`${start}T00:00`)!;
  const toDate = fromLocalInput(`${addDays(start, days)}T00:00`)!;
  const span = toDate.getTime() - fromDate.getTime();
  const q = useQuery({
    queryKey: ['calendar', activeCompanyId, fromDate.toISOString(), toDate.toISOString(), vehicleFilter],
    queryFn: () => api.get<{ events: Row[]; vehicles: Row[] }>('/calendar', { from: fromDate.toISOString(), to: toDate.toISOString(), vehicleId: vehicleFilter }),
  });
  const byVehicle = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const e of q.data?.events ?? []) { if (!m.has(e.vehicleId)) m.set(e.vehicleId, []); m.get(e.vehicleId)!.push(e); }
    return m;
  }, [q.data]);

  const step = (dir: number) => setAnchor(view === 'day' ? addDays(anchor, dir) : view === 'week' ? addDays(anchor, dir * 7) : (() => {
    const d = new Date(`${anchor.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + dir); return d.toISOString().slice(0, 10);
  })());
  const cols = view === 'day' ? 24 : days;
  const colW = view === 'day' ? 44 : view === 'week' ? 120 : 38;
  const today = todayLocal();
  const nowPct = ((Date.now() - fromDate.getTime()) / span) * 100;
  const title = view === 'day' ? `${DAYS[new Date(`${start}T00:00:00Z`).getUTCDay()]}, ${Number(start.slice(8))} ${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`
    : view === 'week' ? `${Number(start.slice(8))} ${MONTHS[Number(start.slice(5, 7)) - 1].slice(0, 3)} – ${Number(addDays(start, 6).slice(8))} ${MONTHS[Number(addDays(start, 6).slice(5, 7)) - 1].slice(0, 3)} ${addDays(start, 6).slice(0, 4)}`
    : `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;

  const clickEmpty = (vehicleId: string, colIdx: number) => {
    if (!can('reservation.manage')) return;
    const s = view === 'day' ? fromLocalInput(`${start}T${String(colIdx).padStart(2, '0')}:00`)! : fromLocalInput(`${addDays(start, colIdx)}T09:00`)!;
    const e = new Date(s.getTime() + 86400_000);
    navigate(`/reservations/new?vehicleId=${vehicleId}&start=${encodeURIComponent(s.toISOString())}&end=${encodeURIComponent(e.toISOString())}`);
  };
  const openEvent = (e: Row) => navigate(e.sourceType === 'RENTAL' ? `/rentals/${e.sourceId}` : e.sourceType === 'RESERVATION' ? `/reservations/${e.sourceId}` : '/maintenance');

  return (
    <>
      <PageHeader title="Kalender rental" description="Jadwal setiap kendaraan: reservasi, transaksi, dan perawatan. Klik slot kosong untuk membuat reservasi."
        actions={can('reservation.manage') && <Button icon={<Plus className="size-4" />} onClick={() => navigate('/reservations/new')}>Reservasi baru</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 pt-2">
          <div className="flex items-center gap-1 pb-2">
            <button type="button" aria-label="Sebelumnya" onClick={() => step(-1)} className="grid size-9 place-items-center rounded-md hover:bg-ink/5"><ChevronLeft className="size-5" /></button>
            <button type="button" aria-label="Berikutnya" onClick={() => step(1)} className="grid size-9 place-items-center rounded-md hover:bg-ink/5"><ChevronRight className="size-5" /></button>
            <Button size="sm" variant="secondary" onClick={() => setAnchor(todayLocal())}>Hari ini</Button>
            <h2 className="ml-2 text-[15px] font-semibold">{title}</h2>
          </div>
          <div className="ml-auto"><Tabs value={view} onChange={setView} tabs={[{ value: 'day', label: 'Harian' }, { value: 'week', label: 'Mingguan' }, { value: 'month', label: 'Bulanan' }]} /></div>
        </div>
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div> : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: 168 + cols * colW }}>
              {/* header */}
              <div className="sticky top-0 z-10 flex border-b border-line bg-white">
                <div className="sticky left-0 z-10 w-[168px] shrink-0 border-r border-line bg-white px-3 py-2 text-[12.5px] font-medium text-muted">Kendaraan</div>
                <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
                  {Array.from({ length: cols }).map((_, i) => {
                    const d = addDays(start, view === 'day' ? 0 : i);
                    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                    const isToday = view !== 'day' && d === today;
                    return (
                      <div key={i} className={cx('border-r border-line/60 px-1 py-1.5 text-center text-[11.5px]', (dow === 0 && view !== 'day') && 'bg-paper', isToday && 'bg-brand-soft font-semibold text-brand')}>
                        {view === 'day' ? `${String(i).padStart(2, '0')}` : view === 'week' ? <><span className="block text-muted">{DAYS[dow]}</span>{Number(d.slice(8))}</> : <><span className="block text-[10px] text-muted">{DAYS[dow].slice(0, 2)}</span>{Number(d.slice(8))}</>}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* rows */}
              {q.data.vehicles.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">Belum ada kendaraan.</p>}
              {q.data.vehicles.map((v) => (
                <div key={v.id} className="flex border-b border-line/70">
                  <button type="button" onClick={() => navigate(`/vehicles/${v.id}`)} className="sticky left-0 z-[5] w-[168px] shrink-0 border-r border-line bg-white px-3 py-2 text-left hover:bg-paper">
                    <Plate size="sm">{v.plateNumber}</Plate>
                    <span className="mt-0.5 block truncate text-[12px] text-muted">{v.name}</span>
                  </button>
                  <div className="relative flex-1">
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
                      {Array.from({ length: cols }).map((_, i) => {
                        const d = addDays(start, view === 'day' ? 0 : i);
                        const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                        return <button type="button" key={i} tabIndex={-1} aria-hidden onClick={() => clickEmpty(v.id, i)}
                          className={cx('border-r border-line/50 hover:bg-brand-soft/40', dow === 0 && view !== 'day' && 'bg-paper/60', !can('reservation.manage') && 'cursor-default')} />;
                      })}
                    </div>
                    {nowPct >= 0 && nowPct <= 100 && <div className="pointer-events-none absolute inset-y-0 z-[3] w-px bg-danger" style={{ left: `${nowPct}%` }} />}
                    <div className="pointer-events-none relative z-[4] min-h-[52px] py-1.5">
                      {(byVehicle.get(v.id) ?? []).map((e, idx) => {
                        const s = Math.max(new Date(e.startAt).getTime(), fromDate.getTime());
                        const en = Math.min(Math.max(e.endAt ? new Date(e.endAt).getTime() : toDate.getTime(), e.overdue ? Date.now() : 0), toDate.getTime()); // overdue: still out until now
                        const left = ((s - fromDate.getTime()) / span) * 100;
                        const width = Math.max(((en - s) / span) * 100, 0.8);
                        const statusMap = e.sourceType === 'RENTAL' ? RENTAL_STATUS : e.sourceType === 'RESERVATION' ? RESERVATION_STATUS : MAINTENANCE_STATUS;
                        return (
                          <button key={e.sourceId + idx} type="button" onClick={() => openEvent(e)}
                            title={`${e.number} — ${e.title}\n${formatDateTime(e.startAt)} – ${e.endAt ? formatDateTime(e.endAt) : 'belum ditentukan'}\n${statusMap[e.status]?.[0] ?? e.status}${e.overdue ? ' (terlambat)' : ''}`}
                            className={cx('pointer-events-auto absolute h-[19px] overflow-hidden rounded-[4px] px-1.5 text-left text-[11.5px] leading-[19px] whitespace-nowrap', eventStyle(e))}
                            style={{ left: `${left}%`, width: `${width}%`, top: 6 + (idx % 2) * 21 }}>
                            {e.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-[12.5px] text-muted">
          {[['bg-brand', 'Transaksi terjadwal'], ['bg-teal', 'Sedang disewa'], ['bg-danger', 'Terlambat kembali'], ['bg-brand-soft ring-1 ring-brand/40', 'Reservasi dikonfirmasi'], ['bg-warn-soft ring-1 ring-warn/40', 'Menunggu konfirmasi'], ['border border-dashed border-muted', 'Draft (tidak mengunci)'], ['bg-[repeating-linear-gradient(135deg,#fbe9e3_0_4px,#f6d5c9_4px_8px)] ring-1 ring-danger/30', 'Perawatan'], ['bg-ink/15', 'Selesai']].map(([c, l]) => (
            <span key={l} className="inline-flex items-center gap-1.5"><span className={cx('inline-block h-3 w-5 rounded-sm', c)} />{l}</span>
          ))}
        </div>
      </div>
    </>
  );
}

export { zoned };
