import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, newIdempotencyKey } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useAction, useFieldErrors } from '../lib/hooks';
import { formatMoney, toCents, fromCents } from '../lib/format';
import { Button, Checkbox, Input, Modal, Select, Textarea } from './ui';
import { DateTimeInput, FileLink, FileUpload, MoneyInput } from './inputs';

/**
 * Records a payment (or refund) against a rental or reservation. A fresh Idempotency-Key per
 * dialog opening means double clicks / retries can never post the same payment twice.
 */
export function PaymentDialog({ open, onClose, target, balance, kind = 'PAYMENT', onPosted }: {
  open: boolean; onClose: () => void; target: { rentalId?: string; reservationId?: string; label: string }; balance: string; kind?: 'PAYMENT' | 'REFUND'; onPosted?: (p: Row) => void;
}) {
  const { settings, activeCompanyId } = useAuth();
  const key = useRef(newIdempotencyKey());
  const [lastOpen, setLastOpen] = useState(false);
  const maxAmount = kind === 'REFUND' ? fromCents(-toCents(balance)) : balance;
  const fresh = () => ({ amount: String(maxAmount).replace(/\.00$/, ''), method: settings?.paymentMethods[0]?.code ?? 'CASH', cashAccountId: '', paidAt: new Date().toISOString(), reference: '', notes: '', isDownPayment: false, proof: null as null | { id: string; originalName: string } });
  const [v, setV] = useState(fresh);
  if (open !== lastOpen) { setLastOpen(open); if (open) { setV(fresh()); key.current = newIdempotencyKey(); } }
  const accounts = useQuery({ queryKey: ['cash-accounts', activeCompanyId], queryFn: () => api.get<Row[]>('/cash-accounts'), enabled: open });
  const fe = useFieldErrors();
  const post = useAction(() => api.post<Row>('/payments', {
    ...(target.rentalId ? { rentalId: target.rentalId } : { reservationId: target.reservationId }), kind, amount: v.amount, method: v.method,
    cashAccountId: v.cashAccountId || null, paidAt: v.paidAt, reference: v.reference, notes: v.notes, isDownPayment: v.isDownPayment, proofFileId: v.proof?.id ?? null,
  }, { 'Idempotency-Key': key.current }), {
    success: (p) => `${kind === 'REFUND' ? 'Refund' : 'Pembayaran'} ${p.number} tercatat`, fieldErrors: fe,
    onSuccess: (p) => { onClose(); onPosted?.(p); },
  });
  return (
    <Modal open={open} onClose={onClose} title={kind === 'REFUND' ? 'Catat pengembalian dana' : 'Catat pembayaran'}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={post.isPending} disabled={!v.amount || toCents(v.amount) <= 0n} onClick={() => post.mutate(undefined)}>{kind === 'REFUND' ? 'Simpan refund' : 'Simpan pembayaran'}</Button></>}>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between rounded-md bg-paper px-3 py-2.5 text-sm">
          <span className="text-muted">{target.label}</span>
          <span><span className="text-muted">{kind === 'REFUND' ? 'Kelebihan bayar ' : 'Sisa tagihan '}</span><b className="num">{formatMoney(maxAmount)}</b></span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyInput label="Nominal" required value={v.amount} onChange={(x) => setV({ ...v, amount: x })} error={fe.errors.amount} />
          <DateTimeInput label="Tanggal bayar" required value={v.paidAt} onChange={(x) => setV({ ...v, paidAt: x })} />
          <Select label="Metode" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })} error={fe.errors.method}>
            {settings?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </Select>
          <Select label="Akun kas / rekening" value={v.cashAccountId} onChange={(e) => setV({ ...v, cashAccountId: e.target.value })}>
            <option value="">—</option>{accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Input className="sm:col-span-2" label="Referensi" placeholder="No. transfer, kode QRIS, dsb." value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
          {kind === 'PAYMENT' && target.rentalId && <div className="sm:col-span-2"><Checkbox label="Tandai sebagai uang muka (DP)" checked={v.isDownPayment} onChange={(x) => setV({ ...v, isDownPayment: x })} /></div>}
          <Textarea className="sm:col-span-2" label="Catatan" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            {v.proof ? <FileLink id={v.proof.id} name={v.proof.originalName} onRemove={() => setV({ ...v, proof: null })} /> : <FileUpload kind="PAYMENT_PROOF" label="Unggah bukti pembayaran" compact onUploaded={(f) => setV({ ...v, proof: f })} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
