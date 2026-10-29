"use client";
import { useEffect, useRef, useState } from "react";
import { PID_BY_KEY } from "@/lib/obd/pids";
import { lookupDtc } from "@/lib/kb/dtcs";
import { useDtcExplanation, useDtcLookups, type DtcLookup } from "@/lib/kb/dtc-client";
import type { Diagnosis } from "@/lib/agent/executor";
import type { WireLogEntry } from "@/lib/obd/transport";

/* ---------- Live gauges ---------- */

// Engine-off battery readings are fine down to 11 V; the 13+ V charging check only applies while it runs.
const engineOn = (all: Record<string, number | null>) => (all.rpm ?? 0) > 400;

const GAUGES: { key: string; label: string; digits: number; warn?: (v: number, all: Record<string, number | null>) => boolean; crit?: (v: number, all: Record<string, number | null>) => boolean }[] = [
  { key: "rpm", label: "RPM", digits: 0 },
  { key: "speed", label: "Speed", digits: 0 },
  { key: "coolant", label: "Coolant", digits: 0, warn: (v) => v > 105, crit: (v) => v > 112 },
  { key: "load", label: "Load", digits: 0 },
  { key: "stft1", label: "STFT B1", digits: 1, warn: (v) => Math.abs(v) > 10 },
  { key: "ltft1", label: "LTFT B1", digits: 1, warn: (v) => Math.abs(v) > 10, crit: (v) => Math.abs(v) > 20 },
  { key: "maf", label: "MAF", digits: 2 },
  { key: "throttle", label: "Throttle", digits: 0 },
  { key: "o2b1s1", label: "O2 up", digits: 2 },
  { key: "o2b1s2", label: "O2 down", digits: 2 },
  { key: "map", label: "MAP", digits: 0 },
  { key: "voltage", label: "Voltage", digits: 1, warn: (v, all) => engineOn(all) && v < 13 && v > 0, crit: (v, all) => (engineOn(all) ? v < 11.8 : v < 11) && v > 0 },
];

export function Gauges({ values }: { values: Record<string, number | null> }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {GAUGES.map((g) => {
        const v = values[g.key];
        const def = PID_BY_KEY[g.key];
        const state = v == null ? "none" : g.crit?.(v, values) ? "crit" : g.warn?.(v, values) ? "warn" : "ok";
        return (
          <div key={g.key} className="panel px-3 py-2" title={def.name}>
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted">
              {g.label}
              {state === "warn" && <span className="text-warning" aria-label="warning">▲</span>}
              {state === "crit" && <span className="text-critical" aria-label="critical">●</span>}
            </div>
            <div className="tabular mt-0.5 text-xl font-semibold text-ink">
              {v == null ? "–" : v.toFixed(g.digits)}
              <span className="ml-1 text-xs font-normal text-ink-2">{def.unit}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Trouble codes ---------- */

export function DtcPanel({ dtcs, vin }: { dtcs: { stored: string[]; pending: string[]; permanent: string[] } | null; vin?: string | null }) {
  const rows = dtcs ? [...dtcs.stored.map((c) => [c, "stored"]), ...dtcs.pending.map((c) => [c, "pending"]), ...dtcs.permanent.map((c) => [c, "permanent"])] : [];
  const found = useDtcLookups([...new Set(rows.map(([c]) => c))], vin);
  return (
    <div className="panel p-4">
      <h2 className="mb-2 text-sm font-medium text-ink">Trouble codes</h2>
      {!dtcs && <p className="text-sm text-muted">Not read yet.</p>}
      {dtcs && rows.length === 0 && <p className="text-sm text-good">✓ No codes stored or pending.</p>}
      <ul className="space-y-3">
        {rows.map(([c, kind], i) => (
          <DtcRow key={c + kind} code={c} kind={kind} db={found[c]} vin={vin} open={i === 0} />
        ))}
      </ul>
    </div>
  );
}

const SEVERITY_TEXT: Record<string, string> = { low: "text-good", moderate: "text-warning", high: "text-serious", critical: "text-critical" };

/** One code: the database meaning, plus the AI technician's explanation and fix for this make. */
function DtcRow({ code, kind, db, vin, open }: { code: string; kind: string; db?: DtcLookup; vin?: string | null; open: boolean }) {
  const info = lookupDtc(code);
  const ai = useDtcExplanation(code, vin);
  const x = ai.data;
  // A code the database can't name gets its name from the technician instead.
  const title = db && db.source !== "unknown" ? db.title : (x?.system ?? db?.title ?? info.title);
  return (
    <li className="rounded-lg border border-line bg-surface-2/50">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 p-3">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-sm text-ink">{code}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-ink">{title}</div>
            <div className="text-xs text-muted">
              {kind} · {db?.system ?? info.system}
              {db?.make ? ` · ${db.make} code` : ""}
              {x && (
                <>
                  {" · "}
                  <span className={SEVERITY_TEXT[x.severity]}>{x.severity}</span>
                  {` · ${x.safe_to_drive ? "safe to drive" : "not safe to drive"}`}
                </>
              )}
            </div>
            {x && <p className="mt-1 text-xs leading-relaxed text-ink-2">{x.meaning}</p>}
            {ai.loading && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" /> AI technician is looking this up…
              </p>
            )}
            {ai.error && <p className="mt-1 text-xs text-muted">Couldn&apos;t get an explanation: {ai.error}</p>}
          </div>
          {x && <span className="mt-0.5 text-xs text-muted transition-transform group-open:rotate-90">›</span>}
        </summary>
        {x && (
          <div className="space-y-3 border-t border-line px-3 py-3 text-xs text-ink-2">
            <p className="text-ink">{x.driving_advice}</p>
            <div>
              <div className="mb-1 font-medium text-muted">Likely causes</div>
              <ul className="space-y-0.5">
                {x.likely_causes.map((c) => (
                  <li key={c.cause} className="flex gap-2">
                    <span className={`w-12 shrink-0 ${c.likelihood === "high" ? "text-serious" : c.likelihood === "medium" ? "text-warning" : "text-muted"}`}>{c.likelihood}</span>
                    {c.cause}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 font-medium text-muted">How to fix</div>
              <ol className="list-decimal space-y-0.5 pl-4">
                {x.how_to_fix.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
            <div className="tabular text-muted">
              {x.diy === "shop" ? "Shop job" : `DIY: ${x.diy}`} · ${x.est_cost_usd.low}–${x.est_cost_usd.high}
            </div>
            {x.note && <p className="text-muted italic">{x.note}</p>}
          </div>
        )}
      </details>
    </li>
  );
}

/* ---------- Agent timeline ---------- */

export type TimelineItem =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "thinking"; text: string }
  | { id: number; kind: "text"; text: string }
  | { id: number; kind: "tool"; toolId: string; name: string; input: Record<string, unknown>; result?: unknown; isError?: boolean; ms?: number }
  | { id: number; kind: "error"; text: string };

function toolTitle(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "get_vehicle_info":
      return "Identifying vehicle";
    case "read_dtcs":
      return "Reading trouble codes";
    case "read_freeze_frame":
      return "Reading freeze frame";
    case "read_live_data":
      return `Reading ${(input.pids as string[] | undefined)?.join(", ") ?? "live data"}`;
    case "monitor_pids":
      return `Test: ${input.label ?? "monitoring"} · ${(input.pids as string[] | undefined)?.join(", ")} for ${input.duration_s}s`;
    case "request_driver_action":
      return `Test condition: ${String(input.action ?? "").replace("_", " ")}`;
    case "lookup_dtc":
      return `Knowledge base: ${input.code}`;
    case "clear_dtcs":
      return "Clearing codes";
    case "submit_diagnosis":
      return "Diagnosis submitted";
    default:
      return name;
  }
}

function resultLine(name: string, r: unknown): string | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if ("error" in o) return String(o.error);
  if (name === "read_dtcs") {
    const s = (o.stored as { code: string }[]).map((d) => d.code);
    const p = (o.pending as { code: string }[]).map((d) => d.code);
    return s.length || p.length ? `stored ${s.join(", ") || "none"} · pending ${p.join(", ") || "none"}` : "no codes";
  }
  if (name === "monitor_pids") {
    return (o.stats as { key: string; mean?: number; min?: number; max?: number; switches_per_s?: number }[])
      .map((s) => `${s.key} ${s.mean}${s.switches_per_s !== undefined ? ` (${s.switches_per_s} Hz)` : ` [${s.min}…${s.max}]`}`)
      .join(" · ");
  }
  if (name === "get_vehicle_info") return `VIN ${o.vin ?? "n/a"} · ${o.protocol}`;
  if (name === "lookup_dtc") return String(o.title ?? "");
  if (name === "read_freeze_frame") return o.triggerDtc ? `set by ${o.triggerDtc} at ${(o.values as Record<string, number>).rpm} rpm, ${(o.values as Record<string, number>).coolant}°C` : "none stored";
  if (name === "request_driver_action") return o.done ? "done" : "skipped";
  return null;
}

/** The model writes light markdown in chat answers; render **bold** and leave the rest as text. */
function renderBold(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

export function Timeline({ items, running }: { items: TimelineItem[]; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [items]);
  return (
    <div className="space-y-2">
      {items.map((it) => {
        if (it.kind === "user")
          return (
            <div key={it.id} className="flex justify-end pt-2">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap text-white">{it.text}</div>
            </div>
          );
        if (it.kind === "thinking")
          return (
            <div key={it.id} className="border-l-2 border-line pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted italic">
              {it.text}
            </div>
          );
        if (it.kind === "text")
          return (
            <div key={it.id} className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
              {renderBold(it.text)}
            </div>
          );
        if (it.kind === "error")
          return (
            <div key={it.id} className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-ink">
              <span className="text-critical">● Error:</span> {it.text}
            </div>
          );
        const pending = it.result === undefined;
        const line = pending ? null : resultLine(it.name, it.result);
        return (
          <details key={it.id} className="group rounded-lg border border-line bg-surface-2 px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
              <span className={pending ? "pulse text-accent" : it.isError ? "text-critical" : "text-good"}>{pending ? "◌" : it.isError ? "✕" : "✓"}</span>
              <span className="text-ink">{toolTitle(it.name, it.input)}</span>
              {it.ms !== undefined && <span className="tabular ml-auto text-xs text-muted">{(it.ms / 1000).toFixed(1)}s</span>}
            </summary>
            {line && <div className="tabular mt-1 pl-5 font-mono text-xs text-ink-2">{line}</div>}
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-page p-2 font-mono text-[11px] text-ink-2">
              {JSON.stringify({ input: it.input, result: it.result }, null, 2)}
            </pre>
          </details>
        );
      })}
      {running && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="pulse inline-block h-2 w-2 rounded-full bg-accent" /> working…
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

/* ---------- Diagnosis report ---------- */

const SEVERITY: Record<Diagnosis["severity"], { label: string; icon: string; color: string }> = {
  ok: { label: "No issues", icon: "✓", color: "var(--good)" },
  monitor: { label: "Monitor", icon: "◆", color: "var(--warning)" },
  repair_soon: { label: "Repair soon", icon: "▲", color: "var(--serious)" },
  stop_driving: { label: "Stop driving", icon: "●", color: "var(--critical)" },
};

export function DiagnosisReport({ d, onOpen }: { d: Diagnosis; onOpen?: () => void }) {
  const sev = SEVERITY[d.severity];
  return (
    <div className="panel p-5" id="report">
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: sev.color, color: d.severity === "monitor" ? "#0b0b0b" : "#fff" }}>
          {sev.icon} {sev.label}
        </span>
        <span className="text-xs text-ink-2">{d.safe_to_drive ? "Safe to drive" : "Not safe to drive"}</span>
        {onOpen && (
          <button onClick={onOpen} className="ml-auto text-xs text-accent hover:underline">
            Open report sheet
          </button>
        )}
      </div>
      <p className="mb-4 text-sm leading-relaxed text-ink">{d.summary}</p>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Root causes</h3>
      <ol className="space-y-3">
        {d.root_causes.map((rc, i) => (
          <li key={i} className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">
                {i + 1}. {rc.cause}
              </span>
              <span className="tabular ml-auto text-xs text-ink-2">{Math.round(rc.confidence * 100)}%</span>
            </div>
            <div className="mt-1.5 h-1 w-full rounded-full bg-page">
              <div className="h-1 rounded-full bg-accent" style={{ width: `${rc.confidence * 100}%` }} />
            </div>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-2">
              {rc.evidence.map((e, j) => (
                <li key={j}>{e}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-ink">
              <span className="text-muted">Fix: </span>
              {rc.fix}
            </div>
            <div className="tabular mt-1 text-xs text-muted">
              {rc.diy_difficulty === "shop" ? "Shop job" : `DIY: ${rc.diy_difficulty}`} · ${rc.est_cost_usd[0]}–${rc.est_cost_usd[1]}
              {rc.labor_hours !== undefined && ` · ${rc.labor_hours} h labor`}
            </div>
            {(rc.repair_steps?.length || rc.parts?.length || rc.tools_needed?.length) && (
              <details className="mt-2" open={i === 0}>
                <summary className="cursor-pointer text-xs text-accent">Repair plan</summary>
                {rc.repair_steps && rc.repair_steps.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink-2">
                    {rc.repair_steps.map((s, j) => (
                      <li key={j}>{s}</li>
                    ))}
                  </ol>
                )}
                {rc.parts && rc.parts.length > 0 && (
                  <table className="tabular mt-3 w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="pb-1 font-normal">Part</th>
                        <th className="pb-1 text-right font-normal">Qty</th>
                        <th className="pb-1 text-right font-normal">Each</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rc.parts.map((p, j) => (
                        <tr key={j} className="border-t border-line text-ink-2">
                          <td className="py-1">
                            {p.name}
                            {p.part_number && <span className="ml-1 font-mono text-muted">{p.part_number}</span>}
                          </td>
                          <td className="py-1 text-right">{p.qty}</td>
                          <td className="py-1 text-right">${p.est_price_usd}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-line text-ink">
                        <td className="py-1">Parts total</td>
                        <td />
                        <td className="py-1 text-right">${rc.parts.reduce((a, p) => a + p.qty * p.est_price_usd, 0).toFixed(0)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {rc.tools_needed && rc.tools_needed.length > 0 && (
                  <div className="mt-2 text-xs text-ink-2">
                    <span className="text-muted">Tools: </span>
                    {rc.tools_needed.join(", ")}
                  </div>
                )}
              </details>
            )}
          </li>
        ))}
      </ol>
      {d.ruled_out.length > 0 && (
        <>
          <h3 className="mt-4 mb-2 text-xs font-medium tracking-wide text-muted uppercase">Ruled out</h3>
          <ul className="space-y-1 text-xs text-ink-2">
            {d.ruled_out.map((r, i) => (
              <li key={i}>
                <span className="text-ink line-through decoration-muted">{r.cause}</span>: {r.why}
              </li>
            ))}
          </ul>
        </>
      )}
      {d.next_steps.length > 0 && (
        <>
          <h3 className="mt-4 mb-2 text-xs font-medium tracking-wide text-muted uppercase">Next steps</h3>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-2">
            {d.next_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/* ---------- Wire log ---------- */

export function WireLog({ log }: { log: WireLogEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel p-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-sm font-medium text-ink">
        ELM327 wire log <span className="text-xs text-muted">{open ? "hide" : `${log.length} lines`}</span>
      </button>
      {open && (
        <pre className="mt-2 h-56 overflow-auto rounded bg-page p-2 font-mono text-[11px] leading-snug">
          {log.slice(-300).map((l, i) => (
            <div key={i} className={l.dir === "tx" ? "text-accent" : "text-ink-2"}>
              {l.dir === "tx" ? "→ " : "← "}
              {l.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
