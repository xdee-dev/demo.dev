import { useEffect, type ReactNode } from 'react';
import { Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Row } from '../lib/types';
import { addMoney, formatDate, formatDateTime, formatDuration, formatMoney, formatNumber, isPositive, subMoney, toCents } from '../lib/format';
import { FUEL, PAYMENT_STATUS, RENTAL_TYPE, TRANSMISSION, UNIT } from '../lib/labels';
import { terbilang } from '../lib/terbilang';
import { ErrorState, Spinner, cx } from '../components/ui';
import { AuthImage } from '../components/inputs';
import { ReportTable } from '../components/ReportTable';

export default function PrintPage() {
  return (
    <Routes>
      <Route path="invoice/:id" element={<RentalDoc kind="invoice" />} />
      <Route path="contract/:id" element={<RentalDoc kind="contract" />} />
      <Route path="handover/:id" element={<RentalDoc kind="handover" />} />
      <Route path="return/:id" element={<RentalDoc kind="return" />} />
      <Route path="receipt/:id" element={<Receipt />} />
      <Route path="reservation/:id" element={<ReservationLetter />} />
      <Route path="report/:key" element={<ReportPrint />} />
    </Routes>
  );
}

/* ------------------------------------------------------------------ shell */

function Shell({ title, children, size = 'A4', loading, error }: { title: string; children?: ReactNode; size?: 'A4' | 'A5'; loading?: boolean; error?: unknown }) {
  useEffect(() => { document.title = title; }, [title]);
  return (
    <div className="min-h-dvh bg-[#e9edf2] print:bg-white">
      {size === 'A5' && <style>{'@media print { @page { size: A5; margin: 10mm; } }'}</style>}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-2.5">
        <p className="truncate text-sm font-medium">{title}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"><Printer className="size-4" />Cetak / simpan PDF</button>
          <button type="button" onClick={() => window.close()} aria-label="Tutup" className="grid size-10 place-items-center rounded-md hover:bg-ink/5"><X className="size-5" /></button>
        </div>
      </div>
      <p className="no-print px-4 pt-3 text-center text-[12.5px] text-muted">Pratinjau cetak {size}. Pilih “Simpan sebagai PDF” pada dialog cetak untuk membuat file PDF.</p>
      {error ? <ErrorState error={error} /> : loading ? <div className="flex justify-center py-20"><Spinner className="size-6" /></div> : (
        <div className="overflow-x-auto px-2 py-4 print:p-0">
          <article className={cx('print-sheet mx-auto bg-white text-[12.5px] leading-relaxed text-ink shadow-[0_2px_14px_rgba(20,35,60,0.12)]', size === 'A5' ? 'w-[148mm] min-h-[200mm] p-[10mm]' : 'w-[210mm] min-h-[297mm] p-[14mm]')}>
            {children}
          </article>
        </div>
      )}
    </div>
  );
}

function Letterhead({ c, docTitle, docNumber, docDate, extra }: { c: Row; docTitle: string; docNumber: string; docDate: string; extra?: ReactNode }) {
  return (
    <header className="avoid-break mb-5 flex items-start justify-between gap-6 border-b-2 border-ink pb-4">
      <div className="flex min-w-0 items-start gap-3">
        {c.logoFileId && <AuthImage fileId={c.logoFileId} alt="" className="h-14 w-auto max-w-[120px] object-contain" />}
        <div className="min-w-0">
          <p className="text-[16px] font-semibold leading-tight">{c.name}</p>
          <p className="text-[11.5px] text-muted">{[c.address, c.city].filter(Boolean).join(', ')}</p>
          <p className="text-[11.5px] text-muted">{[c.phone && `Telp. ${c.phone}`, c.email, c.website].filter(Boolean).join(' · ')}</p>
          {c.npwp && <p className="text-[11.5px] text-muted">NPWP {c.npwp}</p>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[18px] font-semibold tracking-[0.02em] text-brand">{docTitle}</p>
        <p className="num mt-1 font-medium">{docNumber}</p>
        <p className="text-[11.5px] text-muted">{docDate}</p>
        {extra}
      </div>
    </header>
  );
}

function Signatures({ left, right, leftName, rightName }: { left: string; right: string; leftName?: string; rightName?: string }) {
  return (
    <div className="avoid-break mt-10 grid grid-cols-2 gap-16 text-center">
      {(right ? [[left, leftName], [right, rightName]] : [[null, null], [left, leftName]]).map(([label, name], i) => label === null ? <div key={i} /> : (
        <div key={i}><p>{label}</p><div className="mx-auto mt-16 w-48 border-b border-ink" /><p className="mt-1 font-medium">{name || ' '}</p></div>
      ))}
    </div>
  );
}

function Footer({ text }: { text?: string }) {
  return <footer className="mt-10 border-t border-line pt-2 text-center text-[10.5px] text-muted">{text} Dicetak {formatDateTime(new Date())}.</footer>;
}

function PartyBlock({ title, lines }: { title: string; lines: (ReactNode | null | undefined)[] }) {
  return <div className="avoid-break"><p className="mb-1 text-[11px] font-semibold text-muted">{title}</p>{lines.filter(Boolean).map((l, i) => <p key={i} className={i === 0 ? 'font-semibold' : ''}>{l}</p>)}</div>;
}

/* ------------------------------------------------------- rental documents */

function useRental() {
  const { id } = useParams();
  const { activeCompanyId } = useAuth();
  return useQuery({ queryKey: ['rental', activeCompanyId, id], queryFn: () => api.get<Row>(`/rentals/${id}`) });
}

function ChargesTable({ r, b }: { r: Row; b?: Row }) {
  const lines: [string, string, string, string][] = [[`Sewa ${r.vehicleSnapshot.brand} ${r.vehicleSnapshot.model} (${r.vehicleSnapshot.plateNumber}) — ${RENTAL_TYPE[r.rentalType]}, ${r.withDriver ? 'dengan sopir' : 'tanpa sopir'}`, `${r.quantity} ${UNIT[r.rentalType]}`, formatMoney(r.unitPrice), formatMoney(r.subtotal)]];
  if (isPositive(r.extraCharges)) lines.push([`Biaya tambahan${r.extraChargesNote ? ` — ${r.extraChargesNote}` : ''}`, '', '', formatMoney(r.extraCharges)]);
  if (isPositive(r.lateFee)) lines.push(['Denda keterlambatan', '', '', formatMoney(r.lateFee)]);
  if (isPositive(r.damageFee)) lines.push(['Biaya kerusakan', '', '', formatMoney(r.damageFee)]);
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead><tr className="border-y border-ink/60 text-left"><th className="py-1.5 pr-2">Uraian</th><th className="px-2 text-right">Durasi</th><th className="px-2 text-right">Harga satuan</th><th className="pl-2 text-right">Jumlah</th></tr></thead>
      <tbody>{lines.map((l, i) => <tr key={i} className="border-b border-line"><td className="py-1.5 pr-2">{l[0]}</td><td className="num px-2 text-right">{l[1]}</td><td className="num px-2 text-right">{l[2]}</td><td className="num pl-2 text-right">{l[3]}</td></tr>)}</tbody>
      <tfoot className="avoid-break">
        <tr><td colSpan={3} className="pt-2 text-right">Subtotal</td><td className="num pt-2 text-right">{formatMoney(addMoney(r.subtotal, r.extraCharges, r.lateFee, r.damageFee))}</td></tr>
        {isPositive(r.discount) && <tr><td colSpan={3} className="text-right">Diskon</td><td className="num text-right">−{formatMoney(r.discount)}</td></tr>}
        {isPositive(r.taxAmount) && <tr><td colSpan={3} className="text-right">Pajak {Number(r.taxPercent)}%</td><td className="num text-right">{formatMoney(r.taxAmount)}</td></tr>}
        <tr className="font-semibold"><td colSpan={3} className="border-t border-ink/60 py-1.5 text-right">Total tagihan</td><td className="num border-t border-ink/60 py-1.5 text-right text-[13.5px]">{formatMoney(r.total)}</td></tr>
        {b && <>
          {r.status === 'CANCELLED' && <tr><td colSpan={3} className="text-right">Biaya pembatalan</td><td className="num text-right">{formatMoney(r.cancellationFee)}</td></tr>}
          <tr><td colSpan={3} className="text-right">Pembayaran diterima</td><td className="num text-right">{formatMoney(b.paid)}</td></tr>
          <tr className="font-semibold"><td colSpan={3} className="text-right">{toCents(b.balance) < 0n ? 'Kelebihan bayar' : 'Sisa tagihan'}</td><td className="num text-right">{formatMoney(toCents(b.balance) < 0n ? subMoney('0', b.balance) : b.balance)}</td></tr>
        </>}
      </tfoot>
    </table>
  );
}

function RentalDoc({ kind }: { kind: 'invoice' | 'contract' | 'handover' | 'return' }) {
  const q = useRental();
  const { settings } = useAuth();
  const titles = { invoice: 'INVOICE', contract: 'SURAT PERJANJIAN SEWA KENDARAAN', handover: 'BERITA ACARA SERAH TERIMA KENDARAAN', return: 'BERITA ACARA PENGEMBALIAN KENDARAAN' };
  const d = q.data;
  const r = d?.rental;
  const docNo = !r ? '' : kind === 'invoice' ? r.invoiceNumber : kind === 'contract' ? r.contractNumber : r.number;
  const p = settings?.print;
  return (
    <Shell title={r ? `${titles[kind]} ${docNo}` : 'Memuat…'} loading={!d} error={q.error}>
      {r && p && (() => {
        const c = r.companySnapshot; const cs = r.customerSnapshot; const vs = r.vehicleSnapshot;
        const lettered = <Letterhead c={c} docTitle={titles[kind]} docNumber={docNo} docDate={formatDate(kind === 'invoice' ? r.createdAt : r.startAt, 'long')}
          extra={kind === 'invoice' ? <p className="mt-1 text-[11.5px]">Status: <b>{PAYMENT_STATUS[d.balance.paymentStatus]?.[0]}</b></p> : <p className="text-[11.5px] text-muted">Ref. {r.number}</p>} />;
        const vehicleTable = (
          <table className="avoid-break w-full text-[12px]"><tbody>
            {[['Kendaraan', `${vs.brand} ${vs.model}`], ['Nomor polisi', vs.plateNumber], ['Tahun / warna', [vs.year, vs.color].filter(Boolean).join(' / ') || '—'], ['Transmisi / BBM', `${TRANSMISSION[vs.transmission] ?? ''} / ${FUEL[vs.fuelType] ?? ''}`]].map(([k, v]) => (
              <tr key={k}><td className="w-40 py-0.5 text-muted">{k}</td><td className="py-0.5 font-medium">{v}</td></tr>))}
          </tbody></table>
        );
        const schedule = (
          <table className="avoid-break w-full text-[12px]"><tbody>
            {[['Mulai sewa', formatDateTime(r.startAt)], ['Rencana kembali', formatDateTime(r.endAt)], ['Durasi', `${r.quantity} ${UNIT[r.rentalType]} (${formatDuration(Math.round((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 60000))})`],
              ['Lokasi ambil', r.pickupLocation ?? '—'], ['Lokasi kembali', r.returnLocation ?? '—'], ['Layanan', r.withDriver ? `Dengan sopir${d.driver ? ` (${d.driver.name})` : ''}` : 'Tanpa sopir (lepas kunci)']].map(([k, v]) => (
              <tr key={k}><td className="w-40 py-0.5 text-muted">{k}</td><td className="py-0.5">{v}</td></tr>))}
          </tbody></table>
        );
        const customerLines = [cs.name, cs.contactPerson && `u.p. ${cs.contactPerson}`, cs.address, cs.phone && `Telp. ${cs.phone}`, cs.idNumber && `${cs.idType ?? 'Identitas'}: ${cs.idNumber}`];

        if (kind === 'invoice') return <>
          {lettered}
          <div className="mb-5 grid grid-cols-2 gap-8">
            <PartyBlock title="Ditagihkan kepada" lines={customerLines} />
            <div>{schedule}</div>
          </div>
          <ChargesTable r={r} b={d.balance} />
          <p className="avoid-break mt-3 rounded bg-paper px-3 py-2 text-[11.5px]"><span className="text-muted">Terbilang: </span><i>{terbilang(r.total)}</i></p>
          {p.showBankAccounts && c.bankAccounts?.length > 0 && <div className="avoid-break mt-5"><p className="mb-1 text-[11px] font-semibold text-muted">Pembayaran melalui transfer</p>{c.bankAccounts.map((b: Row, i: number) => <p key={i}>{b.bank} {b.accountNumber} a.n. {b.accountHolder}</p>)}</div>}
          {p.invoiceNotes && <p className="avoid-break mt-4 whitespace-pre-line text-[11.5px] text-muted">{p.invoiceNotes}</p>}
          <Signatures left="Hormat kami," right="" leftName={c.name} />
          <Footer text={p.footerText} />
        </>;

        if (kind === 'contract') return <>
          {lettered}
          <p className="mb-4">Pada hari ini, {formatDate(r.startAt, 'long')}, telah dibuat perjanjian sewa kendaraan antara:</p>
          <div className="mb-4 grid grid-cols-2 gap-8">
            <PartyBlock title="PIHAK PERTAMA (Pemilik / Rental)" lines={[c.name, [c.address, c.city].filter(Boolean).join(', '), c.phone && `Telp. ${c.phone}`]} />
            <PartyBlock title="PIHAK KEDUA (Penyewa)" lines={customerLines} />
          </div>
          <p className="mb-2 font-semibold">Pasal 1 — Objek sewa</p>{vehicleTable}
          <p className="mb-2 mt-4 font-semibold">Pasal 2 — Jangka waktu</p>{schedule}
          <p className="mb-2 mt-4 font-semibold">Pasal 3 — Biaya sewa</p>
          <ChargesTable r={r} b={d.balance} />
          <p className="mb-2 mt-4 font-semibold">Pasal 4 — Ketentuan</p>
          <ol className="avoid-break list-decimal space-y-1 pl-5">{p.rentalTerms.split('\n').filter((t) => t.trim()).map((t, i) => <li key={i}>{t}</li>)}</ol>
          <p className="avoid-break mt-4">Demikian perjanjian ini dibuat dalam keadaan sadar tanpa paksaan, dan ditandatangani oleh kedua belah pihak.</p>
          <Signatures left={`PIHAK PERTAMA, ${p.signatureCompanyLabel}`} right={`PIHAK KEDUA, ${p.signatureCustomerLabel}`} leftName={c.name} rightName={cs.name} />
          <Footer text={p.footerText} />
        </>;

        const rec = kind === 'handover' ? d.handover : d.return;
        const checklist: [string, string][] = [['stnk', 'STNK'], ['kunci', 'Kunci & remote'], ['banSerep', 'Ban serep'], ['dongkrak', 'Dongkrak & kunci roda'], ['p3k', 'Kotak P3K'], ['kebersihan', 'Kebersihan kendaraan']];
        return <>
          {lettered}
          <div className="mb-5 grid grid-cols-2 gap-8">
            <PartyBlock title={kind === 'handover' ? 'Diserahkan kepada' : 'Dikembalikan oleh'} lines={customerLines} />
            {vehicleTable}
          </div>
          <table className="avoid-break mb-5 w-full text-[12px]"><tbody>
            {[[kind === 'handover' ? 'Waktu serah terima' : 'Waktu pengembalian', rec ? formatDateTime(kind === 'handover' ? rec.handedAt : rec.returnedAt) : '……………………………'],
              ['Rencana kembali', formatDateTime(r.endAt)], ['Kilometer', rec?.km != null ? `${formatNumber(rec.km)} km` : '…………… km'], ['Level BBM', rec?.fuelLevel ?? 'Kosong  ¼  ½  ¾  Penuh'],
              ...(kind === 'return' && rec ? [['Keterlambatan', rec.lateMinutes > 0 ? formatDuration(rec.lateMinutes) : 'Tepat waktu'], ['Denda keterlambatan', formatMoney(rec.lateFee)], ['Biaya kerusakan', formatMoney(rec.damageFee)]] : [])].map(([k, v]) => (
              <tr key={k} className="border-b border-line"><td className="w-48 py-1.5 text-muted">{k}</td><td className="py-1.5">{v}</td></tr>))}
          </tbody></table>
          <p className="mb-2 font-semibold">Kelengkapan kendaraan</p>
          <table className="avoid-break mb-5 w-full border-collapse text-[12px]"><thead><tr className="border-y border-ink/60"><th className="py-1 text-left">Item</th><th className="w-24 text-center">Ada / baik</th><th className="w-24 text-center">Tidak</th></tr></thead>
            <tbody>{checklist.map(([k, l]) => { const v = rec?.checklist?.[k]; return <tr key={k} className="border-b border-line"><td className="py-1.5">{l}</td><td className="text-center">{rec ? (v ? '✓' : '') : '☐'}</td><td className="text-center">{rec ? (v ? '' : '✗') : '☐'}</td></tr>; })}</tbody></table>
          <p className="mb-1 font-semibold">Catatan kondisi{kind === 'return' ? ' & kerusakan' : ''}</p>
          <div className="avoid-break min-h-[70px] rounded border border-line p-2 whitespace-pre-line">{[rec?.conditionNotes, kind === 'return' ? rec?.damageNotes : null].filter(Boolean).join('\n') || ' '}</div>
          <Signatures left={`Petugas ${p.signatureCompanyLabel}`} right={kind === 'handover' ? 'Penerima' : 'Penyewa'} leftName={rec?.staffName} rightName={(kind === 'handover' ? rec?.receiverName : rec?.returnerName) ?? cs.name} />
          <Footer text={p.footerText} />
        </>;
      })()}
    </Shell>
  );
}

/* ---------------------------------------------------------------- receipt */

function Receipt() {
  const { id } = useParams();
  const { activeCompanyId, settings, company } = useAuth();
  const q = useQuery({ queryKey: ['payment', activeCompanyId, id], queryFn: () => api.get<Row>(`/payments/${id}`) });
  const d = q.data;
  const p = d?.payment;
  const size = settings?.print.receiptSize ?? 'A5';
  const src = d?.rental ?? d?.reservation;
  const c = src?.companySnapshot ?? company;
  const refund = p && Number(p.amount) < 0;
  return (
    <Shell title={p ? `Kwitansi ${p.number}` : 'Memuat…'} size={size} loading={!d || !settings} error={q.error}>
      {p && c && settings && <>
        <Letterhead c={c} docTitle={refund ? 'BUKTI PENGEMBALIAN DANA' : 'KWITANSI'} docNumber={p.number} docDate={formatDate(p.paid_at, 'long')} />
        {p.reversed && <p className="mb-3 rounded border border-danger/40 px-3 py-1.5 text-center font-semibold text-danger">DIBATALKAN — pembayaran ini telah di-reversal</p>}
        <table className="w-full text-[12.5px]"><tbody>
          <tr><td className="w-44 py-1 align-top text-muted">{refund ? 'Dibayarkan kepada' : 'Telah terima dari'}</td><td className="py-1 font-semibold">{p.customer_name}</td></tr>
          <tr><td className="py-1 align-top text-muted">Uang sejumlah</td><td className="py-1"><i>{terbilang(String(p.amount).replace('-', ''))}</i></td></tr>
          <tr><td className="py-1 align-top text-muted">Untuk pembayaran</td><td className="py-1">
            {d.rental ? <>{p.is_down_payment ? 'Uang muka sewa ' : refund ? 'Pengembalian dana sewa ' : 'Sewa '}{d.rental.vehicleSnapshot.brand} {d.rental.vehicleSnapshot.model} ({d.rental.vehicleSnapshot.plateNumber}), {formatDate(d.rental.startAt)} – {formatDate(d.rental.endAt)}, transaksi {d.rental.number} / invoice {d.rental.invoiceNumber}</>
              : d.reservation ? <>Uang muka reservasi {d.reservation.number}: {d.reservation.vehicleSnapshot.brand} {d.reservation.vehicleSnapshot.model} ({d.reservation.vehicleSnapshot.plateNumber}), {formatDate(d.reservation.startAt)}</> : null}
          </td></tr>
          <tr><td className="py-1 text-muted">Metode</td><td className="py-1">{settings.paymentMethods.find((m) => m.code === p.method)?.label ?? p.method}{p.cash_account_name ? ` — ${p.cash_account_name}` : ''}{p.reference ? ` (ref. ${p.reference})` : ''}</td></tr>
        </tbody></table>
        <div className="avoid-break mt-4 flex items-end justify-between gap-6">
          <div className="rounded-md border-2 border-ink px-4 py-2"><span className="text-[11px] text-muted">Jumlah</span><p className="num text-[19px] font-semibold">{formatMoney(String(p.amount).replace('-', ''))}</p></div>
          {d.balance && d.rental && <table className="text-[11.5px]"><tbody>
            <tr><td className="pr-4 text-muted">Total tagihan</td><td className="num text-right">{formatMoney(d.balance.amountDue)}</td></tr>
            <tr><td className="pr-4 text-muted">Total dibayar s.d. kwitansi ini</td><td className="num text-right">{formatMoney(d.balance.paidToDate)}</td></tr>
            <tr className="font-semibold"><td className="pr-4">Sisa tagihan</td><td className="num text-right">{formatMoney(subMoney(d.balance.amountDue, d.balance.paidToDate))}</td></tr>
          </tbody></table>}
        </div>
        {settings.print.receiptNotes && <p className="mt-4 text-[11px] text-muted">{settings.print.receiptNotes}</p>}
        <Signatures left={refund ? 'Penerima,' : 'Penyetor,'} right={`${c.city ? `${c.city}, ` : ''}${formatDate(p.paid_at, 'long')}`} leftName={p.customer_name} rightName={p.created_by_name ?? c.name} />
        <Footer text={settings.print.footerText} />
      </>}
    </Shell>
  );
}

/* ------------------------------------------------------- reservation letter */

function ReservationLetter() {
  const { id } = useParams();
  const { activeCompanyId, settings } = useAuth();
  const q = useQuery({ queryKey: ['reservation', activeCompanyId, id], queryFn: () => api.get<Row>(`/reservations/${id}`) });
  const r = q.data?.reservation;
  return (
    <Shell title={r ? `Surat reservasi ${r.number}` : 'Memuat…'} loading={!q.data || !settings} error={q.error}>
      {r && settings && (() => {
        const c = r.companySnapshot; const cs = r.customerSnapshot; const vs = r.vehicleSnapshot;
        return <>
          <Letterhead c={c} docTitle="SURAT KONFIRMASI RESERVASI" docNumber={r.number} docDate={formatDate(r.createdAt, 'long')} />
          <p className="mb-4">Kepada Yth. <b>{cs.name}</b>{cs.phone ? `, ${cs.phone}` : ''}. Dengan ini kami {r.status === 'CONFIRMED' ? 'mengonfirmasi' : 'mencatat'} reservasi kendaraan berikut:</p>
          <table className="mb-5 w-full text-[12px]"><tbody>
            {[['Status', r.status === 'CONFIRMED' ? 'Dikonfirmasi' : r.status === 'PENDING' ? 'Menunggu konfirmasi' : r.status === 'DRAFT' ? 'Draft' : r.status],
              ['Kendaraan', `${vs.brand} ${vs.model} — ${vs.plateNumber}`], ['Mulai', formatDateTime(r.startAt)], ['Selesai', formatDateTime(r.endAt)],
              ['Jenis sewa', `${RENTAL_TYPE[r.rentalType]}, ${r.withDriver ? 'dengan sopir' : 'tanpa sopir'}`], ['Lokasi ambil', r.pickupLocation ?? '—'], ['Lokasi kembali', r.returnLocation ?? '—']].map(([k, v]) => (
              <tr key={k} className="border-b border-line"><td className="w-44 py-1.5 text-muted">{k}</td><td className="py-1.5">{v}</td></tr>))}
          </tbody></table>
          <table className="w-full text-[12px]"><tbody>
            <tr><td className="py-1 text-muted">{r.quantity} {UNIT[r.rentalType]} × {formatMoney(r.unitPrice)}</td><td className="num text-right">{formatMoney(r.subtotal)}</td></tr>
            {isPositive(r.discount) && <tr><td className="py-1 text-muted">Diskon</td><td className="num text-right">−{formatMoney(r.discount)}</td></tr>}
            {isPositive(r.extraCharges) && <tr><td className="py-1 text-muted">Biaya tambahan</td><td className="num text-right">{formatMoney(r.extraCharges)}</td></tr>}
            {isPositive(r.taxAmount) && <tr><td className="py-1 text-muted">Pajak</td><td className="num text-right">{formatMoney(r.taxAmount)}</td></tr>}
            <tr className="font-semibold"><td className="border-t border-ink/60 py-1.5">Total</td><td className="num border-t border-ink/60 text-right">{formatMoney(r.total)}</td></tr>
            <tr><td className="py-1 text-muted">Uang muka diterima</td><td className="num text-right">{formatMoney(q.data!.balance.paid)}</td></tr>
          </tbody></table>
          <p className="mt-5 text-[11.5px] text-muted">Reservasi ini bukan kontrak sewa. Surat perjanjian sewa diterbitkan saat transaksi dibuat. Pembatalan mengikuti ketentuan perusahaan.</p>
          <Signatures left="Hormat kami," right="" leftName={c.name} />
          <Footer text={settings.print.footerText} />
        </>;
      })()}
    </Shell>
  );
}

/* ---------------------------------------------------------------- report */

function ReportPrint() {
  const { key } = useParams();
  const [params] = useSearchParams();
  const { activeCompanyId, company } = useAuth();
  const filters = Object.fromEntries(params.entries());
  const q = useQuery({ queryKey: ['report', activeCompanyId, key, filters], queryFn: () => api.get<Row>(`/reports/${key}`, filters) });
  const d = q.data;
  return (
    <Shell title={d ? `${d.title} ${d.from} – ${d.to}` : 'Memuat…'} loading={!d || !company} error={q.error}>
      {d && company && <>
        <Letterhead c={company} docTitle={d.title.toUpperCase()} docNumber={d.filters.includes('period') ? `${formatDate(d.from)} – ${formatDate(d.to)}` : `Per ${formatDate(new Date())}`} docDate={`Dibuat ${formatDateTime(d.generatedAt)}`} />
        <ReportTable report={d} compact />
        {d.notes && <p className="mt-3 text-[11px] text-muted">{d.notes}</p>}
        <Footer text={company.name} />
      </>}
    </Shell>
  );
}
