"use client";
import { useEffect, useRef, useState } from "react";

export interface Series {
  key: string;
  label: string;
  color: string;
}

interface Props {
  title: string;
  unit: string;
  series: Series[];
  data: { t: number; values: Record<string, number | null> }[];
  yMin: number;
  yMax: number;
  /** Optional reference line, e.g. 0% trim or 0.45 V O2 midpoint. */
  refValue?: number;
  windowS?: number;
}

const H = 150;
const PAD = { l: 34, r: 12, t: 8, b: 20 };

export function LineChart({ title, unit, series, data, yMin, yMax, refValue: refLine, windowS = 60 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(400);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const now = data.length ? data[data.length - 1].t : Date.now();
  const t0 = now - windowS * 1000;
  const pts = data.filter((d) => d.t >= t0);
  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (windowS * 1000)) * iw;
  const y = (v: number) => PAD.t + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * ih;
  const ticks = [yMin, (yMin + yMax) / 2, yMax];

  const path = (key: string) => {
    let d = "";
    let pen = false;
    for (const p of pts) {
      const v = p.values[key];
      if (v === undefined) continue; // not sampled this cycle
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const hovered = hover !== null && pts.length ? pts.reduce((best, p) => (Math.abs(x(p.t) - hover) < Math.abs(x(best.t) - hover) ? p : best), pts[0]) : null;

  return (
    <div className="panel p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <div className="flex gap-3 text-xs text-ink-2">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div ref={box} className="relative">
        <svg
          width={w}
          height={H}
          onMouseMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`${title} over the last ${windowS} seconds`}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--muted)" className="tabular">
                {Number.isInteger(v) ? v : v.toFixed(2)}
              </text>
            </g>
          ))}
          {refLine !== undefined && <line x1={PAD.l} x2={w - PAD.r} y1={y(refLine)} y2={y(refLine)} stroke="var(--axis)" strokeDasharray="3 3" />}
          <text x={w - PAD.r} y={H - 4} textAnchor="end" fontSize={10} fill="var(--muted)">now</text>
          <text x={PAD.l} y={H - 4} fontSize={10} fill="var(--muted)">-{windowS}s</text>
          {series.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hovered && (
            <g>
              <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--axis)" />
              {series.map((s) =>
                hovered.values[s.key] != null ? (
                  <circle key={s.key} cx={x(hovered.t)} cy={y(hovered.values[s.key]!)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                ) : null,
              )}
            </g>
          )}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs shadow-lg"
            style={{ left: Math.min(x(hovered.t) + 10, w - 140) }}
          >
            <div className="text-muted">{((hovered.t - now) / 1000).toFixed(1)}s</div>
            {series.map((s) => (
              <div key={s.key} className="tabular flex items-center gap-1.5 text-ink">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}: {hovered.values[s.key]?.toFixed(2) ?? "–"} {unit}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
