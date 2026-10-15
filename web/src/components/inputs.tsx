import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Check, Paperclip, Upload, X, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { moneyInputDisplay, parseMoneyInput, toLocalInput, fromLocalInput } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Field, cx, Spinner } from './ui';
import { useToast } from './Toast';

/**
 * Money input: shows Indonesian thousands separators while typing (1.250.000,50) but the value
 * passed to `onChange` is always the canonical machine string ('1250000.50'). numeric keypad on mobile.
 */
export function MoneyInput({ label, value, onChange, error, hint, required, disabled, id, placeholder = '0', allowDecimals = true }: {
  label?: ReactNode; value: string; onChange: (v: string) => void; error?: string; hint?: ReactNode; required?: boolean; disabled?: boolean; id?: string; placeholder?: string; allowDecimals?: boolean;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const ref = useRef<HTMLInputElement>(null);
  const display = moneyInputDisplay(value ?? '');
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={inputId}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">Rp</span>
        <input
          ref={ref} id={inputId} className="input num pl-10 text-right" inputMode={allowDecimals ? 'decimal' : 'numeric'} autoComplete="off"
          aria-invalid={!!error} required={required} disabled={disabled} placeholder={placeholder} value={display}
          onChange={(e) => {
            let raw = e.target.value.replace(/\./g, '');
            if (!allowDecimals) raw = raw.replace(/,.*/, '');
            const el = e.target;
            const digitsBefore = e.target.value.slice(0, el.selectionStart ?? 0).replace(/[^\d,]/g, '').length;
            const next = parseMoneyInput(raw);
            onChange(next);
            // keep the caret after the same number of digits once separators are re-inserted
            requestAnimationFrame(() => {
              const shown = moneyInputDisplay(next);
              let count = 0; let pos = shown.length;
              for (let i = 0; i < shown.length; i++) { if (/[\d,]/.test(shown[i])) count++; if (count === digitsBefore) { pos = i + 1; break; } }
              if (digitsBefore === 0) pos = 0;
              ref.current?.setSelectionRange(pos, pos);
            });
          }}
        />
      </div>
    </Field>
  );
}

/** Date+time input in the company time zone. Value: ISO string (UTC instant) or ''. */
export function DateTimeInput({ label, value, onChange, error, required, disabled, hint }: {
  label?: ReactNode; value: string; onChange: (iso: string) => void; error?: string; required?: boolean; disabled?: boolean; hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} required={required} htmlFor={id} hint={hint}>
      <input id={id} type="datetime-local" className="input" value={toLocalInput(value)} required={required} disabled={disabled} aria-invalid={!!error}
        onChange={(e) => { const d = fromLocalInput(e.target.value); onChange(d ? d.toISOString() : ''); }} />
    </Field>
  );
}

export function DateInput({ label, value, onChange, error, required, hint, className }: { label?: ReactNode; value: string; onChange: (v: string) => void; error?: string; required?: boolean; hint?: ReactNode; className?: string }) {
  const id = useId();
  return (
    <Field label={label} error={error} required={required} htmlFor={id} hint={hint} className={className}>
      <input id={id} type="date" className="input" value={value} required={required} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/* ------------------------------------------------------------ combobox */

export interface Option { id: string; label: string; sub?: string; disabled?: boolean; data?: unknown }

/** Searchable select backed by an API lookup (customers, vehicles…). */
export function Combobox({ label, value, onChange, fetchOptions, queryKey, error, required, placeholder = 'Ketik untuk mencari…', footer, disabled, selectedLabel }: {
  label?: ReactNode; value: string | null; onChange: (id: string | null, opt?: Option) => void; fetchOptions: (q: string) => Promise<Option[]>;
  queryKey: unknown[]; error?: string; required?: boolean; placeholder?: string; footer?: ReactNode; disabled?: boolean; selectedLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const { activeCompanyId } = useAuth();
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const { data = [], isFetching } = useQuery({ queryKey: [...queryKey, activeCompanyId, debounced], queryFn: () => fetchOptions(debounced), enabled: open });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const choose = (o: Option) => { if (o.disabled) return; onChange(o.id, o); setOpen(false); setQ(''); };
  return (
    <Field label={label} error={error} required={required} htmlFor={id}>
      <div ref={wrap} className="relative">
        <button id={id} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-invalid={!!error}
          onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between text-left">
          <span className={cx('truncate', !value && 'text-muted/80')}>{value ? selectedLabel ?? 'Terpilih' : 'Pilih…'}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted" />
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-full min-w-[260px] overflow-hidden rounded-md border border-line bg-white shadow-lg">
            <div className="border-b border-line p-2">
              <input autoFocus className="input" placeholder={placeholder} value={q} aria-label="Cari"
                onChange={(e) => { setQ(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, data.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  if (e.key === 'Enter' && data[active]) { e.preventDefault(); choose(data[active]); }
                  if (e.key === 'Escape') setOpen(false);
                }} />
            </div>
            <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
              {isFetching && !data.length && <li className="flex justify-center py-4"><Spinner /></li>}
              {!isFetching && !data.length && <li className="px-3 py-3 text-sm text-muted">Tidak ditemukan</li>}
              {data.map((o, i) => (
                <li key={o.id} role="option" aria-selected={o.id === value} aria-disabled={o.disabled}
                  onMouseEnter={() => setActive(i)} onClick={() => choose(o)}
                  className={cx('flex cursor-pointer items-start gap-2 px-3 py-2 text-sm', i === active && 'bg-brand-soft', o.disabled && 'cursor-not-allowed opacity-50')}>
                  <Check className={cx('mt-0.5 size-4 shrink-0 text-brand', o.id !== value && 'invisible')} />
                  <span className="min-w-0"><span className="block truncate font-medium">{o.label}</span>{o.sub && <span className="block truncate text-[12.5px] text-muted">{o.sub}</span>}</span>
                </li>
              ))}
            </ul>
            {footer && <div className="border-t border-line p-2">{footer}</div>}
          </div>
        )}
      </div>
    </Field>
  );
}

/* ---------------------------------------------------------- plate badge */

/** Indonesian license plate rendered as a small black plate — the visual token for every vehicle. */
export function Plate({ children, size = 'md' }: { children: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span className={cx('inline-flex items-center rounded-[4px] border border-ink bg-ink font-semibold tracking-[0.06em] text-white whitespace-nowrap shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]',
      size === 'sm' ? 'px-1.5 py-px text-[11.5px]' : 'px-2 py-0.5 text-[12.5px]')}>{children}</span>
  );
}

/* ------------------------------------------------------------ uploads */

export function FileUpload({ kind, entityType, entityId, onUploaded, label = 'Unggah file', accept = 'image/jpeg,image/png,image/webp,application/pdf', compact }: {
  kind: string; entityType?: string; entityId?: string; onUploaded: (f: { id: string; originalName: string; mimeType: string }) => void; label?: string; accept?: string; compact?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="sr-only" aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) { toast.error('Ukuran file maksimal 5 MB'); return; }
          const fd = new FormData();
          fd.append('kind', kind);
          if (entityType) fd.append('entityType', entityType);
          if (entityId) fd.append('entityId', entityId);
          fd.append('file', file);
          setBusy(true);
          try { onUploaded(await api.upload('/files', fd)); toast.success('File diunggah'); } catch (err) { toast.error(err); } finally { setBusy(false); }
        }} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy}
        className={cx('inline-flex items-center gap-2 rounded-md border border-dashed border-line bg-white text-sm text-ink-2 hover:border-brand hover:text-brand disabled:opacity-60', compact ? 'h-9 px-3' : 'h-[42px] px-4')}>
        {busy ? <Spinner className="size-4" /> : <Upload className="size-4" />}{label}
      </button>
    </>
  );
}

export function FileLink({ id, name, onRemove }: { id: string; name?: string; onRemove?: () => void }) {
  const toast = useToast();
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-paper px-2 py-1 text-[13px]">
      <Paperclip className="size-3.5 shrink-0 text-muted" />
      <button type="button" className="truncate text-brand hover:underline" onClick={async () => {
        try { const url = await api.fileUrl(id); window.open(url, '_blank', 'noopener'); } catch (e) { toast.error(e); }
      }}>{name ?? 'Lihat lampiran'}</button>
      {onRemove && <button type="button" aria-label="Hapus lampiran" onClick={onRemove} className="text-muted hover:text-danger"><X className="size-3.5" /></button>}
    </span>
  );
}

/** Authenticated image (files are not public URLs). */
export function AuthImage({ fileId, alt, className }: { fileId: string | null | undefined; alt: string; className?: string }) {
  const { activeCompanyId } = useAuth();
  const { data } = useQuery({ queryKey: ['file', activeCompanyId, fileId], queryFn: () => api.fileUrl(fileId!), enabled: !!fileId, staleTime: 3600_000 });
  if (!fileId) return null;
  if (!data) return <div className={cx('skeleton', className)} />;
  return <img src={data} alt={alt} className={className} />;
}

export { FileText };
