"use client";
import { useEffect, useRef, useState } from "react";
import { PID_BY_KEY } from "@/lib/obd/pids";
import { lookupDtc } from "@/lib/kb/dtcs";
import type { Diagnosis } from "@/lib/agent/executor";
import type { WireLogEntry } from "@/lib/obd/transport";

/* ---------- Live gauges ---------- */

const GAUGES: { key: string; label: string; digits: number; warn?: (v: number) => boolean; crit?: (v: number) => boolean }[] = [
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
  { key: "voltage", label: "Voltage", digits: 1, warn: (v) => v < 13 && v > 0, crit: (v) => v < 11.8 },
];

export function Gauges({ values }: { values: Record<string, number | null> }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {GAUGES.map((g) => {
        const v = values[g.key];
        const def = PID_BY_KEY[g.key];
        const state = v == null ? "none" : g.crit?.(v) ? "crit" : g.warn?.(v) ? "warn" : "ok";
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

export function DtcPanel({ dtcs }: { dtcs: { stored: string[]; pending: string[]; permanent: string[] } | null }) {
  const rows = dtcs ? [...dtcs.stored.map((c) => [c, "stored"]), ...dtcs.pending.map((c) => [c, "pending"]), ...dtcs.permanent.map((c) => [c, "permanent"])] : [];
  return (
    <div className="panel p-4">
      <h2 className="mb-2 text-sm font-medium text-ink">Trouble codes</h2>
      {!dtcs && <p className="text-sm text-muted">Not read yet.</p>}
      {dtcs && rows.length === 0 && <p className="text-sm text-good">✓ No codes stored or pending.</p>}
      <ul className="space-y-2">
        {rows.map(([c, kind]) => {
          const info = lookupDtc(c);
          return (
            <li key={c + kind} className="flex items-start gap-3">
              <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-sm text-ink">{c}</span>
              <div className="min-w-0">
                <div className="text-sm text-ink">{info.title}</div>
                <div className="text-xs text-muted">
                  {kind} · {info.system}
                  {"severity" in info ? ` · ${info.severity}` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- Agent timeline ---------- */

export type TimelineItem =
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
      return `Driver: ${String(input.action ?? "").replace("_", " ")}`;
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

export function Timeline({ items, running }: { items: TimelineItem[]; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [items]);
  return (
    <div className="space-y-2">
      {items.map((it) => {
        if (it.kind === "thinking")
          return (
            <div key={it.id} className="border-l-2 border-line pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted italic">
              {it.text}
            </div>
          );
        if (it.kind === "text")
          return (
            <div key={it.id} className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
              {it.text}
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

export function DiagnosisReport({ d }: { d: Diagnosis }) {
  const sev = SEVERITY[d.severity];
  return (
    <div className="panel p-5" id="report">
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: sev.color, color: d.severity === "monitor" ? "#0b0b0b" : "#fff" }}>
          {sev.icon} {sev.label}
        </span>
        <span className="text-xs text-ink-2">{d.safe_to_drive ? "Safe to drive" : "Not safe to drive"}</span>
        <button onClick={() => window.print()} className="ml-auto text-xs text-accent hover:underline">
          Save PDF
        </button>
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

/* ---------- Modals ---------- */

export function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="panel w-full max-w-md p-6 shadow-2xl">
        <h2 className="mb-3 text-base font-semibold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function DriverActionModal({ action, instruction, simulated, onDone }: { action: string; instruction: string; simulated: boolean; onDone: (ok: boolean) => void }) {
  const [left, setLeft] = useState(3);
  useEffect(() => {
    if (!simulated) return;
    const iv = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(iv);
  }, [simulated]);
  useEffect(() => {
    if (simulated && left <= 0) onDone(true);
  }, [left, simulated, onDone]);
  return (
    <Modal title="The technician needs your help">
      <div className="mb-2 inline-block rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-accent">{action}</div>
      <p className="mb-5 text-sm leading-relaxed text-ink">{instruction}</p>
      {simulated && <p className="mb-4 text-xs text-muted">Simulator: the virtual driver will do this in {Math.max(0, left)}s.</p>}
      <div className="flex justify-end gap-2">
        <button onClick={() => onDone(false)} className="rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
          Can&apos;t do this
        </button>
        <button onClick={() => onDone(true)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white">
          Done
        </button>
      </div>
    </Modal>
  );
}

export function ConfirmClearModal({ reason, onDone }: { reason: string; onDone: (ok: boolean) => void }) {
  return (
    <Modal title="Clear trouble codes?">
      <p className="mb-2 text-sm text-ink">{reason}</p>
      <p className="mb-5 text-xs text-muted">This turns off the check engine light, erases freeze-frame data and resets readiness monitors. The car may fail an emissions inspection until monitors complete.</p>
      <div className="flex justify-end gap-2">
        <button onClick={() => onDone(false)} className="rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
          Keep codes
        </button>
        <button onClick={() => onDone(true)} className="rounded-lg bg-critical px-3 py-1.5 text-sm font-medium text-white">
          Clear codes
        </button>
      </div>
    </Modal>
  );
}
