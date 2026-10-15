import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../lib/format';

/** Compact money axis label: 1.250.000 → 1,3 jt */
export function shortMoney(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return v.toLocaleString('id-ID');
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export interface Series { key: string; label: string; color: string }

/** Grouped bar chart (SVG, no library). Values are money strings. */
export function BarChart({ data, series, labelFormat, height = 220 }: {
  data: Record<string, string | number>[]; series: Series[]; labelFormat?: (label: string) => string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(600);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setMeasured(Math.floor(e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  // Draw at real pixel size (text never scales); scroll horizontally only when bars would get too thin.
  const W = Math.max(measured, data.length * (series.length * 5 + 6) + 60);
  const H = height; const padL = 52; const padB = 26; const padT = 10;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const plotH = H - padB - padT; const plotW = W - padL - 8;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(18, (band - 6) / series.length));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 58))));
  return (
    <div className="relative">
      <div ref={box} className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={series.map((s) => s.label).join(' dan ')}>
          {ticks.map((t) => {
            const y = padT + plotH - (t / max) * plotH;
            return <g key={t}><line x1={padL} x2={W - 4} y1={y} y2={y} stroke="#dde3ea" strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10.5" fill="#5b6878">{shortMoney(t)}</text></g>;
          })}
          {data.map((d, i) => {
            const x0 = padL + i * band + (band - barW * series.length) / 2;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={padL + i * band} y={padT} width={band} height={plotH} fill={hover === i ? '#e8eff8' : 'transparent'} />
                {series.map((s, j) => {
                  const v = Math.max(0, Number(d[s.key]) || 0);
                  const h = (v / max) * plotH;
                  return <rect key={s.key} x={x0 + j * barW} y={padT + plotH - h} width={barW - 1.5} height={Math.max(h, v > 0 ? 1 : 0)} rx={1.5} fill={s.color} />;
                })}
                {i % every === 0 && <text x={padL + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#5b6878">{labelFormat ? labelFormat(String(d.label)) : String(d.label)}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-md border border-line bg-white px-3 py-2 text-[12.5px] shadow-md">
          <div className="mb-1 font-medium">{labelFormat ? labelFormat(String(data[hover].label)) : String(data[hover].label)}</div>
          {series.map((s) => <div key={s.key} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: s.color }} /><span className="text-muted">{s.label}</span><span className="num ml-auto pl-3 font-medium">{formatMoney(String(data[hover][s.key]))}</span></div>)}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-[12.5px] text-muted">
        {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}

/** Horizontal ranked bars (top vehicles / customers). */
export function RankBars({ rows, valueKey = 'revenue', labelKey = 'name', subKey }: { rows: Record<string, string | number>[]; valueKey?: string; labelKey?: string; subKey?: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="min-w-0 truncate">{String(r[labelKey])}{subKey && <span className="ml-1.5 text-muted">{String(r[subKey])}</span>}</span>
            <span className="num shrink-0 font-medium">{formatMoney(String(r[valueKey]))}</span>
          </div>
          <div className="h-2 rounded-full bg-paper"><div className="h-2 rounded-full bg-teal" style={{ width: `${(Number(r[valueKey]) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
