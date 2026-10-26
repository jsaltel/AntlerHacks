"use client";
import { useEffect, useRef, useState } from "react";

export interface XYSeries {
  label: string;
  color: string;
  dashed?: boolean;
  points: [number, number][];
}

interface Props {
  title: string;
  unit: string;
  xUnit?: string;
  series: XYSeries[];
  height?: number;
  /** Horizontal limit line, e.g. an EGT or knock-margin threshold. */
  limit?: { value: number; label: string };
  yMin?: number;
}

const PAD = { l: 40, r: 12, t: 8, b: 22 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Static x/y line chart for curves against rpm (dyno sheets, margins). */
export function XYChart({ title, unit, xUnit = "rpm", series, height = 200, limit, yMin }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(400);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]).concat(limit ? [limit.value] : []);
  const x0 = xs.length ? Math.min(...xs) : 0;
  const x1 = xs.length ? Math.max(...xs) : 1;
  const lo = yMin ?? Math.min(0, ...ys);
  const hi = niceMax(Math.max(...ys, lo + 1) * 1.05);
  const iw = Math.max(10, w - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const x = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * iw;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;
  const yTicks = [lo, lo + (hi - lo) / 2, hi];
  const xTicks = [x0, x0 + (x1 - x0) / 2, x1];
  const hx = hover === null || !xs.length ? null : xs.reduce((b, v) => (Math.abs(x(v) - hover) < Math.abs(x(b) - hover) ? v : b), xs[0]);

  return (
    <div className="panel p-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <div className="flex flex-wrap gap-3 text-xs text-ink-2">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <svg width="14" height="4" aria-hidden>
                <line x1="0" x2="14" y1="2" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "3 2" : undefined} />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div ref={box} className="relative">
        <svg width={w} height={height} onMouseMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)} onMouseLeave={() => setHover(null)} role="img" aria-label={title}>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--muted)" className="tabular">
                {Math.round(v)}
              </text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text key={v} x={x(v)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--muted)" className="tabular">
              {Math.round(v)}
              {v === x1 ? ` ${xUnit}` : ""}
            </text>
          ))}
          {limit && (
            <g>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(limit.value)} y2={y(limit.value)} stroke="var(--critical)" strokeDasharray="4 3" opacity={0.7} />
              <text x={w - PAD.r} y={y(limit.value) - 4} textAnchor="end" fontSize={10} fill="var(--critical)">
                {limit.label}
              </text>
            </g>
          )}
          {series.map((s) => (
            <path
              key={s.label}
              d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
            />
          ))}
          {hx !== null && <line x1={x(hx)} x2={x(hx)} y1={PAD.t} y2={height - PAD.b} stroke="var(--axis)" />}
        </svg>
        {hx !== null && (
          <div className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs shadow-lg" style={{ left: Math.min(x(hx) + 10, w - 150) }}>
            <div className="text-muted tabular">
              {Math.round(hx)} {xUnit}
            </div>
            {series.map((s) => {
              const p = s.points.find((q) => q[0] === hx);
              return (
                <div key={s.label} className="tabular flex items-center gap-1.5 text-ink">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}: {p ? p[1].toFixed(1) : "–"} {unit}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
