import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction } from '../lib/hooks';
import { BookingForm, valuesFrom } from '../components/BookingForm';
import { ErrorState, PageHeader, Skeleton, EmptyState } from '../components/ui';

export default function RentalForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { activeCompanyId } = useAuth();
  const q = useQuery({ queryKey: ['rental', activeCompanyId, id], queryFn: () => api.get<Row>(`/rentals/${id}`), enabled: !!id });
  const save = useAction(({ payload, key }: { payload: Row; key: string }) =>
    id ? api.put<Row>(`/rentals/${id}`, payload) : api.post<Row>('/rentals', payload, { 'Idempotency-Key': key }),
  { success: id ? 'Transaksi diperbarui' : 'Transaksi dibuat', onSuccess: (r) => navigate(`/rentals/${r.id}`, { replace: true }) });

  if (id && q.isError) return <ErrorState error={q.error} />;
  if (id && !q.data) return <Skeleton className="h-64" />;
  const rental = q.data?.rental;
  if (rental && !['SCHEDULED', 'ONGOING'].includes(rental.status)) return <EmptyState title="Transaksi tidak dapat diubah" description="Transaksi yang sudah dikembalikan, selesai, atau dibatalkan tidak dapat diubah." />;
  return (
    <>
      <PageHeader back={<Link to={id ? `/rentals/${id}` : '/rentals'} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />{id ? rental?.number : 'Transaksi rental'}</Link>}
        title={id ? `Ubah transaksi ${rental?.number}` : 'Transaksi rental baru'}
        description={id ? 'Perubahan jadwal, kendaraan, atau tarif akan dihitung ulang dan dicek ketersediaannya.' : 'Pilih customer dan kendaraan yang tersedia. Semua nominal dihitung otomatis dari tarif.'} />
      <BookingForm kind="rental"
        initial={valuesFrom(rental ?? null, { customerId: params.get('customerId') ?? '', vehicleId: params.get('vehicleId') ?? '' })}
        editing={rental ? { type: 'RENTAL', id: rental.id, total: rental.total, status: rental.status } : null}
        existing={rental}
        lockedFields={rental?.status === 'ONGOING' ? ['customerId', 'vehicleId', 'startAt'] : []}
        submitting={save.isPending}
        onSubmit={(payload, key) => save.mutate({ payload, key })} />
    </>
  );
}
