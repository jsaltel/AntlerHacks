"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ENGINES, ENGINE_BY_ID, ENVIRONMENTS, LIMITS, engineAt, envFor, runDrag, runDyno, stockTune, type EngineSpec, type Environment, type Tune } from "@/lib/sim/engine";
import { deleteTune, loadTunes } from "@/lib/tune/storage";
import type { TunePackage } from "@/lib/tune/workbench";
import { LineChart } from "@/components/LineChart";
import { XYChart } from "@/components/XYChart";

const FAULTS = [
  { id: "none", label: "No faults" },
  { id: "clogged_injectors", label: "Clogged injectors (-25% flow)" },
  { id: "boost_leak", label: "Boost leak (turbo only)" },
  { id: "heat_soaked_intercooler", label: "Failed intercooler / heat soak" },
  { id: "bad_fuel", label: "Contaminated fuel (-6 octane)" },
] as const;
type FaultId = (typeof FAULTS)[number]["id"];

function applyFault(spec: EngineSpec, env: Environment, fault: FaultId): [EngineSpec, Environment] {
  switch (fault) {
    case "clogged_injectors":
      return [{ ...spec, injectorCcMin: spec.injectorCcMin * 0.75 }, env];
    case "boost_leak":
      return [{ ...spec, turboMaxPsi: Math.max(0, spec.turboMaxPsi - 8) }, env];
    case "heat_soaked_intercooler":
      return [{ ...spec, intercoolerEff: spec.intercoolerEff * 0.4 }, { ...env, heatSoakC: env.heatSoakC + 25 }];
    case "bad_fuel":
      return [spec, { ...env, octane: env.octane - 6 }];
    default:
      return [spec, env];
  }
}

interface CarState {
  t: number;
  speed: number;
  rpm: number;
  gear: number;
  shiftTimer: number;
  throttle: number;
  brake: number;
  odometer: number;
  launchT: number | null;
  z60: number | null;
  quarter: number | null;
  trap: number | null;
}

const fresh = (): CarState => ({ t: 0, speed: 0, rpm: 850, gear: 0, shiftTimer: 0, throttle: 0, brake: 0, odometer: 0, launchT: null, z60: null, quarter: null, trap: null });

function Dial({ value, max, label, unit, redFrom }: { value: number; max: number; label: string; unit: string; redFrom?: number }) {
  const R = 62;
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const pt = (f: number, r = R) => [80 + r * Math.cos(start + sweep * f), 80 + r * Math.sin(start + sweep * f)];
  const arc = (f0: number, f1: number) => {
    const [x0, y0] = pt(f0);
    const [x1, y1] = pt(f1);
    return `M${x0},${y0} A${R},${R} 0 ${sweep * (f1 - f0) > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
  };
  const f = Math.max(0, Math.min(1, value / max));
  const [nx, ny] = pt(f, R - 8);
  return (
    <svg viewBox="0 0 160 150" className="w-full max-w-[200px]" role="img" aria-label={`${label} ${Math.round(value)} ${unit}`}>
      <path d={arc(0, 1)} fill="none" stroke="var(--surface-2)" strokeWidth={10} strokeLinecap="round" />
      {redFrom !== undefined && <path d={arc(redFrom / max, 1)} fill="none" stroke="var(--critical)" strokeWidth={10} opacity={0.6} />}
      <path d={arc(0, Math.max(0.001, f))} fill="none" stroke="var(--accent)" strokeWidth={10} strokeLinecap="round" />
      <line x1={80} y1={80} x2={nx} y2={ny} stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={80} cy={80} r={4} fill="var(--ink)" />
      <text x={80} y={112} textAnchor="middle" fontSize={22} fontWeight={600} fill="var(--ink)" className="tabular">
        {Math.round(value)}
      </text>
      <text x={80} y={128} textAnchor="middle" fontSize={10} fill="var(--muted)">
        {label} · {unit}
      </text>
    </svg>
  );
}

export default function SimPage() {
  const [engineId, setEngineId] = useState("gti");
  const [tunes, setTunes] = useState<TunePackage[]>([]);
  const [tuneId, setTuneId] = useState("stock");
  const [envId, setEnvId] = useState("standard");
  const [fault, setFault] = useState<FaultId>("none");
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState<"manual" | "launch" | "cruise">("manual");
  const [car, setCar] = useState<CarState>(fresh());
  const [point, setPoint] = useState<ReturnType<typeof engineAt> | null>(null);
  const [history, setHistory] = useState<{ t: number; values: Record<string, number | null> }[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);

  const carRef = useRef<CarState>(fresh());
  const histRef = useRef<{ t: number; values: Record<string, number | null> }[]>([]);
  const keys = useRef({ up: false, down: false });
  const throttleSlider = useRef(0);
  const launchDone = useRef(false);

  useEffect(() => {
    setTunes(loadTunes());
  }, []);

  const baseSpec = ENGINE_BY_ID[engineId];
  const tune: Tune = useMemo(() => {
    const pkg = tunes.find((t) => t.checksum === tuneId);
    return pkg && pkg.engine_id === engineId ? pkg.calibration : stockTune(baseSpec);
  }, [tunes, tuneId, engineId, baseSpec]);
  const selectedPkg = tunes.find((t) => t.checksum === tuneId && t.engine_id === engineId);
  const octane = selectedPkg?.fuel_octane_min ?? baseSpec.recommendedOctane;
  const [spec, env] = useMemo(() => applyFault(baseSpec, envFor(baseSpec, envId, envId === "low_octane" ? undefined : octane), fault), [baseSpec, envId, octane, fault]);
  const stock = useMemo(() => stockTune(baseSpec), [baseSpec]);

  const reset = useCallback(() => {
    carRef.current = fresh();
    histRef.current = [];
    setCar(carRef.current);
    setHistory([]);
    setAlerts([]);
    setPoint(null);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "w") keys.current.up = true;
      if (e.key === "ArrowDown" || e.key === "s") keys.current.down = true;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "w") keys.current.up = false;
      if (e.key === "ArrowDown" || e.key === "s") keys.current.down = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Real-time vehicle loop: 100 Hz physics, ~15 Hz UI updates.
  useEffect(() => {
    if (!running) return;
    const v = spec.vehicle;
    let last = performance.now();
    let uiAcc = 0;
    const alertSet = new Set<string>();
    // A timer rather than requestAnimationFrame, with catch-up, so the sim stays real-time when the tab is throttled.
    const loop = () => {
      const now = performance.now();
      let elapsed = Math.min(1, (now - last) / 1000);
      last = now;
      uiAcc += elapsed;
      let p = engineAt(spec, tune, env, carRef.current.rpm, 10);
      while (elapsed > 0) {
        const dt = Math.min(0.01, elapsed);
        elapsed -= dt;
        const c = carRef.current;
        const mph = c.speed * 2.23694;
        let target = throttleSlider.current;
        if (keys.current.up) target = 100;
        let brake = keys.current.down ? 1 : 0;
        if (auto === "launch") {
          if (mph >= 100) launchDone.current = true;
          target = launchDone.current ? 0 : 100;
          brake = launchDone.current ? 0.6 : 0;
        } else if (auto === "cruise") target = mph < 65 ? 45 : mph > 70 ? 8 : 22;
        c.throttle += (target - c.throttle) * Math.min(1, dt * 12);
        c.brake = brake;
        const ratio = v.gears[c.gear] * v.finalDrive;
        const wheelRpm = (c.speed / v.tireRadiusM) * ratio * (60 / (2 * Math.PI));
        // A slipping clutch holds the engine above the wheels at low speed.
        const slipRpm = c.gear === 0 ? 850 + (c.throttle / 100) * (spec.aspiration === "turbo" ? 2600 : 3400) : 850;
        c.rpm = Math.min(tune.revLimit + 50, Math.max(wheelRpm, slipRpm));
        p = engineAt(spec, tune, env, Math.max(900, c.rpm), Math.max(10, c.throttle));
        let force = 0;
        if (c.shiftTimer > 0) c.shiftTimer -= dt;
        else force = ((c.throttle < 3 ? -spec.displacementL * 12 : p.torqueNm) * ratio * v.drivetrainEff) / v.tireRadiusM;
        force = Math.min(force, v.massKg * 9.81 * v.drivenWeight * (v.drive === "awd" ? 1.5 : 1.25));
        const resist = 0.5 * 1.2 * v.cdA * c.speed * c.speed + v.massKg * 9.81 * 0.012 + c.brake * v.massKg * 9.81 * 0.9;
        c.speed = Math.max(0, c.speed + ((force - (c.speed > 0.05 ? resist : 0)) / (v.massKg * 1.08)) * dt);
        c.odometer += c.speed * dt;
        c.t += dt;
        // Shift logic: hard pulls shift at the limiter, gentle driving shifts early.
        const upAt = c.throttle > 80 ? tune.revLimit - 200 : 2600;
        if (c.rpm >= upAt && c.gear < v.gears.length - 1 && c.shiftTimer <= 0) {
          c.gear++;
          c.shiftTimer = c.throttle > 80 ? 0.25 : 0.4;
        } else if (c.gear > 0 && c.rpm < (c.throttle > 60 ? 2800 : 1300)) c.gear--;
        // Timed runs start when the car leaves a standstill at heavy throttle.
        if (c.launchT === null && c.speed > 0.1 && c.throttle > 60) {
          c.launchT = c.t;
          c.odometer = 0;
        }
        if (c.launchT !== null) {
          if (c.z60 === null && mph >= 60) c.z60 = c.t - c.launchT;
          if (c.quarter === null && c.odometer >= 402.3) {
            c.quarter = c.t - c.launchT;
            c.trap = mph;
          }
        }
        if (c.speed < 0.05 && c.throttle < 5) {
          c.launchT = null;
          c.odometer = 0;
        }
        if (p.detonation) alertSet.add(`Detonation at ${Math.round(p.rpm)} rpm: knock past the controller's authority.`);
        if (p.egtC > LIMITS.egtFailC) alertSet.add(`EGT ${Math.round(p.egtC)}°C at ${Math.round(p.rpm)} rpm exceeds the limit.`);
        if (p.injectorDutyPct > LIMITS.idcFailPct) alertSet.add(`Injectors maxed (${Math.round(p.injectorDutyPct)}%): running lean at ${p.afrActual.toFixed(1)}:1.`);
        if (p.torqueNm > spec.internalsLimitNm) alertSet.add(`${Math.round(p.torqueNm)} Nm exceeds the internals rating.`);
      }
      if (uiAcc > 0.066) {
        uiAcc = 0;
        const c = carRef.current;
        const s = { t: Date.now(), values: { mph: c.speed * 2.23694, rpm: c.rpm, boost: p.boostPsi, afr: p.afrActual, knock: p.knockRetardDeg, egt: p.egtC, hp: p.hp, throttle: c.throttle } };
        histRef.current = [...histRef.current.filter((h) => h.t > s.t - 60000), s];
        setHistory(histRef.current);
        setCar({ ...c });
        setPoint(p);
        if (alertSet.size) setAlerts([...alertSet]);
      }
    };
    const iv = setInterval(loop, 33);
    return () => clearInterval(iv);
  }, [running, spec, tune, env, auto]);

  const suite = useMemo(
    () =>
      ENVIRONMENTS.map((e) => {
        const [s, en] = applyFault(baseSpec, envFor(baseSpec, e.id, e.id === "low_octane" ? undefined : octane), fault);
        const dS = runDyno(s, stock, en);
        const dT = runDyno(s, tune, en);
        const rS = runDrag(s, stock, en);
        const rT = runDrag(s, tune, en);
        return { id: e.id, label: e.label, dS, dT, rS, rT };
      }),
    [baseSpec, stock, tune, octane, fault],
  );
  const current = suite.find((s) => s.id === envId) ?? suite[0];
  const mph = car.speed * 2.23694;

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-sm font-medium text-ink-2">Car simulation environment</h1>
        <select
          value={engineId}
          onChange={(e) => {
            setEngineId(e.target.value);
            setTuneId("stock");
            reset();
          }}
          className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink"
          aria-label="Vehicle"
        >
          {ENGINES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select value={tuneId} onChange={(e) => (setTuneId(e.target.value), reset())} className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink" aria-label="Calibration">
          <option value="stock">Stock calibration</option>
          {tunes
            .filter((t) => t.engine_id === engineId)
            .map((t) => (
              <option key={t.checksum} value={t.checksum}>
                {t.name} · {t.results.tuned_hp} hp · {t.status} · {t.checksum}
              </option>
            ))}
        </select>
        <select value={envId} onChange={(e) => setEnvId(e.target.value)} className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink" aria-label="Conditions">
          {ENVIRONMENTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <select value={fault} onChange={(e) => setFault(e.target.value as FaultId)} className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink" aria-label="Injected fault">
          {FAULTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        {selectedPkg && (
          <button
            onClick={() => {
              deleteTune(selectedPkg.checksum);
              setTunes(loadTunes());
              setTuneId("stock");
            }}
            className="text-xs text-muted hover:text-critical"
          >
            Delete saved tune
          </button>
        )}
      </header>

      <main className="grid grid-cols-12 gap-5">
        <section className="col-span-12 space-y-4 xl:col-span-7">
          <div className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-sm font-medium text-ink">Drive</h2>
              {running ? (
                <button onClick={() => setRunning(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2">
                  Pause
                </button>
              ) : (
                <button onClick={() => setRunning(true)} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white">
                  Start engine
                </button>
              )}
              <button onClick={reset} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
                Reset
              </button>
              <div className="flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs">
                {(
                  [
                    ["manual", "Manual"],
                    ["launch", "Launch to 100 mph"],
                    ["cruise", "Highway cruise"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setAuto(id);
                      launchDone.current = false;
                      if (id !== "manual") setRunning(true);
                    }}
                    className={`rounded-md px-2.5 py-1 ${auto === id ? "bg-surface-1 text-ink" : "text-ink-2"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 items-center gap-4 md:grid-cols-4">
              <Dial value={car.rpm} max={Math.ceil((spec.mechanicalRpm + 500) / 1000) * 1000} label="rpm" unit={`gear ${car.gear + 1}`} redFrom={spec.redline} />
              <Dial value={mph} max={180} label="speed" unit="mph" />
              <div className="col-span-2 grid grid-cols-3 gap-2">
                {[
                  ["Throttle", car.throttle, "%", 0],
                  ["Power", point?.hp ?? 0, "hp", 0],
                  ["Torque", point?.torqueNm ?? 0, "Nm", 0],
                  ["Boost", point?.boostPsi ?? 0, "psi", 1],
                  ["AFR", point?.afrActual ?? 14.7, ":1", 1],
                  ["Spark", point?.timingActual ?? 0, "°", 1],
                  ["Knock retard", point?.knockRetardDeg ?? 0, "°", 1],
                  ["EGT", point?.egtC ?? 0, "°C", 0],
                  ["Inj. duty", point?.injectorDutyPct ?? 0, "%", 0],
                ].map(([label, v, unit, d]) => (
                  <div key={label as string} className="rounded-lg bg-surface-2 px-2.5 py-1.5">
                    <div className="text-[10px] tracking-wide text-muted uppercase">{label}</div>
                    <div className={`tabular text-base font-semibold ${label === "Knock retard" && (v as number) > 0 ? "text-warning" : "text-ink"}`}>
                      {(v as number).toFixed(d as number)}
                      <span className="ml-0.5 text-[11px] font-normal text-ink-2">{unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex flex-1 items-center gap-3 text-xs text-ink-2">
                Throttle
                <input type="range" min={0} max={100} defaultValue={0} onChange={(e) => (throttleSlider.current = +e.target.value)} className="flex-1 accent-[var(--accent)]" disabled={auto !== "manual"} />
              </label>
              <span className="text-[11px] text-muted">Hold ↑ / W for full throttle, ↓ / S to brake</span>
            </div>
            <div className="tabular mt-3 flex flex-wrap gap-4 text-xs text-ink-2">
              <span>
                0-60: <span className="text-ink">{car.z60 ? `${car.z60.toFixed(2)} s` : "–"}</span>
              </span>
              <span>
                ¼ mile: <span className="text-ink">{car.quarter ? `${car.quarter.toFixed(2)} s @ ${car.trap?.toFixed(1)} mph` : "–"}</span>
              </span>
              <span>
                Calibration: <span className="text-ink">{selectedPkg ? selectedPkg.name : "Stock"}</span> · {env.octane} octane · {env.ambientC + env.heatSoakC}°C intake ambient
              </span>
            </div>
            {alerts.length > 0 && (
              <div className="mt-3 rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-ink">
                <div className="mb-1 font-medium text-critical">● Engine damage risk detected during this drive</div>
                <ul className="list-disc pl-5">
                  {alerts.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <LineChart title="Speed & throttle" unit="" series={[{ key: "mph", label: "mph", color: "var(--series-1)" }, { key: "throttle", label: "throttle %", color: "var(--series-3)" }]} data={history} yMin={0} yMax={160} windowS={30} />
            <LineChart title="Engine speed" unit="rpm" series={[{ key: "rpm", label: "RPM", color: "var(--series-1)" }]} data={history} yMin={0} yMax={Math.ceil(spec.mechanicalRpm / 1000) * 1000} windowS={30} />
            <LineChart title="Air-fuel ratio" unit=":1" series={[{ key: "afr", label: "AFR", color: "var(--series-2)" }]} data={history} yMin={10} yMax={16} refValue={14.7} windowS={30} />
            <LineChart title="Exhaust gas temp" unit="°C" series={[{ key: "egt", label: "EGT", color: "var(--series-4)" }]} data={history} yMin={400} yMax={1050} refValue={LIMITS.egtFailC} windowS={30} />
          </div>
        </section>

        <section className="col-span-12 space-y-4 xl:col-span-5">
          <XYChart
            title={`Dyno under ${current.id.replace("_", " ")}${fault !== "none" ? " + fault" : ""}`}
            unit="hp"
            series={[
              { label: selectedPkg ? "Tuned" : "Calibration", color: "var(--series-1)", points: current.dT.points.map((p) => [p.rpm, p.hp]) },
              { label: "Stock", color: "var(--muted)", dashed: true, points: current.dS.points.map((p) => [p.rpm, p.hp]) },
            ]}
            height={200}
          />
          <div className="panel p-4">
            <h2 className="mb-2 text-sm font-medium text-ink">Test matrix: stock vs {selectedPkg ? "tune" : "stock"}</h2>
            <table className="tabular w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-1 font-normal">Condition</th>
                  <th className="pb-1 text-right font-normal">hp</th>
                  <th className="pb-1 text-right font-normal">0-60</th>
                  <th className="pb-1 text-right font-normal">¼ mile</th>
                  <th className="pb-1 text-right font-normal">Knock</th>
                  <th className="pb-1 text-right font-normal">Safety</th>
                </tr>
              </thead>
              <tbody>
                {suite.map((s) => {
                  const fails = s.dT.issues.filter((i) => i.severity === "fail");
                  const warns = s.dT.issues.filter((i) => i.severity === "warn");
                  return (
                    <tr key={s.id} className={`border-t border-line text-ink-2 ${s.id === envId ? "bg-surface-2" : ""}`}>
                      <td className="py-1.5 text-ink">{s.id.replace("_", " ")}</td>
                      <td className="py-1.5 text-right">
                        {s.dS.peakHp} → <span className="text-ink">{s.dT.peakHp}</span>
                      </td>
                      <td className="py-1.5 text-right">
                        {s.rS.zeroTo60s?.toFixed(2)} → <span className="text-ink">{s.rT.zeroTo60s?.toFixed(2)}</span>
                      </td>
                      <td className="py-1.5 text-right">
                        {s.rS.quarterMileS?.toFixed(2)} → <span className="text-ink">{s.rT.quarterMileS?.toFixed(2)}</span>
                      </td>
                      <td className={`py-1.5 text-right ${s.dT.minKnockMarginDeg < 0 ? "text-serious" : ""}`}>{s.dT.minKnockMarginDeg}°</td>
                      <td className={`py-1.5 text-right ${fails.length ? "text-critical" : warns.length ? "text-warning" : "text-good"}`} title={s.dT.issues.map((i) => i.message).join("\n")}>
                        {fails.length ? `● ${fails.length} fail` : warns.length ? `▲ ${warns.length} warn` : "✓ ok"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {current.dT.issues.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-ink-2">
                {current.dT.issues.map((i) => (
                  <li key={i.code}>
                    <span className={i.severity === "fail" ? "text-critical" : "text-warning"}>{i.severity === "fail" ? "● " : "▲ "}</span>
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel p-4 text-xs text-ink-2">
            <h2 className="mb-1 text-sm font-medium text-ink">About this environment</h2>
            <p>
              {spec.name}, {spec.engine}, {spec.vehicle.massKg} kg, {spec.vehicle.drive.toUpperCase()}, {spec.vehicle.gears.length}-speed. The simulator models airflow and volumetric efficiency, turbo spool, intake heat, injector capacity, spark against the knock limit, exhaust temperature, traction, shifts and aero drag. Tunes from the Tuning page appear in the calibration menu after you press Send to simulator.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
