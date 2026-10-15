import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileUp, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction } from '../lib/hooks';
import { formatDateTime } from '../lib/format';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, cx } from '../components/ui';
import { useToast } from '../components/Toast';

const STEPS = ['Unggah file', 'Cocokkan kolom', 'Periksa & konfirmasi', 'Selesai'];
const ACTION: Record<string, [string, 'teal' | 'brand' | 'muted' | 'danger']> = {
  create: ['Baru', 'teal'], update: ['Perbarui', 'brand'], skip: ['Dilewati (duplikat)', 'muted'], error: ['Error', 'danger'],
};

export default function ImportPage() {
  const { entity = 'customers' } = useParams();
  const isCustomer = entity === 'customers';
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [job, setJob] = useState<Row | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [mode, setMode] = useState<'skip' | 'update'>('skip');
  const [analysis, setAnalysis] = useState<Row | null>(null);
  const [result, setResult] = useState<Row | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const history = useQuery({ queryKey: ['imports', activeCompanyId], queryFn: () => api.get<Row[]>('/imports') });
  const validate = useAction((m: 'skip' | 'update') => api.post<Row>(`/imports/${job!.id}/validate`, { mapping, duplicateMode: m }), { invalidate: [], onSuccess: (r) => { setAnalysis(r); setStep(2); } });
  const commit = useAction(() => api.post<Row>(`/imports/${job!.id}/commit`, { mapping, duplicateMode: mode }), { success: 'Impor selesai', onSuccess: (r) => { setResult(r); setStep(3); } });

  if (!can(isCustomer ? 'customer.import' : 'vehicle.import')) return <EmptyState title="Akses ditolak" description="Anda tidak memiliki izin impor data." />;
  const upload = async (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    setUploading(true);
    try {
      const j = await api.upload<Row>(`/imports/${entity}/upload`, fd);
      setJob(j); setMapping(j.suggestedMapping); setStep(1); setAnalysis(null); setResult(null);
    } catch (e) { toast.error(e); } finally { setUploading(false); }
  };
  const label = isCustomer ? 'customer' : 'kendaraan';
  return (
    <>
      <PageHeader back={<Link to={isCustomer ? '/customers' : '/vehicles'} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />{isCustomer ? 'Customer' : 'Kendaraan'}</Link>}
        title={`Impor ${label}`} description="Unggah file Excel (.xlsx) atau CSV. Data diperiksa dulu sebelum disimpan, dan tidak ada yang tersimpan sampai Anda mengonfirmasi."
        actions={<Button variant="secondary" icon={<Download className="size-4" />} onClick={() => api.download(`/imports/templates/${entity}`).catch(toast.error)}>Unduh template Excel</Button>} />

      <ol className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Langkah impor">
        {STEPS.map((s, i) => (
          <li key={s} className={cx('rounded-md border px-3 py-2 text-[13px]', i === step ? 'border-brand bg-brand-soft font-medium text-brand' : i < step ? 'border-teal/40 text-teal' : 'border-line text-muted')}>
            <span className="num mr-1.5">{i + 1}.</span>{s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Pilih file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
            className="flex w-full flex-col items-center rounded-lg border-2 border-dashed border-line px-4 py-12 text-center hover:border-brand">
            {uploading ? <Spinner className="size-7" /> : <FileUp className="size-9 text-muted" strokeWidth={1.4} />}
            <span className="mt-3 font-medium">Pilih atau seret file ke sini</span>
            <span className="mt-1 text-sm text-muted">.xlsx atau .csv, maksimal 5.000 baris / 10 MB. Baris pertama berisi judul kolom.</span>
          </button>
        </Card>
      )}

      {step === 1 && job && (
        <div className="space-y-5">
          <Card title={`Cocokkan kolom — ${job.fileName} (${job.totalRows} baris)`}>
            <p className="mb-4 text-sm text-muted">Kolom file sudah dicocokkan otomatis bila namanya mirip. Periksa dan sesuaikan; kolom bertanda * wajib.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {job.fields.map((f: Row) => (
                <label key={f.key} className="block text-[13px]">
                  <span className="label">{f.label}{f.required && <span className="text-danger"> *</span>}</span>
                  <select className="input" value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}
                    aria-invalid={f.required && mapping[f.key] == null}>
                    <option value="">— tidak diimpor —</option>
                    {job.headers.map((h: string, i: number) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </Card>
          <Card title="Contoh data dari file" bodyClassName="p-0">
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>#</th>{job.headers.map((h: string, i: number) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{job.sampleRows.map((r: string[], i: number) => <tr key={i}><td className="text-muted">{i + 2}</td>{r.map((c, j) => <td key={j} className="whitespace-nowrap">{c}</td>)}</tr>)}</tbody></table></div>
          </Card>
          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>Ganti file</Button>
            <Button loading={validate.isPending} onClick={() => validate.mutate(mode)}>Periksa data</Button>
          </div>
        </div>
      )}

      {step === 2 && analysis && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[['Total baris', analysis.summary.total, ''], ['Akan ditambahkan', analysis.summary.create, 'text-teal'], ['Akan diperbarui', analysis.summary.update, 'text-brand'],
              ['Duplikat dilewati', analysis.summary.skip, 'text-muted'], ['Bermasalah', analysis.summary.error, analysis.summary.error ? 'text-danger' : '']].map(([l, n, c]) => (
              <div key={l as string} className="card p-3"><p className="text-[12.5px] text-muted">{l}</p><p className={cx('num text-xl font-semibold', c as string)}>{n}</p></div>
            ))}
          </div>
          {analysis.summary.duplicates > 0 && (
            <Card title={`${analysis.summary.duplicates} baris cocok dengan data yang sudah ada`}>
              <fieldset className="space-y-2 text-sm">
                <legend className="sr-only">Penanganan duplikat</legend>
                <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-brand" checked={mode === 'skip'} onChange={() => { setMode('skip'); validate.mutate('skip'); }} /><span><b>Lewati</b> — data lama tidak diubah.</span></label>
                <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-brand" checked={mode === 'update'} onChange={() => { setMode('update'); validate.mutate('update'); }} /><span><b>Perbarui</b> — kolom yang terisi di file menimpa data lama (sel kosong tidak menghapus data). Perubahan ditampilkan di bawah.</span></label>
              </fieldset>
            </Card>
          )}
          <Card title="Pratinjau perubahan" bodyClassName="p-0">
            <div className="max-h-[480px] overflow-auto"><table className="table-base">
              <thead className="sticky top-0"><tr><th>Baris</th><th>Data</th><th>Tindakan</th><th>Keterangan</th></tr></thead>
              <tbody>{analysis.rows.map((r: Row) => (
                <tr key={r.rowNumber}>
                  <td className="num text-muted">{r.rowNumber}</td>
                  <td>{r.label ?? <span className="text-muted">—</span>}{r.existingLabel && <span className="block text-[12px] text-muted">cocok dengan {r.existingLabel}</span>}</td>
                  <td><Badge tone={ACTION[r.action][1]}>{ACTION[r.action][0]}</Badge></td>
                  <td className="text-[13px]">
                    {r.errors.length > 0 && <ul className="list-disc pl-4 text-danger">{r.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>}
                    {r.changes && Object.keys(r.changes).length > 0 && <ul className="space-y-0.5">{Object.entries(r.changes as Record<string, Row>).map(([k, c]) => <li key={k}><span className="text-muted">{k}:</span> <s className="text-muted">{String(c.from ?? '—')}</s> → <b>{String(c.to)}</b></li>)}</ul>}
                    {r.action === 'update' && r.changes && Object.keys(r.changes).length === 0 && <span className="text-muted">Tidak ada perubahan</span>}
                  </td>
                </tr>))}</tbody>
            </table></div>
          </Card>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>Kembali ke pencocokan kolom</Button>
            <Button loading={commit.isPending} disabled={analysis.summary.create + analysis.summary.update === 0} onClick={() => commit.mutate(undefined)}>
              Impor {analysis.summary.create + analysis.summary.update} baris{analysis.summary.error ? ` (lewati ${analysis.summary.error} error)` : ''}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <Card>
          <div className="flex flex-col items-center py-6 text-center">
            <CheckCircle2 className="size-10 text-teal" strokeWidth={1.5} />
            <p className="mt-3 text-lg font-semibold">Impor selesai</p>
            <p className="mt-1 text-sm text-muted">{result.summary.created} {label} baru · {result.summary.updated} diperbarui · {result.summary.skip} dilewati · {result.summary.error} bermasalah</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {result.summary.error > 0 && <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => api.download(`/imports/${job!.id}/errors`).catch(toast.error)}>Unduh laporan error</Button>}
              <Button variant="secondary" onClick={() => { setStep(0); setJob(null); }}>Impor file lain</Button>
              <Link to={isCustomer ? '/customers' : '/vehicles'}><Button>Lihat {label}</Button></Link>
            </div>
          </div>
        </Card>
      )}

      <Card title="Riwayat impor" className="mt-5" bodyClassName="p-0">
        {!history.data?.length ? <p className="px-4 py-5 text-sm text-muted">Belum ada impor.</p> : (
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Waktu</th><th>Jenis</th><th>File</th><th>Oleh</th><th>Hasil</th><th /></tr></thead>
            <tbody>{history.data.map((h) => (
              <tr key={h.id}><td>{formatDateTime(h.createdAt)}</td><td>{h.entity === 'CUSTOMER' ? 'Customer' : 'Kendaraan'}</td><td>{h.fileName}</td><td>{h.createdByName}</td>
                <td>{h.status === 'COMPLETED' ? `${h.result.summary.created} baru, ${h.result.summary.updated} diperbarui, ${h.result.summary.error} error` : <Badge tone="muted">Belum dikonfirmasi</Badge>}</td>
                <td className="text-right">{h.status === 'COMPLETED' && h.result.summary.error > 0 && <button type="button" className="text-sm text-brand hover:underline" onClick={() => api.download(`/imports/${h.id}/errors`).catch(toast.error)}>Laporan error</button>}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>
    </>
  );
}
