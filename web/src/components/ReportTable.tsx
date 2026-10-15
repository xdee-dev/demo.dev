import type { Row } from '../lib/types';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import { MAINTENANCE_STATUS, PAYMENT_STATUS, RENTAL_STATUS, RESERVATION_STATUS, VEHICLE_STATUS } from '../lib/labels';
import { cx } from './ui';

const STATUS_ALL: Record<string, string> = Object.fromEntries(
  [RENTAL_STATUS, RESERVATION_STATUS, PAYMENT_STATUS, VEHICLE_STATUS, MAINTENANCE_STATUS].flatMap((m) => Object.entries(m).map(([k, [l]]) => [k, l])),
);

export function formatCell(v: unknown, type: string): string {
  if (v === null || v === undefined || v === '') return type === 'money' ? '' : '—';
  switch (type) {
    case 'money': return formatMoney(String(v));
    case 'number': return formatNumber(v as number);
    case 'percent': return `${String(v).replace('.', ',')}%`;
    case 'date': return formatDate(String(v));
    case 'datetime': return formatDateTime(String(v));
    case 'status': return STATUS_ALL[String(v)] ?? String(v);
    default: return String(v);
  }
}

export function ReportTable({ report, compact }: { report: Row; compact?: boolean }) {
  const cols = report.columns as { key: string; label: string; type: string }[];
  const numeric = (t: string) => ['money', 'number', 'percent'].includes(t);
  return (
    <table className={cx('table-base', compact && 'text-[11px] [&_td]:whitespace-normal [&_td]:px-1.5 [&_td]:py-1 [&_th]:whitespace-normal [&_th]:px-1.5 [&_th]:py-1')}>
      <thead><tr>{cols.map((c) => <th key={c.key} className={cx(numeric(c.type) && 'text-right')}>{c.label}</th>)}</tr></thead>
      <tbody>
        {(report.rows as Row[]).map((r, i) => (
          <tr key={i} className={cx(r.section && 'bg-paper', (r.bold || r.section) && 'font-semibold')}>
            {cols.map((c) => <td key={c.key} className={cx(numeric(c.type) && 'num text-right whitespace-nowrap', c.type === 'datetime' && 'whitespace-nowrap')}>{formatCell(r[c.key], c.type)}</td>)}
          </tr>
        ))}
      </tbody>
      {report.totals && <tfoot><tr className="font-semibold">{cols.map((c) => <td key={c.key} className={cx('border-t-2 border-ink/20 bg-paper', numeric(c.type) && 'num text-right whitespace-nowrap')}>{c.key in report.totals ? formatCell(report.totals[c.key], c.type === 'percent' ? 'percent' : c.type) : ''}</td>)}</tr></tfoot>}
    </table>
  );
}
