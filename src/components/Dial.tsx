/** Analog gauge: a 270° arc with a needle, an optional red zone and the reading in the middle. */
export function Dial({ value, max, label, unit, redFrom, ticks = 0 }: { value: number | null; max: number; label: string; unit: string; redFrom?: number; ticks?: number }) {
  const R = 62;
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const pt = (f: number, r = R) => [80 + r * Math.cos(start + sweep * f), 80 + r * Math.sin(start + sweep * f)];
  const arc = (f0: number, f1: number) => {
    const [x0, y0] = pt(f0);
    const [x1, y1] = pt(f1);
    return `M${x0},${y0} A${R},${R} 0 ${sweep * (f1 - f0) > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
  };
  const v = value ?? 0;
  const f = Math.max(0, Math.min(1, v / max));
  const [nx, ny] = pt(f, R - 10);
  const hot = redFrom !== undefined && v >= redFrom;
  return (
    <svg viewBox="0 0 160 150" className="w-full max-w-[220px]" role="img" aria-label={`${label} ${value === null ? "no reading" : `${Math.round(v)} ${unit}`}`}>
      <path d={arc(0, 1)} fill="none" stroke="var(--surface-2)" strokeWidth={10} strokeLinecap="round" />
      {redFrom !== undefined && <path d={arc(redFrom / max, 1)} fill="none" stroke="var(--critical)" strokeWidth={10} opacity={0.55} />}
      {value !== null && <path d={arc(0, Math.max(0.001, f))} fill="none" stroke={hot ? "var(--critical)" : "var(--accent)"} strokeWidth={10} strokeLinecap="round" />}
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const [x0, y0] = pt(i / ticks, R - 9);
        const [x1, y1] = pt(i / ticks, R - 15);
        const [tx, ty] = pt(i / ticks, R - 24);
        return (
          <g key={i}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--muted)" strokeWidth={1.5} />
            <text x={tx} y={ty + 3} textAnchor="middle" fontSize={8} fill="var(--muted)" className="tabular">
              {Math.round((max / ticks) * i / (max >= 1000 ? 1000 : 1))}
            </text>
          </g>
        );
      })}
      {value !== null && (
        <>
          <line x1={80} y1={80} x2={nx} y2={ny} stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={80} cy={80} r={4} fill="var(--ink)" />
        </>
      )}
      <text x={80} y={114} textAnchor="middle" fontSize={22} fontWeight={600} fill="var(--ink)" className="tabular">
        {value === null ? "–" : Math.round(v)}
      </text>
      <text x={80} y={130} textAnchor="middle" fontSize={10} fill="var(--muted)">
        {label} · {unit}
      </text>
    </svg>
  );
}

/** RPM and speed dials for the live engine. */
export function DialCluster({ rpm, speed }: { rpm: number | null | undefined; speed: number | null | undefined }) {
  return (
    <div className="panel grid grid-cols-2 items-center justify-items-center gap-2 px-4 py-3">
      <Dial value={rpm ?? null} max={8000} label="RPM" unit="rpm" redFrom={6500} ticks={8} />
      <Dial value={speed ?? null} max={240} label="Speed" unit="km/h" ticks={6} />
    </div>
  );
}
