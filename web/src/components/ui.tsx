import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, AlertTriangle, Inbox } from 'lucide-react';
import type { Tone } from '../lib/labels';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------------------------------------------------------------- button */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark border-transparent',
  teal: 'bg-teal text-white hover:brightness-95 border-transparent',
  secondary: 'bg-white text-ink border-line hover:bg-paper',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-ink/5',
  danger: 'bg-white text-danger border-danger/40 hover:bg-danger-soft',
};

export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-9 px-3 text-[13.5px]' : 'h-[42px] px-4 text-[14.5px]',
        VARIANT[variant], className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={cx('inline-flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-ink/5 disabled:opacity-40', className)}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- fields */

export function Field({ label, error, hint, required, children, className, htmlFor }: { label?: ReactNode; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      {label && <label className="label" htmlFor={htmlFor}>{label}{required && <span className="text-danger" aria-hidden> *</span>}</label>}
      {children}
      {error ? <p className="mt-1 text-[12.5px] text-danger" role="alert">{error}</p> : hint ? <p className="mt-1 text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ label, error, hint, className, required, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={rest.id ?? id}>
      <input id={rest.id ?? id} className="input" aria-invalid={!!error} required={required} {...rest} />
    </Field>
  );
}

export function Select({ label, error, hint, className, children, required, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={rest.id ?? id}>
      <select id={rest.id ?? id} className="input pr-8" aria-invalid={!!error} required={required} {...rest}>{children}</select>
    </Field>
  );
}

export function Textarea({ label, error, hint, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} className={className} htmlFor={rest.id ?? id}>
      <textarea id={rest.id ?? id} className="input min-h-[84px]" aria-invalid={!!error} {...rest} />
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={cx('flex items-start gap-2.5 py-1', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type="checkbox" className="mt-0.5 size-[18px] shrink-0 accent-brand" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">{label}{hint && <span className="block text-[12.5px] text-muted">{hint}</span>}</span>
    </label>
  );
}

/* ---------------------------------------------------------------- badge */

const TONE: Record<Tone, string> = {
  neutral: 'bg-ink/6 text-ink-2 ring-ink/10',
  brand: 'bg-brand-soft text-brand ring-brand/15',
  teal: 'bg-teal-soft text-teal ring-teal/20',
  warn: 'bg-warn-soft text-warn ring-warn/20',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  muted: 'bg-paper text-muted ring-line',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset whitespace-nowrap', TONE[tone], className)}>{children}</span>;
}

export function StatusBadge({ map, value }: { map: Record<string, [string, Tone]>; value: string | null | undefined }) {
  if (!value) return null;
  const [label, tone] = map[value] ?? [value, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

/* ---------------------------------------------------------------- layout bits */

export function Card({ children, className, title, actions, bodyClassName }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; bodyClassName?: string }) {
  return (
    <section className={cx('card min-w-0', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName ?? 'p-4'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-[24px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton h-4', className)} aria-hidden />;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className="mb-3 text-muted">{icon ?? <Inbox className="size-9" strokeWidth={1.4} />}</div>
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <AlertTriangle className="mb-2 size-8 text-danger" strokeWidth={1.5} />
      <p className="font-medium">Data tidak dapat dimuat</p>
      <p className="mt-1 text-sm text-muted">{(error as Error)?.message}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>Muat ulang</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            value === t.value ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function DefinitionList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12.5px] text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-[14.5px] text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------------------------------------------------------- modal */

export function Modal({ open, onClose, title, children, footer, size = 'md', dismissable = true }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks in refs so the effect below runs only when the modal opens/closes.
  // (Depending on `onClose` re-ran it on every keystroke and stole focus back to the first field.)
  const onCloseRef = useRef(onClose);
  const dismissRef = useRef(dismissable);
  onCloseRef.current = onClose;
  dismissRef.current = dismissable;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissRef.current) onCloseRef.current();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button[data-autofocus]')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-ink/45" onClick={dismissable ? onClose : undefined} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={cx('relative flex max-h-[92dvh] w-full flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl', width)}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          {dismissable && <IconButton label="Tutup" onClick={onClose} className="-mr-2"><X className="size-5" /></IconButton>}
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------- confirm dialog */

interface ConfirmOpts { title: string; message: ReactNode; confirmLabel?: string; tone?: 'primary' | 'danger'; reason?: { label: string; required?: boolean } }
type ConfirmFn = (o: ConfirmOpts) => Promise<{ ok: boolean; reason: string }>;
const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (r: { ok: boolean; reason: string }) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => { setReason(''); setState({ ...o, resolve }); }), []);
  const close = (ok: boolean) => { state?.resolve({ ok, reason }); setState(null); };
  const blocked = !!state?.reason?.required && reason.trim().length < 3;
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title ?? ''} size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => close(false)}>Batal</Button>
          <Button data-autofocus variant={state?.tone === 'danger' ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)}>{state?.confirmLabel ?? 'Lanjutkan'}</Button>
        </>}>
        <div className="space-y-3 text-[14.5px] text-ink-2">
          <div>{state?.message}</div>
          {state?.reason && <Textarea label={state.reason.label} required={state.reason.required} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => {
  const c = useContext(ConfirmCtx);
  if (!c) throw new Error('ConfirmProvider missing');
  return c;
};

/* ---------------------------------------------------------------- stat */

export function Stat({ label, value, sub, tone, onClick, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; onClick?: () => void; icon?: ReactNode }) {
  const accent = tone === 'danger' ? 'text-danger' : tone === 'teal' ? 'text-teal' : tone === 'warn' ? 'text-warn' : 'text-ink';
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick}
      className={cx('card flex min-w-0 flex-col items-start px-4 py-3.5 text-left', onClick && 'transition-colors hover:border-brand/50 hover:bg-brand-soft/30')}>
      <span className="flex items-center gap-1.5 text-[13px] text-muted">{icon}{label}</span>
      <span className={cx('num mt-1 truncate text-[21px] font-semibold leading-tight tracking-[-0.01em]', accent)} style={{ maxWidth: '100%' }}>{value}</span>
      {sub && <span className="mt-0.5 text-[12.5px] text-muted">{sub}</span>}
    </Comp>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} aria-label="Memuat" />;
}
