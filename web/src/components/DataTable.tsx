import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { api, type Paged } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx, EmptyState, ErrorState, Skeleton } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  hideBelow?: 'sm' | 'md' | 'lg';
}

/** Server-side list state, mirrored in the URL so links (e.g. from dashboard cards) can pre-filter. */
export function useListState(defaults: Record<string, string> = {}) {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? defaults[k] ?? '';
  const [search, setSearch] = useState(get('q'));
  useEffect(() => {
    const t = setTimeout(() => { if (search !== get('q')) set({ q: search, page: '' }); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '' || v === defaults[k]) next.delete(k); else next.set(k, v); }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const all = useMemo(() => {
    const o: Record<string, string> = { ...defaults };
    params.forEach((v, k) => { o[k] = v; });
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  return { params: all, get, set, search, setSearch };
}

export function useList<T>(url: string, state: ReturnType<typeof useListState>, extra: Record<string, unknown> = {}) {
  const { activeCompanyId } = useAuth();
  const query = { page: 1, pageSize: 20, ...state.params, ...extra };
  return useQuery({
    queryKey: [url, activeCompanyId, query],
    queryFn: () => api.get<Paged<T>>(url, query),
    placeholderData: keepPreviousData,
  });
}

export function SearchBox({ value, onChange, placeholder = 'Cari…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="input pl-9" />
    </div>
  );
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export function DataTable<T extends { id?: string | number }>({ columns, query, state, onRowClick, empty, mobileCard, footer }: {
  columns: Column<T>[];
  query: ReturnType<typeof useList<T>>;
  state: ReturnType<typeof useListState>;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  mobileCard?: (row: T) => ReactNode;
  footer?: ReactNode;
}) {
  const { data, isLoading, isError, error, refetch, isFetching } = query;
  const sort = state.get('sort'); const dir = state.get('dir') || 'desc';
  const toggleSort = (k: string) => state.set({ sort: k, dir: sort === k && dir === 'desc' ? 'asc' : 'desc' });
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  const rows = data?.data ?? [];

  return (
    <div className={cx(isFetching && !isLoading && 'opacity-70 transition-opacity')}>
      {mobileCard && (
        <div className="divide-y divide-line md:hidden">
          {isLoading ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="space-y-2 p-4"><Skeleton className="w-2/3" /><Skeleton className="w-1/3" /></div>)
            : rows.map((r, i) => (
              <div key={r.id ?? i} role={onRowClick ? 'button' : undefined} tabIndex={onRowClick ? 0 : undefined}
                onClick={() => onRowClick?.(r)} onKeyDown={(e) => { if (e.key === 'Enter') onRowClick?.(r); }}
                className={cx('px-4 py-3', onRowClick && 'cursor-pointer active:bg-paper')}>{mobileCard(r)}</div>
            ))}
        </div>
      )}
      <div className={cx('overflow-x-auto', mobileCard && 'hidden md:block')}>
        <table className="table-base">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.hideBelow && hide[c.hideBelow], c.className)}
                  aria-sort={c.sortKey && sort === c.sortKey ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortKey ? (
                    <button type="button" onClick={() => toggleSort(c.sortKey!)} className={cx('inline-flex items-center gap-1 hover:text-ink', c.align === 'right' && 'flex-row-reverse')}>
                      {c.header}
                      {sort === c.sortKey && (dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key} className={cx(c.hideBelow && hide[c.hideBelow])}><Skeleton className="w-4/5" /></td>)}</tr>
            )) : rows.map((r, i) => (
              <tr key={r.id ?? i} onClick={() => onRowClick?.(r)} className={cx(onRowClick && 'cursor-pointer')}
                tabIndex={onRowClick ? 0 : undefined} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick?.(r); }}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.align === 'right' && 'num text-right', c.align === 'center' && 'text-center', c.hideBelow && hide[c.hideBelow], c.className)}>
                    {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && rows.length > 0 && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {!isLoading && rows.length === 0 && (empty ?? <EmptyState title="Belum ada data" description="Ubah filter atau kata kunci pencarian." />)}
      {data && data.total > 0 && <Pagination data={data} onPage={(p) => state.set({ page: String(p) })} />}
    </div>
  );
}

export function Pagination({ data, onPage }: { data: Paged<unknown>; onPage: (p: number) => void }) {
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, data.page * data.pageSize);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] text-muted" aria-label="Halaman">
      <span className="num">{from}–{to} dari {data.total.toLocaleString('id-ID')}</span>
      <div className="flex items-center gap-1">
        <button type="button" className="inline-flex size-9 items-center justify-center rounded-md hover:bg-ink/5 disabled:opacity-35" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /></button>
        <span className="num px-1">{data.page} / {data.totalPages}</span>
        <button type="button" className="inline-flex size-9 items-center justify-center rounded-md hover:bg-ink/5 disabled:opacity-35" disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)} aria-label="Halaman berikutnya"><ChevronRight className="size-4" /></button>
      </div>
    </nav>
  );
}
