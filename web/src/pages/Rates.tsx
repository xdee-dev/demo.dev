import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction } from '../lib/hooks';
import { formatMoney } from '../lib/format';
import { Button, EmptyState, ErrorState, Modal, PageHeader, Skeleton } from '../components/ui';
import { Plate } from '../components/inputs';
import { RatesEditor, mapToRates, ratesToMap } from './Vehicles';

export default function Rates() {
  const { activeCompanyId, can } = useAuth();
  const q = useQuery({ queryKey: ['rates', activeCompanyId], queryFn: () => api.get<Row[]>('/rates') });
  const [edit, setEdit] = useState<Row | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const save = useAction(() => api.put(`/rates/${edit!.id}`, { rates: mapToRates(rates) }), { success: 'Tarif disimpan', onSuccess: () => setEdit(null) });
  const cell = (r: Row, t: string, d: boolean) => formatMoney(ratesToMap(r.rates)[`${t}-${d}`]);
  return (
    <>
      <PageHeader title="Tarif rental" description="Tarif per kendaraan untuk sewa harian, mingguan, dan bulanan. Perubahan tarif tercatat di audit log dan tidak mengubah transaksi yang sudah dibuat." />
      <div className="card overflow-hidden">
        {q.isError ? <ErrorState error={q.error} /> : !q.data ? <div className="space-y-3 p-4"><Skeleton /><Skeleton /><Skeleton /></div> : q.data.length === 0 ? <EmptyState title="Belum ada kendaraan" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th rowSpan={2}>Kendaraan</th><th colSpan={3} className="text-center">Tanpa sopir</th><th colSpan={3} className="text-center">Dengan sopir</th>{can('rate.manage') && <th rowSpan={2} />}</tr>
                <tr><th className="text-right">Harian</th><th className="text-right">Mingguan</th><th className="text-right">Bulanan</th><th className="text-right">Harian</th><th className="text-right">Mingguan</th><th className="text-right">Bulanan</th></tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id}>
                    <td><div className="flex items-center gap-2"><Plate size="sm">{r.plateNumber}</Plate><span className="whitespace-nowrap">{r.brand} {r.model}</span></div></td>
                    {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((t) => <td key={t} className="num text-right">{cell(r, t, false)}</td>)}
                    {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((t) => <td key={t} className="num text-right">{cell(r, t, true)}</td>)}
                    {can('rate.manage') && <td className="text-right"><Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => { setEdit(r); setRates(ratesToMap(r.rates)); }}>Ubah</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Tarif ${edit.plateNumber}` : ''} size="lg"
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Simpan tarif</Button></>}>
        <RatesEditor rates={rates} onChange={setRates} />
      </Modal>
    </>
  );
}
