"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { ENGINES, ENGINE_BY_ID, cloneTune, runDrag } from "@/lib/sim/engine";
import { Workbench, buildPackage, type TunePackage } from "@/lib/tune/workbench";
import { ROLES, type RoleId } from "@/lib/tune/team";
import { runTeam, MAX_ROUNDS, type TeamEvent } from "@/lib/tune/pipeline";
import { downloadTune, saveTune } from "@/lib/tune/storage";
import { XYChart } from "@/components/XYChart";
import { MapTable } from "@/components/MapTable";
import { Timeline, type TimelineItem } from "@/components/Panels";

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; calls: number };
type Segment = { key: string; role: RoleId; round: number; items: TimelineItem[] };
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const OCTANES = [87, 91, 93, 98];
const GOALS = ["More power, still safe as a daily driver", "Maximum safe power for track days", "Better mid-range torque for passing, keep stock top end"];

function reduce(items: TimelineItem[], e: TeamEvent, nextId: () => number): TimelineItem[] {
  const last = items[items.length - 1];
  switch (e.type) {
    case "block_start":
      if (e.block === "thinking") return [...items, { id: nextId(), kind: "thinking", text: "" }];
      if (e.block === "text") return [...items, { id: nextId(), kind: "text", text: "" }];
      return items;
    case "thinking":
      if (last?.kind === "thinking") return [...items.slice(0, -1), { ...last, text: last.text + e.text }];
      return [...items, { id: nextId(), kind: "thinking", text: e.text }];
    case "text":
      if (last?.kind === "text") return [...items.slice(0, -1), { ...last, text: last.text + e.text }];
      return [...items, { id: nextId(), kind: "text", text: e.text }];
    case "tool_call":
      return [...items.filter((p) => !((p.kind === "thinking" || p.kind === "text") && !p.text.trim())), { id: nextId(), kind: "tool", toolId: e.id, name: e.name, input: e.input as Record<string, unknown> }];
    case "tool_result":
      return items.map((p) => (p.kind === "tool" && p.toolId === e.id ? { ...p, result: e.result, isError: e.isError, ms: e.ms } : p));
    case "error":
      return [...items, { id: nextId(), kind: "error", text: e.error }];
    default:
      return items;
  }
}

function Stat({ label, stock, tuned, unit, better = "up", digits = 0 }: { label: string; stock: number | null; tuned: number | null; unit: string; better?: "up" | "down"; digits?: number }) {
  const d = stock !== null && tuned !== null ? tuned - stock : 0;
  const good = better === "up" ? d > 0 : d < 0;
  return (
    <div className="panel px-3 py-2">
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
      <div className="tabular mt-0.5 text-xl font-semibold text-ink">
        {tuned === null ? "–" : tuned.toFixed(digits)}
        <span className="ml-1 text-xs font-normal text-ink-2">{unit}</span>
      </div>
      <div className="tabular text-[11px] text-ink-2">
        stock {stock === null ? "–" : stock.toFixed(digits)}
        {Math.abs(d) > 0.005 && <span className={`ml-1 ${good ? "text-good" : "text-serious"}`}>{(d > 0 ? "+" : "") + d.toFixed(digits)}</span>}
      </div>
    </div>
  );
}

export default function TunePage() {
  const [engineId, setEngineId] = useState("gti");
  const [octane, setOctane] = useState(93);
  const [goal, setGoal] = useState(GOALS[0]);
  const [rev, setRev] = useState(0);
  const [tab, setTab] = useState<"ignition" | "afr" | "boost">("ignition");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<{ role: RoleId; round: number } | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "rejected" | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [pkg, setPkg] = useState<TunePackage | null>(null);
  const [saved, setSaved] = useState(false);

  const wbRef = useRef<Workbench | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  if (!wbRef.current) wbRef.current = new Workbench(ENGINE_BY_ID[engineId], octane);
  const wb = wbRef.current;
  wb.onChange = () => setRev((r) => r + 1);

  const reset = (id = engineId, oct = octane) => {
    abortRef.current?.abort();
    wbRef.current = new Workbench(ENGINE_BY_ID[id], oct);
    setSegments([]);
    setOutcome(null);
    setUsage(null);
    setPkg(null);
    setSaved(false);
    setRev((r) => r + 1);
  };

  const view = useMemo(() => {
    void rev;
    const stock = wb.dyno("standard", wb.stock);
    const tuned = wb.dyno("standard");
    const hot = wb.dyno("hot_day");
    const dragS = runDrag(wb.spec, wb.stock, wb.env("standard"));
    const dragT = runDrag(wb.spec, wb.tune, wb.env("standard"));
    const gate = wb.safetyChecks();
    return { stock, tuned, hot, dragS, dragT, gate };
  }, [wb, rev]);

  const onEvent = useCallback((e: TeamEvent) => {
    setActive({ role: e.role, round: e.round });
    setSegments((segs) => {
      const key = `${e.role}-${e.round}`;
      const nextId = () => ++idRef.current;
      const last = segs[segs.length - 1];
      if (last?.key === key) return [...segs.slice(0, -1), { ...last, items: reduce(last.items, e, nextId) }];
      return [...segs, { key, role: e.role, round: e.round, items: reduce([], e, nextId) }];
    });
    if (e.type === "usage")
      setUsage((u) => ({
        input: (u?.input ?? 0) + e.usage.input_tokens,
        output: (u?.output ?? 0) + e.usage.output_tokens,
        cacheRead: (u?.cacheRead ?? 0) + (e.usage.cache_read_input_tokens ?? 0),
        cacheWrite: (u?.cacheWrite ?? 0) + (e.usage.cache_creation_input_tokens ?? 0),
        calls: (u?.calls ?? 0) + 1,
      }));
  }, []);

  const runAgents = async () => {
    reset();
    const bench = wbRef.current!;
    bench.onChange = () => setRev((r) => r + 1);
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    try {
      const result = await runTeam(goal, bench, ac.signal, onEvent);
      setOutcome(result);
      setPkg(buildPackage(bench));
    } catch (e) {
      if ((e as Error).name !== "AbortError") onEvent({ type: "error", error: (e as Error).message, role: active?.role ?? "lead", round: active?.round ?? 0 });
    } finally {
      setRunning(false);
      setActive(null);
    }
  };

  const edit = (table: "ignition" | "afr", li: number, ri: number, v: number) => {
    const t = cloneTune(wb.tune);
    t[table][li][ri] = table === "afr" ? Math.max(10.5, Math.min(15.5, v)) : Math.max(-10, Math.min(50, v));
    wb.tune = t;
    wb.edits.push(`Manual: ${table === "afr" ? "AFR" : "spark"} ${t[table][li][ri]} at ${t.rpmAxis[ri]} rpm, ${t.loadAxis[li]}% load`);
    setPkg(null);
    setRev((r) => r + 1);
  };

  const cost = usage ? (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1e6 : 0;
  const { stock, tuned, hot, dragS, dragT, gate } = view;
  const spec = wb.spec;
  const turbo = spec.aspiration === "turbo";
  const roleDone = (id: RoleId) => (id === "lead" ? !!wb.plan : id === "calibration" ? !!wb.calibration : id === "simulation" ? !!wb.simReport : !!wb.review);

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-sm font-medium text-ink-2">ECU tuning lab</h1>
        <select
          value={engineId}
          disabled={running}
          onChange={(e) => {
            setEngineId(e.target.value);
            reset(e.target.value);
          }}
          className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink"
          aria-label="Vehicle"
        >
          {ENGINES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.engine}
            </option>
          ))}
        </select>
        <select
          value={octane}
          disabled={running}
          onChange={(e) => {
            setOctane(+e.target.value);
            reset(engineId, +e.target.value);
          }}
          className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink"
          aria-label="Fuel"
        >
          {OCTANES.map((o) => (
            <option key={o} value={o}>
              {o} octane
            </option>
          ))}
        </select>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          list="goals"
          disabled={running}
          placeholder="What do you want from the tune?"
          className="min-w-[280px] flex-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink placeholder:text-muted"
          aria-label="Tuning goal"
        />
        <datalist id="goals">
          {GOALS.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        {running ? (
          <button onClick={() => abortRef.current?.abort()} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2">
            Stop
          </button>
        ) : (
          <button onClick={runAgents} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white">
            Run tuning team
          </button>
        )}
        <button onClick={() => reset()} disabled={running} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40">
          Reset to stock
        </button>
      </header>

      <main className="grid grid-cols-12 gap-5">
        <section className="col-span-12 space-y-4 xl:col-span-7">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
            <Stat label="Peak power" stock={stock.peakHp} tuned={tuned.peakHp} unit="hp" />
            <Stat label="Peak torque" stock={stock.peakTorqueNm} tuned={tuned.peakTorqueNm} unit="Nm" />
            <Stat label="0-60 mph" stock={dragS.zeroTo60s} tuned={dragT.zeroTo60s} unit="s" better="down" digits={2} />
            <Stat label="Quarter mile" stock={dragS.quarterMileS} tuned={dragT.quarterMileS} unit="s" better="down" digits={2} />
            <Stat label="Knock margin" stock={stock.minKnockMarginDeg} tuned={tuned.minKnockMarginDeg} unit="°" digits={1} />
            <Stat label="Max EGT" stock={stock.maxEgtC} tuned={tuned.maxEgtC} unit="°C" better="down" />
          </div>

          <XYChart
            title={`Dyno: ${spec.name} on ${octane} octane, standard day`}
            unit=""
            series={[
              { label: "Tuned hp", color: "var(--series-1)", points: tuned.points.map((p) => [p.rpm, p.hp]) },
              { label: "Stock hp", color: "var(--series-1)", dashed: true, points: stock.points.map((p) => [p.rpm, p.hp]) },
              { label: "Tuned Nm", color: "var(--series-2)", points: tuned.points.map((p) => [p.rpm, p.torqueNm]) },
              { label: "Stock Nm", color: "var(--series-2)", dashed: true, points: stock.points.map((p) => [p.rpm, p.torqueNm]) },
            ]}
            height={230}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <XYChart
              title="Knock margin (spark below knock limit)"
              unit="°"
              series={[
                { label: "Tuned", color: "var(--series-1)", points: tuned.points.map((p) => [p.rpm, p.knockMarginDeg]) },
                { label: "Tuned, hot day", color: "var(--series-4)", points: hot.points.map((p) => [p.rpm, p.knockMarginDeg]) },
                { label: "Stock", color: "var(--muted)", dashed: true, points: stock.points.map((p) => [p.rpm, p.knockMarginDeg]) },
              ]}
              limit={{ value: 0, label: "knock" }}
              height={170}
            />
            <XYChart
              title="Exhaust gas temperature"
              unit="°C"
              series={[
                { label: "Tuned", color: "var(--series-1)", points: tuned.points.map((p) => [p.rpm, p.egtC]) },
                { label: "Stock", color: "var(--muted)", dashed: true, points: stock.points.map((p) => [p.rpm, p.egtC]) },
              ]}
              limit={{ value: 980, label: "980°C limit" }}
              yMin={500}
              height={170}
            />
          </div>

          <div className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-sm font-medium text-ink">Calibration maps</h2>
              <div className="flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs">
                {(
                  [
                    ["ignition", "Spark advance (°)"],
                    ["afr", "Air-fuel ratio"],
                    ["boost", turbo ? "Boost & limits" : "Limits"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} onClick={() => setTab(id)} className={`rounded-md px-2.5 py-1 ${tab === id ? "bg-surface-1 text-ink" : "text-ink-2"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[11px] text-muted">{wb.edits.length} edits</span>
            </div>
            {tab === "ignition" && <MapTable table={wb.tune.ignition} stock={wb.stock.ignition} rpmAxis={wb.tune.rpmAxis} loadAxis={wb.tune.loadAxis} unit="°" disabled={running} onEdit={(l, r, v) => edit("ignition", l, r, v)} />}
            {tab === "afr" && <MapTable table={wb.tune.afr} stock={wb.stock.afr} rpmAxis={wb.tune.rpmAxis} loadAxis={wb.tune.loadAxis} unit=":1" invert disabled={running} onEdit={(l, r, v) => edit("afr", l, r, v)} />}
            {tab === "boost" && (
              <div className="space-y-3 text-sm">
                {turbo && (
                  <div className="overflow-x-auto">
                    <table className="tabular w-full text-[11px]">
                      <tbody>
                        <tr>
                          <th className="pr-2 text-right font-normal text-muted">rpm</th>
                          {wb.tune.rpmAxis.map((r) => (
                            <td key={r} className="text-center text-muted">
                              {r}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <th className="pr-2 text-right font-normal text-muted">boost psi</th>
                          {wb.tune.boostPsi.map((b, i) => (
                            <td key={i} className="p-0.5">
                              <input
                                type="number"
                                step={0.5}
                                value={b}
                                disabled={running}
                                onChange={(e) => {
                                  const t = cloneTune(wb.tune);
                                  t.boostPsi[i] = Math.max(0, Math.min(35, +e.target.value));
                                  wb.tune = t;
                                  setPkg(null);
                                  setRev((r) => r + 1);
                                }}
                                className={`w-full rounded bg-surface-2 px-1 py-1 text-center text-ink ${b !== wb.stock.boostPsi[i] ? "outline outline-1 outline-warning" : ""}`}
                              />
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                    <p className="mt-1 text-[11px] text-muted">
                      Stock {spec.stockBoostPsi} psi. The stock turbo runs out of efficiency above about {spec.turboMaxPsi} psi.
                    </p>
                  </div>
                )}
                <label className="flex items-center gap-3 text-ink-2">
                  Rev limit
                  <input
                    type="number"
                    step={50}
                    value={wb.tune.revLimit}
                    disabled={running}
                    onChange={(e) => {
                      const t = cloneTune(wb.tune);
                      t.revLimit = Math.max(3000, Math.min(10000, +e.target.value));
                      wb.tune = t;
                      setPkg(null);
                      setRev((r) => r + 1);
                    }}
                    className="tabular w-24 rounded bg-surface-2 px-2 py-1 text-ink"
                  />
                  <span className="text-xs text-muted">
                    factory {spec.redline} · valvetrain limit {spec.mechanicalRpm}
                  </span>
                </label>
                <p className="text-xs text-muted">
                  Hardware: {spec.injectorCcMin} cc/min injectors · internals rated {spec.internalsLimitNm} Nm · compression {spec.compression}:1
                </p>
              </div>
            )}
          </div>

          <div className="panel p-4">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-medium text-ink">Safety gate</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${gate.passed ? "bg-good/20 text-good" : "bg-critical/20 text-critical"}`}>{gate.passed ? "✓ Passing" : `● ${gate.blocking_failures.length} blocking`}</span>
            </div>
            <table className="tabular mb-3 w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-1 font-normal">Condition</th>
                  <th className="pb-1 text-right font-normal">Peak hp</th>
                  <th className="pb-1 text-right font-normal">Knock margin</th>
                  <th className="pb-1 text-right font-normal">Max EGT</th>
                  <th className="pb-1 text-right font-normal">Injector duty</th>
                  <th className="pb-1 text-right font-normal">Result</th>
                </tr>
              </thead>
              <tbody>
                {gate.per_condition.map((c) => (
                  <tr key={c.condition} className="border-t border-line text-ink-2">
                    <td className="py-1 text-ink">{c.condition.replace("_", " ")}</td>
                    <td className="py-1 text-right">{c.peak_hp}</td>
                    <td className={`py-1 text-right ${c.min_knock_margin_deg < 0 ? "text-serious" : ""}`}>{c.min_knock_margin_deg}°</td>
                    <td className="py-1 text-right">{c.max_egt_c}°C</td>
                    <td className="py-1 text-right">{c.max_idc_pct}%</td>
                    <td className={`py-1 text-right ${c.fails ? "text-critical" : "text-good"}`}>{c.fails ? `${c.fails} fail` : "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {gate.blocking_failures.length > 0 && (
              <ul className="mb-2 space-y-1 text-xs text-ink">
                {gate.blocking_failures.map((f, i) => (
                  <li key={i}>
                    <span className="text-critical">● </span>
                    {f}
                  </li>
                ))}
              </ul>
            )}
            {gate.warnings.length > 0 && (
              <details className="text-xs text-ink-2">
                <summary className="cursor-pointer text-muted">{gate.warnings.length} warnings</summary>
                <ul className="mt-1 space-y-1">
                  {gate.warnings.map((w, i) => (
                    <li key={i}>
                      <span className="text-warning">▲ </span>
                      {w}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>

        <section className="col-span-12 space-y-4 xl:col-span-5">
          <div className="panel flex max-h-[calc(100vh-110px)] min-h-[520px] flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-ink">Tuning team</h2>
              {usage && (
                <span className="tabular text-[11px] text-muted">
                  {usage.calls} steps · {(usage.input + usage.cacheRead + usage.cacheWrite).toLocaleString()} in / {usage.output.toLocaleString()} out · ${cost.toFixed(2)}
                </span>
              )}
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {ROLES.map((r) => {
                const working = active?.role === r.id && running;
                const done = roleDone(r.id);
                return (
                  <div key={r.id} className={`rounded-lg border px-3 py-2 ${working ? "border-accent bg-accent/10" : "border-line bg-surface-2"}`}>
                    <div className="flex items-center gap-1.5 text-sm text-ink">
                      <span className={working ? "pulse text-accent" : done ? "text-good" : "text-muted"}>{working ? "◉" : done ? "✓" : "○"}</span>
                      {r.title}
                      {working && active && active.round > 0 && <span className="ml-auto text-[11px] text-accent">round {active.round}</span>}
                    </div>
                    <div className="text-[11px] text-muted">{r.blurb}</div>
                  </div>
                );
              })}
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {segments.length === 0 && !running && (
                <p className="mt-8 text-center text-sm text-muted">
                  Pick the car and fuel, describe the goal and press Run tuning team. The lead tuner plans, the calibration engineer edits the maps, the simulation engineer stress-tests them and QA approves or sends them back (up to {MAX_ROUNDS} rounds). You can also edit the maps by hand.
                </p>
              )}
              {segments.map((s, i) => (
                <div key={s.key}>
                  <div className="mb-1.5 text-[11px] font-medium tracking-wide text-accent uppercase">
                    {ROLES.find((r) => r.id === s.role)?.title}
                    {s.round > 0 && ` · round ${s.round}`}
                  </div>
                  <Timeline items={s.items} running={running && i === segments.length - 1} />
                </div>
              ))}
            </div>
          </div>

          {wb.plan && (
            <div className="panel p-4 text-xs text-ink-2">
              <h3 className="mb-1 text-sm font-medium text-ink">Plan · target {wb.plan.target_peak_hp} hp</h3>
              <p className="mb-2">{wb.plan.goal_summary}</p>
              <div className="tabular mb-2 flex flex-wrap gap-x-3 gap-y-1 text-muted">
                <span>knock margin ≥ {wb.plan.limits.min_knock_margin_deg}°</span>
                <span>EGT ≤ {wb.plan.limits.max_egt_c}°C</span>
                <span>IDC ≤ {wb.plan.limits.max_injector_duty_pct}%</span>
                {turbo && <span>boost ≤ {wb.plan.limits.max_boost_psi} psi</span>}
                <span>rev limit ≤ {wb.plan.limits.max_rev_limit}</span>
              </div>
              <ol className="list-decimal space-y-0.5 pl-5">
                {wb.plan.strategy.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {wb.plan.hardware_notes.length > 0 && <p className="mt-2 text-muted">Hardware: {wb.plan.hardware_notes.join("; ")}</p>}
            </div>
          )}

          {wb.review && (
            <div className={`panel border-l-4 p-4 text-xs text-ink-2 ${wb.review.verdict === "approve" ? "border-l-good" : "border-l-critical"}`}>
              <h3 className="mb-1 text-sm font-medium text-ink">QA verdict: {wb.review.verdict === "approve" ? "approved" : "rejected"}</h3>
              <p>{wb.review.notes}</p>
              {wb.review.required_fixes.length > 0 && (
                <ul className="mt-2 list-disc pl-5">
                  {wb.review.required_fixes.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="panel p-4">
            <h3 className="mb-1 text-sm font-medium text-ink">Tune package</h3>
            {outcome === "rejected" && <p className="mb-2 text-xs text-serious">QA did not approve this tune after {MAX_ROUNDS} rounds. It is exported as unreviewed.</p>}
            <p className="mb-3 text-xs text-muted">
              Exports the calibration, results, changelog and QA notes as JSON, or sends it to the Simulator page. Emissions controls are untouched. Writing a tune to a real ECU needs a platform-specific flash tool; an ELM327 OBD adapter can read data but cannot flash maps.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const p = pkg ?? buildPackage(wb);
                  setPkg(p);
                  downloadTune(p);
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-2"
              >
                Download package
              </button>
              <button
                onClick={() => {
                  const p = pkg ?? buildPackage(wb);
                  setPkg(p);
                  setSaved(saveTune(p));
                }}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
              >
                Send to simulator
              </button>
              {saved && (
                <a href="/sim" className="self-center text-xs text-accent hover:underline">
                  Saved. Open simulator →
                </a>
              )}
            </div>
            {pkg && (
              <p className="tabular mt-2 text-[11px] text-muted">
                {pkg.status} · {pkg.results.stock_hp} → {pkg.results.tuned_hp} hp · checksum {pkg.checksum}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
