import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { formatDate, startOfMonth, todayLocal } from '../lib/format';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui';
import { ReportTable } from '../components/ReportTable';
import { useToast } from '../components/Toast';

const GROUPS: Record<string, { title: string; keys: string[]; description: string }> = {
  rental: { title: 'Laporan rental', keys: ['rentals', 'vehicle-schedule', 'late-returns'], description: 'Transaksi, jadwal kendaraan, dan keterlambatan pengembalian.' },
  pendapatan: { title: 'Laporan pendapatan', keys: ['summary', 'revenue-daily', 'revenue-monthly', 'revenue-yearly', 'revenue-by-customer', 'cash-receipts'], description: 'Pendapatan diakui pada tanggal mulai sewa; penerimaan kas pada tanggal bayar.' },
  pengeluaran: { title: 'Laporan pengeluaran', keys: ['expenses', 'cost-by-vehicle'], description: 'Biaya operasional yang telah diposting.' },
  kendaraan: { title: 'Laporan per kendaraan', keys: ['revenue-by-vehicle', 'profit-by-vehicle', 'cost-by-vehicle'], description: 'Pendapatan, biaya, dan laba operasional setiap kendaraan.' },
  piutang: { title: 'Laporan piutang', keys: ['receivables'], description: 'Posisi piutang customer saat ini beserta umurnya.' },
  penggunaan: { title: 'Penggunaan kendaraan', keys: ['utilization', 'fleet-status'], description: 'Tingkat penggunaan armada dan status kendaraan saat ini.' },
};

export default function Reports() {
  const { group = 'rental' } = useParams();
  const [params, setParams] = useSearchParams();
  const { activeCompanyId, can } = useAuth();
  const toast = useToast();
  const cfg = GROUPS[group];
  const list = useQuery({ queryKey: ['reports', activeCompanyId], queryFn: () => api.get<Row[]>('/reports') });
  const available = (list.data ?? []).filter((r) => cfg?.keys.includes(r.key)).sort((a, b) => cfg.keys.indexOf(a.key) - cfg.keys.indexOf(b.key));
  const key = params.get('report') && available.some((r) => r.key === params.get('report')) ? params.get('report')! : available[0]?.key;
  const def = available.find((r) => r.key === key);
  const filters = {
    from: params.get('from') ?? startOfMonth(), to: params.get('to') ?? todayLocal(),
    customerId: params.get('customerId') ?? '', vehicleId: params.get('vehicleId') ?? '', status: params.get('status') ?? '',
  };
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setParams(n, { replace: true }); };
  const report = useQuery({ queryKey: ['report', activeCompanyId, key, filters], queryFn: () => api.get<Row>(`/reports/${key}`, filters), enabled: !!key });
  const vehicles = useQuery({ queryKey: ['rates', activeCompanyId], queryFn: () => api.get<Row[]>('/rates'), enabled: !!def?.filters.includes('vehicle') && can('vehicle.view') });
  const customers = useQuery({ queryKey: ['customers-all', activeCompanyId], queryFn: () => api.get<Row[]>('/customers/lookup'), enabled: !!def?.filters.includes('customer') && can('customer.view') });

  if (!cfg) return <EmptyState title="Laporan tidak ditemukan" />;
  if (list.data && available.length === 0) return <EmptyState title="Akses ditolak" description="Role Anda tidak memiliki izin untuk laporan ini." />;
  const exportAs = (format: 'xlsx' | 'csv') => api.download(`/reports/${key}`, { ...filters, format }).catch(toast.error);
  const printUrl = `/print/report/${key}?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()}`;
  return (
    <>
      <PageHeader title={cfg.title} description={cfg.description}
        actions={def && <>
          {can('data.export') && <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => exportAs('xlsx')}>Excel</Button>}
          {can('data.export') && <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => exportAs('csv')}>CSV</Button>}
          {can('data.export') && <a href={printUrl} target="_blank" rel="noopener"><Button variant="secondary" icon={<Printer className="size-4" />}>Cetak / PDF</Button></a>}
        </>} />
      {available.length > 1 && <Tabs value={key ?? ''} onChange={(k) => set({ report: k })} tabs={available.map((r) => ({ value: r.key, label: r.title }))} />}
      <div className="card">
        {def && (
          <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
            {def.filters.includes('period') && <>
              <label className="text-[12.5px] text-muted">Dari<input type="date" className="input mt-1" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
              <label className="text-[12.5px] text-muted">Sampai<input type="date" className="input mt-1" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
            </>}
            {def.filters.includes('vehicle') && vehicles.data && <label className="text-[12.5px] text-muted">Kendaraan<select className="input mt-1" value={filters.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}><option value="">Semua</option>{vehicles.data.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}</select></label>}
            {def.filters.includes('customer') && customers.data && <label className="text-[12.5px] text-muted">Customer<select className="input mt-1 max-w-[220px]" value={filters.customerId} onChange={(e) => set({ customerId: e.target.value })}><option value="">Semua</option>{customers.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            {def.filters.includes('status') && def.statusOptions && <label className="text-[12.5px] text-muted">Status<select className="input mt-1" value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Semua</option>{def.statusOptions.map((o: Row) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
            {report.data && def.filters.includes('period') && <p className="ml-auto self-center text-[12.5px] text-muted">{formatDate(report.data.from)} – {formatDate(report.data.to)}</p>}
          </div>
        )}
        {report.isError ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : !report.data ? <div className="space-y-2 p-4"><Skeleton /><Skeleton /><Skeleton /></div> : (
          <>
            {report.data.rows.length === 0 ? <EmptyState title="Tidak ada data untuk filter ini" description="Ubah periode atau filter lainnya." /> : <div className="overflow-x-auto"><ReportTable report={report.data} /></div>}
            {report.data.notes && <p className="border-t border-line px-4 py-3 text-[12.5px] text-muted">{report.data.notes}</p>}
          </>
        )}
      </div>
    </>
  );
}
