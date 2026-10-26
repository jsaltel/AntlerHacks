"use client";
import { useState } from "react";

interface Props {
  table: number[][];
  stock: number[][];
  rpmAxis: number[];
  loadAxis: number[];
  unit: string;
  digits?: number;
  /** Lower values drawn hotter (AFR: richer = more color). */
  invert?: boolean;
  disabled?: boolean;
  onEdit: (load: number, rpm: number, value: number) => void;
}

/** Editable calibration table, 100% load on top like most tuning software. Changed cells are outlined. */
export function MapTable({ table, stock, rpmAxis, loadAxis, unit, digits = 1, invert, disabled, onEdit }: Props) {
  const [editing, setEditing] = useState<[number, number] | null>(null);
  const flat = table.flat();
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const rows = loadAxis.map((l, i) => [l, i] as const).reverse();
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full border-separate border-spacing-0.5 text-[11px]">
        <thead>
          <tr>
            <th className="pr-1 text-right font-normal text-muted">load \ rpm</th>
            {rpmAxis.map((r) => (
              <th key={r} className="px-0.5 font-normal text-muted">
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([load, li]) => (
            <tr key={load}>
              <th className="pr-1 text-right font-normal text-muted">{load}%</th>
              {rpmAxis.map((rpm, ri) => {
                const v = table[li][ri];
                const delta = v - stock[li][ri];
                const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
                const heat = invert ? 1 - t : t;
                const isEditing = editing?.[0] === li && editing?.[1] === ri;
                return (
                  <td
                    key={rpm}
                    className="rounded-[3px] p-0 text-center"
                    style={{
                      background: `color-mix(in srgb, var(--series-2) ${Math.round(heat * 55) + 8}%, var(--surface-2))`,
                      outline: Math.abs(delta) > 0.05 ? `1.5px solid ${delta > 0 ? "var(--warning)" : "var(--accent)"}` : undefined,
                      outlineOffset: -1.5,
                    }}
                    title={`${rpm} rpm, ${load}% load: ${v.toFixed(digits)} ${unit} (stock ${stock[li][ri].toFixed(digits)}, ${delta >= 0 ? "+" : ""}${delta.toFixed(digits)})`}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        defaultValue={v}
                        className="w-11 bg-page text-center text-ink outline-none"
                        onBlur={(e) => {
                          const n = parseFloat(e.target.value);
                          if (Number.isFinite(n)) onEdit(li, ri, n);
                          setEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      <button disabled={disabled} onClick={() => setEditing([li, ri])} className="w-full px-0.5 py-1 text-ink disabled:cursor-default">
                        {v.toFixed(digits)}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-muted">
        Click a cell to edit. Outlined cells differ from stock (<span className="text-warning">higher</span> / <span className="text-accent">lower</span>).
      </p>
    </div>
  );
}
