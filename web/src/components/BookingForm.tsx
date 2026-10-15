import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus, UserRound, Car } from 'lucide-react';
import { api, newIdempotencyKey } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { useFieldErrors } from '../lib/hooks';
import { formatDateTime, formatDuration, formatMoney, isPositive, subMoney } from '../lib/format';
import { RENTAL_TYPE, UNIT } from '../lib/labels';
import { Button, Card, Checkbox, Input, Select, Textarea, useConfirm, cx, Spinner } from './ui';
import { Combobox, DateTimeInput, MoneyInput, Plate, type Option } from './inputs';
import { CustomerForm } from '../pages/Customers';
import { useToast } from './Toast';

export interface BookingValues {
  customerId: string; vehicleId: string; driverId: string; startAt: string; endAt: string; rentalType: string; withDriver: boolean;
  pickupLocation: string; returnLocation: string; unitPrice: string; quantity: string; discount: string; extraCharges: string; extraChargesNote: string; notes: string;
  // reservation
  status?: string; dpAmount?: string;
  // rental create
  dp?: { amount: string; method: string; cashAccountId: string; reference: string };
}

const trim = (m: string | number | null | undefined) => (m === null || m === undefined ? '' : String(m).replace(/\.00$/, ''));

export function valuesFrom(src: Row | null, defaults: Partial<BookingValues> = {}): BookingValues {
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const end = new Date(now.getTime() + 86400_000);
  return {
    customerId: src?.customerId ?? defaults.customerId ?? '', vehicleId: src?.vehicleId ?? defaults.vehicleId ?? '', driverId: src?.driverId ?? '',
    startAt: src?.startAt ?? defaults.startAt ?? now.toISOString(), endAt: src?.endAt ?? defaults.endAt ?? end.toISOString(),
    rentalType: src?.rentalType ?? 'DAILY', withDriver: src?.withDriver ?? false, pickupLocation: src?.pickupLocation ?? '', returnLocation: src?.returnLocation ?? '',
    unitPrice: src ? trim(src.unitPrice) : '', quantity: src ? String(src.quantity) : '', discount: trim(src?.discount ?? ''), extraCharges: trim(src?.extraCharges ?? ''),
    extraChargesNote: src?.extraChargesNote ?? '', notes: src?.notes ?? '', status: src?.status ?? 'CONFIRMED', dpAmount: trim(src?.dpAmount ?? ''),
    dp: { amount: '', method: 'TRANSFER', cashAccountId: '', reference: '' },
  };
}

export function BookingForm({ kind, initial, editing, existing, onSubmit, submitting, lockedFields = [] }: {
  kind: 'rental' | 'reservation';
  initial: BookingValues;
  editing?: { type: 'RENTAL' | 'RESERVATION'; id: string; total: string; status: string } | null;
  existing?: Row | null;
  onSubmit: (payload: Row, idempotencyKey: string) => void;
  submitting: boolean;
  lockedFields?: string[];
}) {
  const { can, settings, activeCompanyId } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [v, setV] = useState<BookingValues>(initial);
  const [manualPrice, setManualPrice] = useState<boolean>(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [customerLabel, setCustomerLabel] = useState<string>('');
  const [customerInfo, setCustomerInfo] = useState<Row | null>(null);
  const [vehicleLabel, setVehicleLabel] = useState<string>('');
  const idemKey = useRef(newIdempotencyKey());
  const fe = useFieldErrors();
  const set = <K extends keyof BookingValues>(k: K, val: BookingValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const locked = (k: string) => lockedFields.includes(k);

  // Resolve labels for preselected customer/vehicle (edit mode or ?customerId=)
  useEffect(() => {
    if (v.customerId && !customerLabel) {
      api.get<Row[]>('/customers/lookup', { id: v.customerId }).then((r) => { if (r[0]) { setCustomerLabel(`${r[0].name} — ${r[0].phone}`); setCustomerInfo(r[0]); } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.customerId]);

  const validPeriod = v.startAt && v.endAt && new Date(v.endAt) > new Date(v.startAt);
  const vehiclesQ = useQuery({
    queryKey: ['available', activeCompanyId, v.startAt, v.endAt, editing?.id],
    queryFn: () => api.get<Row[]>('/vehicles/available', { start: v.startAt, end: v.endAt, includeUnavailable: 'true', excludeType: editing?.type, excludeId: editing?.id }),
    enabled: !!validPeriod,
  });
  useEffect(() => {
    const veh = vehiclesQ.data?.find((x) => x.id === v.vehicleId);
    if (veh) setVehicleLabel(`${veh.plateNumber} — ${veh.brand} ${veh.model}`);
  }, [vehiclesQ.data, v.vehicleId]);

  const driversQ = useQuery({ queryKey: ['drivers-active', activeCompanyId], queryFn: () => api.get<{ data: Row[] }>('/drivers', { active: 'true', pageSize: 100 }), enabled: v.withDriver });
  const cashQ = useQuery({ queryKey: ['cash-accounts', activeCompanyId], queryFn: () => api.get<Row[]>('/cash-accounts'), enabled: kind === 'rental' && !editing });

  // Live quote (server is the source of truth for every amount)
  const quotePayload = useMemo(() => ({
    customerId: v.customerId, vehicleId: v.vehicleId, driverId: v.driverId || null, startAt: v.startAt, endAt: v.endAt, rentalType: v.rentalType, withDriver: v.withDriver,
    unitPrice: manualPrice && v.unitPrice !== '' ? v.unitPrice : null, quantity: manualPrice && v.quantity ? Number(v.quantity) : null,
    discount: v.discount || '0', extraCharges: v.extraCharges || '0', excludeType: editing?.type, excludeId: editing?.id,
  }), [v, manualPrice, editing]);
  const [debounced, setDebounced] = useState(quotePayload);
  useEffect(() => { const t = setTimeout(() => setDebounced(quotePayload), 300); return () => clearTimeout(t); }, [quotePayload]);
  const quoteQ = useQuery({
    queryKey: ['quote', activeCompanyId, debounced],
    queryFn: () => api.post<Row>('/pricing/quote', debounced),
    enabled: !!(debounced.customerId && debounced.vehicleId && validPeriod),
  });
  const q = quoteQ.data?.quote as Row | null | undefined;
  const conflicts = (quoteQ.data?.conflicts ?? []) as Row[];
  const canOverride = can('rental.price_override');

  // When editing an existing booking with a manual price, keep it manual so the agreed price is preserved
  useEffect(() => { if (existing && quoteQ.data?.rate && existing.unitPrice && Number(existing.unitPrice) !== Number(quoteQ.data.rate)) setManualPrice(true); }, [existing, quoteQ.data?.rate]);

  const payload = () => {
    const p: Row = {
      customerId: v.customerId, vehicleId: v.vehicleId, driverId: v.withDriver ? v.driverId || null : null, startAt: v.startAt, endAt: v.endAt,
      rentalType: v.rentalType, withDriver: v.withDriver, pickupLocation: v.pickupLocation, returnLocation: v.returnLocation,
      unitPrice: manualPrice && v.unitPrice !== '' ? v.unitPrice : null, quantity: manualPrice && v.quantity ? Number(v.quantity) : null,
      discount: v.discount || '0', extraCharges: v.extraCharges || '0', extraChargesNote: v.extraChargesNote, notes: v.notes,
    };
    if (kind === 'reservation') { p.status = v.status; p.dpAmount = v.dpAmount || '0'; }
    if (kind === 'rental' && !editing && v.dp && isPositive(v.dp.amount)) p.downPayment = { amount: v.dp.amount, method: v.dp.method, cashAccountId: v.dp.cashAccountId || null, reference: v.dp.reference };
    return p;
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!v.customerId) errs.customerId = 'Pilih customer';
    if (!v.vehicleId) errs.vehicleId = 'Pilih kendaraan';
    if (!validPeriod) errs.endAt = 'Tanggal selesai harus setelah tanggal mulai';
    if (Object.keys(errs).length) { fe.set(errs); toast.error('Lengkapi data yang wajib diisi'); return; }
    if (conflicts.length) { toast.error('Kendaraan tidak tersedia pada periode tersebut'); return; }
    if (editing && q) {
      const changedTotal = Number(q.total) !== Number(editing.total);
      const r = await confirm({
        title: 'Simpan perubahan?',
        message: (
          <div className="space-y-2">
            <p>Perubahan akan memperbarui jadwal kendaraan dan tagihan.</p>
            <table className="w-full text-sm"><tbody>
              <tr><td className="text-muted">Periode</td><td className="text-right">{formatDateTime(v.startAt)} – {formatDateTime(v.endAt)}</td></tr>
              <tr><td className="text-muted">Total sebelumnya</td><td className="num text-right">{formatMoney(editing.total)}</td></tr>
              <tr><td className="text-muted">Total baru</td><td className={cx('num text-right font-semibold', changedTotal && 'text-brand')}>{formatMoney(q.total)}</td></tr>
            </tbody></table>
          </div>
        ),
        confirmLabel: 'Simpan perubahan',
      });
      if (!r.ok) return;
    }
    onSubmit(payload(), idemKey.current);
  };

  const fetchCustomers = async (s: string): Promise<Option[]> => (await api.get<Row[]>('/customers/lookup', { q: s })).map((c) => ({
    id: c.id, label: c.name, sub: `${c.code} · ${c.phone}${c.status === 'BLACKLISTED' ? ' · BLACKLIST' : ''}`, disabled: c.status === 'BLACKLISTED', data: c,
  }));
  const fetchVehicles = async (s: string): Promise<Option[]> => {
    const list = vehiclesQ.data ?? (validPeriod ? await api.get<Row[]>('/vehicles/available', { start: v.startAt, end: v.endAt, includeUnavailable: 'true', excludeType: editing?.type, excludeId: editing?.id }) : []);
    const t = s.toLowerCase();
    return list.filter((x) => !t || `${x.plateNumber} ${x.brand} ${x.model}`.toLowerCase().includes(t)).map((x) => {
      const rate = (x.rates as Row[]).find((r) => r.rentalType === v.rentalType && r.withDriver === v.withDriver);
      return { id: x.id, label: `${x.plateNumber} — ${x.brand} ${x.model}`, sub: x.available ? `${rate ? formatMoney(rate.price) + ' / ' + UNIT[v.rentalType] : 'Tarif belum diatur'}${x.seats ? ` · ${x.seats} kursi` : ''}` : 'Tidak tersedia pada periode ini', disabled: !x.available, data: x };
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card title={<span className="flex items-center gap-2"><UserRound className="size-4 text-muted" />Customer</span>}>
          <Combobox label="Customer" required value={v.customerId || null} selectedLabel={customerLabel} error={fe.errors.customerId} disabled={locked('customerId')}
            queryKey={['customer-lookup']} fetchOptions={fetchCustomers}
            onChange={(id, opt) => { set('customerId', id ?? ''); setCustomerLabel(opt?.label ?? ''); setCustomerInfo((opt?.data as Row) ?? null); }}
            footer={can('customer.manage') && <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setNewCustomer(true)}>Tambah customer baru</Button>} />
          {customerInfo && (
            <div className="mt-3 grid gap-1 rounded-md bg-paper px-3 py-2.5 text-[13.5px] sm:grid-cols-2">
              <span><span className="text-muted">Telepon:</span> {customerInfo.phone}</span>
              {customerInfo.email && <span><span className="text-muted">Email:</span> {customerInfo.email}</span>}
              {customerInfo.address && <span className="sm:col-span-2"><span className="text-muted">Alamat:</span> {customerInfo.address}</span>}
              {customerInfo.idNumber && <span><span className="text-muted">{customerInfo.idType ?? 'ID'}:</span> {customerInfo.idNumber}</span>}
            </div>
          )}
          {!locked('customerId') && can('customer.manage') && <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm text-brand hover:underline" onClick={() => setNewCustomer(true)}><Plus className="size-3.5" />Customer belum terdaftar? Tambah tanpa meninggalkan formulir</button>}
        </Card>

        <Card title={<span className="flex items-center gap-2"><Car className="size-4 text-muted" />Jadwal & kendaraan</span>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateTimeInput label="Mulai" required value={v.startAt} onChange={(x) => set('startAt', x)} disabled={locked('startAt')} />
            <DateTimeInput label="Rencana pengembalian" required value={v.endAt} onChange={(x) => set('endAt', x)} error={fe.errors.endAt} />
            <Select label="Jenis rental" value={v.rentalType} onChange={(e) => set('rentalType', e.target.value)}>
              {Object.entries(RENTAL_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <div className="flex items-end pb-1"><Checkbox label="Dengan sopir" checked={v.withDriver} onChange={(x) => setV((s) => ({ ...s, withDriver: x, driverId: x ? s.driverId : '' }))} /></div>
            <div className="sm:col-span-2">
              <Combobox label="Kendaraan" required value={v.vehicleId || null} selectedLabel={vehicleLabel} error={fe.errors.vehicleId} disabled={locked('vehicleId') || !validPeriod}
                queryKey={['vehicle-lookup', v.startAt, v.endAt, v.rentalType, v.withDriver]} fetchOptions={fetchVehicles}
                onChange={(id, opt) => { set('vehicleId', id ?? ''); setVehicleLabel(opt?.label ?? ''); }} placeholder="Cari nopol atau model…" />
              {validPeriod && vehiclesQ.data && <p className="mt-1 text-[12.5px] text-muted">{vehiclesQ.data.filter((x) => x.available).length} dari {vehiclesQ.data.length} kendaraan tersedia pada periode ini.</p>}
            </div>
            {v.withDriver && (
              <Select className="sm:col-span-2" label="Sopir" value={v.driverId} onChange={(e) => set('driverId', e.target.value)} hint="Opsional — dapat ditentukan nanti">
                <option value="">Belum ditentukan</option>
                {driversQ.data?.data.map((d) => <option key={d.id} value={d.id}>{d.name}{d.phone ? ` — ${d.phone}` : ''}</option>)}
              </Select>
            )}
            <Input label="Lokasi pengambilan" value={v.pickupLocation} onChange={(e) => set('pickupLocation', e.target.value)} />
            <Input label="Lokasi pengembalian" value={v.returnLocation} onChange={(e) => set('returnLocation', e.target.value)} />
          </div>
          {conflicts.length > 0 && (
            <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />Jadwal bentrok — kendaraan tidak tersedia</p>
              <ul className="mt-1 list-disc pl-6">{conflicts.map((c, i) => <li key={i}>{c.label}: {formatDateTime(c.lower)} – {c.upper ? formatDateTime(c.upper) : 'belum ditentukan'}</li>)}</ul>
            </div>
          )}
        </Card>

        <Card title="Biaya & catatan">
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyInput label="Diskon" value={v.discount} onChange={(x) => set('discount', x)} disabled={!canOverride} hint={!canOverride ? 'Perlu izin ubah harga' : undefined} />
            <MoneyInput label="Biaya tambahan" value={v.extraCharges} onChange={(x) => set('extraCharges', x)} />
            <Input className="sm:col-span-2" label="Keterangan biaya tambahan" value={v.extraChargesNote} onChange={(e) => set('extraChargesNote', e.target.value)} placeholder="Mis. antar-jemput bandara" />
            {kind === 'reservation' && <>
              <Select label="Status reservasi" value={v.status} onChange={(e) => set('status', e.target.value)} hint={v.status === 'DRAFT' ? 'Draft tidak mengunci jadwal kendaraan' : 'Mengunci jadwal kendaraan'}>
                <option value="DRAFT">Draft</option><option value="PENDING">Menunggu konfirmasi</option><option value="CONFIRMED">Dikonfirmasi</option>
              </Select>
              <MoneyInput label="Rencana uang muka" value={v.dpAmount ?? ''} onChange={(x) => set('dpAmount', x)} hint="Uang muka yang diterima dicatat di menu Pembayaran" />
            </>}
            <Textarea className="sm:col-span-2" label="Catatan" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </Card>

        {kind === 'rental' && !editing && can('payment.manage') && v.dp && (
          <Card title="Uang muka (opsional)">
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyInput label="Nominal DP diterima" value={v.dp.amount} onChange={(x) => set('dp', { ...v.dp!, amount: x })} />
              <Select label="Metode" value={v.dp.method} onChange={(e) => set('dp', { ...v.dp!, method: e.target.value })}>
                {settings?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
              </Select>
              <Select label="Akun kas / rekening" value={v.dp.cashAccountId} onChange={(e) => set('dp', { ...v.dp!, cashAccountId: e.target.value })}>
                <option value="">—</option>{cashQ.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
              <Input label="Referensi" value={v.dp.reference} onChange={(e) => set('dp', { ...v.dp!, reference: e.target.value })} placeholder="No. transfer / bukti" />
            </div>
          </Card>
        )}
      </div>

      {/* price summary */}
      <aside className="lg:sticky lg:top-[72px] lg:self-start">
        <div className="card">
          <div className="border-b border-line px-4 py-3"><h2 className="text-[15px] font-semibold">Rincian tagihan</h2></div>
          <div className="space-y-3 p-4 text-[14px]">
            {!v.customerId || !v.vehicleId ? <p className="text-muted">Pilih customer, jadwal, dan kendaraan untuk menghitung tagihan.</p>
              : quoteQ.isLoading ? <div className="flex justify-center py-6"><Spinner /></div>
              : quoteQ.data?.error ? <p className="text-danger">{quoteQ.data.error}</p>
              : q ? <>
                <Line label="Durasi" value={formatDuration(q.durationMinutes)} />
                <Line label={`${q.quantity} ${UNIT[v.rentalType]} × ${formatMoney(q.unitPrice)}`} value={formatMoney(q.subtotal)} />
                {isPositive(q.discount) && <Line label="Diskon" value={`−${formatMoney(q.discount)}`} />}
                {isPositive(q.extraCharges) && <Line label="Biaya tambahan" value={formatMoney(q.extraCharges)} />}
                {isPositive(q.taxAmount) && <Line label={`Pajak ${Number(q.taxPercent)}%`} value={formatMoney(q.taxAmount)} />}
                <div className="flex items-baseline justify-between border-t border-line pt-3"><span className="font-medium">Total</span><span className="num text-[20px] font-semibold">{formatMoney(q.total)}</span></div>
                {kind === 'rental' && v.dp && isPositive(v.dp.amount) && <Line label="Sisa setelah DP" value={formatMoney(subMoney(q.total, v.dp.amount))} />}
                {quoteQ.data?.rate == null && !manualPrice && <p className="text-[12.5px] text-warn">Tarif kendaraan untuk pilihan ini belum diatur.</p>}
              </> : null}
            {canOverride && v.vehicleId && (
              <div className="border-t border-line pt-3">
                <Checkbox label="Ubah harga / durasi manual" checked={manualPrice} onChange={(x) => { setManualPrice(x); if (x && q) setV((s) => ({ ...s, unitPrice: s.unitPrice || trim(q.unitPrice), quantity: s.quantity || String(q.quantity) })); }} />
                {manualPrice && <div className="mt-2 grid grid-cols-2 gap-3">
                  <MoneyInput label="Harga satuan" value={v.unitPrice} onChange={(x) => set('unitPrice', x)} />
                  <Input label={`Jumlah ${UNIT[v.rentalType]}`} inputMode="numeric" value={v.quantity} onChange={(e) => set('quantity', e.target.value.replace(/\D/g, ''))} />
                </div>}
                {manualPrice && quoteQ.data?.rate && <p className="mt-1 text-[12.5px] text-muted">Tarif standar: {formatMoney(quoteQ.data.rate)} / {UNIT[v.rentalType]}. Perubahan harga tercatat di audit log.</p>}
              </div>
            )}
          </div>
          <div className="border-t border-line p-4">
            <Button className="w-full" loading={submitting} disabled={conflicts.length > 0} onClick={submit}>
              {editing ? 'Simpan perubahan' : kind === 'rental' ? 'Buat transaksi' : 'Simpan reservasi'}
            </Button>
          </div>
        </div>
      </aside>

      <CustomerForm open={newCustomer} initial={{}} onClose={() => setNewCustomer(false)}
        onSaved={(c) => { set('customerId', c.id); setCustomerLabel(`${c.name} — ${c.phone}`); setCustomerInfo(c); }} />
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-muted">{label}</span><span className="num whitespace-nowrap text-right">{value}</span></div>;
}

export { Plate };
