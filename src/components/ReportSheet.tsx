"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Diagnosis } from "@/lib/agent/executor";
import { useDtcExplanation, useDtcLookups, type DtcLookup } from "@/lib/kb/dtc-client";
import { useRealParts } from "@/lib/kb/parts-client";
import { brandFromVin, brandLabel } from "@/lib/kb/vin";
import { useDiagnostics } from "./DiagnosticsProvider";

/*
 * The diagnosis as a printable repair-order sheet, opened in a window over the app.
 * It is deliberately light (paper) whatever the app theme, so it reads and prints like a document.
 */

const SEVERITY: Record<Diagnosis["severity"], { label: string; color: string; tint: string }> = {
  ok: { label: "No issues found", color: "#15803d", tint: "#f0fdf4" },
  monitor: { label: "Monitor", color: "#b45309", tint: "#fffbeb" },
  repair_soon: { label: "Repair soon", color: "#c2410c", tint: "#fff7ed" },
  stop_driving: { label: "Stop driving", color: "#b91c1c", tint: "#fef2f2" },
};
const DIFFICULTY: Record<string, string> = { easy: "Easy DIY", moderate: "Moderate DIY", hard: "Hard DIY", shop: "Shop job" };

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const partsTotal = (rc: Diagnosis["root_causes"][number]) => (rc.parts ?? []).reduce((a, p) => a + p.qty * p.est_price_usd, 0);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 break-inside-avoid-page">
      <h2 className="mb-3 border-b border-[#e5e5e5] pb-1.5 text-[11px] font-semibold tracking-[0.12em] text-[#6b6b6b] uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** A code with its database name and the technician's plain-language meaning and fix cost for this make. */
function CodeRow({ code, kind, db, vin }: { code: string; kind: string; db?: DtcLookup; vin?: string | null }) {
  const { data: x } = useDtcExplanation(code, vin);
  const title = db && db.source !== "unknown" ? db.title : (x?.title ?? db?.title ?? "…");
  return (
    <tr className="border-t border-[#efefef] align-top">
      <td className="py-2 font-mono font-semibold">{code}</td>
      <td className="py-2 pr-4">
        <div>{title}</div>
        {x && (
          <div className="mt-0.5 text-[12px] leading-relaxed text-[#5a5a5a]">
            {x.meaning} <span className="tabular whitespace-nowrap text-[#8a8a8a]">Typical fix {usd(x.est_cost_usd.low)}–{usd(x.est_cost_usd.high)}.</span>
          </div>
        )}
      </td>
      <td className="py-2 text-right text-[#6b6b6b]">{kind}</td>
    </tr>
  );
}

export function ReportSheet({ onClose }: { onClose: () => void }) {
  const { diagnosis: d, vehicle, dtcs, reportMeta, isSim } = useDiagnostics();
  const rows = dtcs ? [...dtcs.stored.map((c) => [c, "Stored"]), ...dtcs.pending.map((c) => [c, "Pending"]), ...dtcs.permanent.map((c) => [c, "Permanent"])] : [];
  const found = useDtcLookups([...new Set(rows.map(([c]) => c))], vehicle?.vin);
  const real = useRealParts(d, vehicle?.vin);
  const realTotal = real.data?.parts.reduce((a, p) => a + p.qty * p.price_usd, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!d) return null;
  const sev = SEVERITY[d.severity];
  const top = d.root_causes[0];
  const at = reportMeta?.at ?? new Date();
  const reportNo = `TQ-${at.toISOString().slice(2, 10).replace(/-/g, "")}-${String(at.getHours()).padStart(2, "0")}${String(at.getMinutes()).padStart(2, "0")}`;
  const brand = brandFromVin(vehicle?.vin);
  const meta: [string, string][] = [
    ["Vehicle", isSim ? "Demo car (simulated)" : brand ? brandLabel(brand) : "Unknown make"],
    ["VIN", vehicle?.vin ?? "Not reported"],
    ["Connection", vehicle ? `${vehicle.adapter} · ${vehicle.protocol}` : "–"],
    ["Customer concern", reportMeta?.complaint || "General health check"],
  ];

  return createPortal(
    <div className="sheet-overlay fixed inset-0 z-50 overflow-y-auto bg-black/70 px-3 py-6 backdrop-blur-sm sm:px-8" role="dialog" aria-modal="true" aria-label="Diagnostic report" onClick={onClose}>
      <div className="mx-auto max-w-[880px]" onClick={(e) => e.stopPropagation()}>
        <div className="no-print mb-3 flex items-center gap-2">
          <span className="text-sm font-medium text-white">Diagnostic report</span>
          <button onClick={() => window.print()} className="ml-auto rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-[#111]">
            Print / Save PDF
          </button>
          <button onClick={onClose} className="rounded-lg border border-white/30 px-3 py-1.5 text-sm text-white hover:bg-white/10">
            Close
          </button>
        </div>

        <article className="print-sheet rounded-lg bg-white px-6 py-8 text-[#1a1a1a] shadow-2xl sm:px-12 sm:py-10">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#1a1a1a] pb-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#3987e5] text-white">
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0" />
                </svg>
              </span>
              <div>
                <div className="text-lg leading-tight font-semibold">Torque</div>
                <div className="text-xs text-[#6b6b6b]">Vehicle diagnostic report</div>
              </div>
            </div>
            <div className="tabular text-right text-xs text-[#6b6b6b]">
              <div className="font-mono text-sm text-[#1a1a1a]">{reportNo}</div>
              <div>
                {at.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} · {at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </div>
            </div>
          </header>

          <dl className="grid grid-cols-2 border-b border-[#e5e5e5] sm:grid-cols-4">
            {meta.map(([k, v]) => (
              <div key={k} className="border-r border-[#e5e5e5] py-3 pr-3 pl-0 last:border-r-0 sm:pl-3 sm:first:pl-0">
                <dt className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8a8a] uppercase">{k}</dt>
                <dd className={`mt-0.5 text-sm ${k === "VIN" ? "font-mono text-[13px]" : ""} break-words`}>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 rounded-md border-l-4 px-5 py-4" style={{ borderColor: sev.color, background: sev.tint }}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: sev.color }}>
                {sev.label}
              </span>
              <span className="text-xs font-medium" style={{ color: d.safe_to_drive ? "#15803d" : "#b91c1c" }}>
                {d.safe_to_drive ? "Safe to drive" : "Not safe to drive"}
              </span>
            </div>
            <p className="text-[15px] leading-relaxed">{d.summary}</p>
          </div>

          {top && (
            <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#e5e5e5] bg-[#e5e5e5] sm:grid-cols-4">
              {[
                ["Most likely cause", top.cause],
                ["Confidence", `${Math.round(top.confidence * 100)}%`],
                ["Parts", realTotal ? usd(realTotal) : top.parts?.length ? `~${usd(partsTotal(top))}` : "–"],
                ["Typical total", `${usd(top.est_cost_usd[0])}–${usd(top.est_cost_usd[1])}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-white px-4 py-3">
                  <div className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8a8a] uppercase">{k}</div>
                  <div className="tabular mt-0.5 text-sm font-semibold">{v}</div>
                </div>
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <Section title="Trouble codes">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-[#8a8a8a]">
                    <th className="w-24 pb-1.5 font-medium">Code</th>
                    <th className="pb-1.5 font-medium">Description</th>
                    <th className="w-24 pb-1.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([c, kind]) => (
                    <CodeRow key={c + kind} code={c} kind={kind} db={found[c]} vin={vehicle?.vin} />
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {top && (real.data?.parts.length || top.parts?.length) ? (
            <Section title={`Parts${real.data ? ` · ${real.data.vehicle}` : ""}`}>
              {real.data?.parts.length ? (
                <table className="tabular w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] text-[#8a8a8a]">
                      <th className="pb-1.5 font-medium">Part</th>
                      <th className="pb-1.5 font-medium">Brand · part no.</th>
                      <th className="pb-1.5 font-medium">Where</th>
                      <th className="pb-1.5 text-right font-medium">Qty</th>
                      <th className="pb-1.5 text-right font-medium">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {real.data.parts.map((p, j) => (
                      <tr key={j} className="border-t border-[#efefef] align-top">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{p.name}</div>
                          {p.fitment && <div className="text-[11px] text-[#8a8a8a]">{p.fitment}</div>}
                        </td>
                        <td className="py-2 pr-3">
                          {p.brand}
                          <div className="font-mono text-[12px] text-[#5a5a5a]">{p.part_number}</div>
                        </td>
                        <td className="py-2 pr-3">
                          <a href={p.url} target="_blank" rel="noreferrer noopener" className="text-[#2563eb] underline">
                            {p.retailer}
                          </a>
                          <div className="max-w-[220px] truncate text-[10px] text-[#8a8a8a] print:whitespace-normal print:break-all">{p.url}</div>
                        </td>
                        <td className="py-2 text-right">{p.qty}</td>
                        <td className="py-2 text-right">{usd(p.qty * p.price_usd)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[#1a1a1a] font-semibold">
                      <td className="py-2" colSpan={4}>
                        Parts total
                      </td>
                      <td className="py-2 text-right">{usd(realTotal ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <ul className="tabular space-y-1 text-[13px]">
                  {(top.parts ?? []).map((p, j) => (
                    <li key={j} className="flex justify-between">
                      <span>
                        {p.qty > 1 ? `${p.qty} × ` : ""}
                        {p.name}
                      </span>
                      <span className="text-[#8a8a8a]">~{usd(p.qty * p.est_price_usd)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-[#8a8a8a]">
                {real.data ? (real.data.note ? `${real.data.note} ` : "") + `Prices and part numbers from current retailer listings, ${(reportMeta?.at ?? new Date()).toLocaleDateString()}.` : real.loading ? "Checking live listings… prices shown are estimates." : "Estimated prices."}
              </p>
            </Section>
          ) : null}

          <Section title="Findings and repair plan">
            <ol className="space-y-6">
              {d.root_causes.map((rc, i) => (
                <li key={i} className="break-inside-avoid-page rounded-md border border-[#e5e5e5]">
                  <div className="flex flex-wrap items-center gap-3 border-b border-[#efefef] bg-[#fafafa] px-4 py-3">
                    <span className="tabular flex h-6 w-6 items-center justify-center rounded-full bg-[#1a1a1a] text-xs font-semibold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1 text-[15px] font-semibold">{rc.cause}</span>
                    <span className="flex items-center gap-2 text-xs text-[#6b6b6b]">
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[#e5e5e5]">
                        <span className="block h-full rounded-full bg-[#3987e5]" style={{ width: `${rc.confidence * 100}%` }} />
                      </span>
                      <span className="tabular font-medium text-[#1a1a1a]">{Math.round(rc.confidence * 100)}%</span>
                    </span>
                  </div>
                  <div className="space-y-4 px-4 py-4 text-sm">
                    <div>
                      <div className="mb-1 text-[11px] font-semibold text-[#8a8a8a]">Evidence</div>
                      <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-[#3a3a3a]">
                        {rc.evidence.map((e, j) => (
                          <li key={j}>{e}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                      <span>
                        <span className="text-[#8a8a8a]">Fix: </span>
                        {rc.fix}
                      </span>
                    </div>
                    <div className="tabular flex flex-wrap gap-2 text-[11px]">
                      {[DIFFICULTY[rc.diy_difficulty] ?? rc.diy_difficulty, `${usd(rc.est_cost_usd[0])}–${usd(rc.est_cost_usd[1])}`, rc.labor_hours !== undefined ? `${rc.labor_hours} h labor` : null]
                        .filter(Boolean)
                        .map((t) => (
                          <span key={t} className="rounded-full border border-[#e5e5e5] px-2 py-0.5 text-[#3a3a3a]">
                            {t}
                          </span>
                        ))}
                    </div>
                    {rc.repair_steps && rc.repair_steps.length > 0 && (
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-[#8a8a8a]">Repair steps</div>
                        <ol className="space-y-1.5">
                          {rc.repair_steps.map((s, j) => (
                            <li key={j} className="flex gap-2.5 text-[13px] leading-relaxed">
                              <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#d4d4d4] text-[10px] font-semibold">{j + 1}</span>
                              {s}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {i > 0 && rc.parts && rc.parts.length > 0 && (
                      <table className="tabular w-full text-[13px]">
                        <thead>
                          <tr className="text-left text-[11px] text-[#8a8a8a]">
                            <th className="pb-1 font-medium">Part</th>
                            <th className="pb-1 font-medium">Part no.</th>
                            <th className="pb-1 text-right font-medium">Qty</th>
                            <th className="pb-1 text-right font-medium">Each</th>
                            <th className="pb-1 text-right font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rc.parts.map((p, j) => (
                            <tr key={j} className="border-t border-[#efefef]">
                              <td className="py-1.5">{p.name}</td>
                              <td className="py-1.5 font-mono text-[12px] text-[#6b6b6b]">{p.part_number ?? "–"}</td>
                              <td className="py-1.5 text-right">{p.qty}</td>
                              <td className="py-1.5 text-right">{usd(p.est_price_usd)}</td>
                              <td className="py-1.5 text-right">{usd(p.qty * p.est_price_usd)}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-[#1a1a1a] font-semibold">
                            <td className="py-1.5" colSpan={4}>
                              Parts total
                            </td>
                            <td className="py-1.5 text-right">{usd(partsTotal(rc))}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                    {rc.tools_needed && rc.tools_needed.length > 0 && (
                      <div className="text-[13px]">
                        <span className="text-[#8a8a8a]">Tools: </span>
                        {rc.tools_needed.join(", ")}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          {d.ruled_out.length > 0 && (
            <Section title="Ruled out">
              <table className="w-full text-[13px]">
                <tbody>
                  {d.ruled_out.map((r, i) => (
                    <tr key={i} className="border-t border-[#efefef] first:border-t-0 align-top">
                      <td className="w-1/3 py-2 pr-4 font-medium text-[#6b6b6b]">{r.cause}</td>
                      <td className="py-2 text-[#3a3a3a]">{r.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {d.next_steps.length > 0 && (
            <Section title="Next steps">
              <ul className="space-y-2">
                {d.next_steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[13px] leading-relaxed">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-[#a3a3a3]" aria-hidden="true" />
                    {s}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <footer className="mt-10 border-t border-[#e5e5e5] pt-4 text-[11px] leading-relaxed text-[#8a8a8a]">
            Generated by the Torque AI technician from the car&apos;s OBD-II data. Prices and labor are typical estimates; confirm the diagnosis before buying parts.
          </footer>
        </article>
      </div>
    </div>,
    document.body,
  );
}
