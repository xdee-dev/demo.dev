import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { ApiError } from '../lib/api';

interface Toast { id: number; type: 'success' | 'error'; message: string }
const Ctx = createContext<{ success: (m: string) => void; error: (e: unknown) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((type: Toast['type'], message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, type, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), type === 'error' ? 7000 : 3500);
  }, []);
  const api = {
    success: useCallback((m: string) => push('success', m), [push]),
    error: useCallback((e: unknown) => push('error', e instanceof ApiError || e instanceof Error ? e.message : String(e)), [push]),
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border bg-white px-3.5 py-3 text-sm shadow-lg ${t.type === 'error' ? 'border-danger/30' : 'border-teal/30'}`}>
            {t.type === 'error' ? <AlertCircle className="mt-px size-[18px] shrink-0 text-danger" /> : <CheckCircle2 className="mt-px size-[18px] shrink-0 text-teal" />}
            <span className="flex-1 text-ink">{t.message}</span>
            <button type="button" aria-label="Tutup notifikasi" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} className="text-muted hover:text-ink"><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('ToastProvider missing');
  return c;
};
