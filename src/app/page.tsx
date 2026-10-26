"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Elm327 } from "@/lib/obd/elm327";
import { connectObd, type ConnectMode } from "@/lib/obd/connect";
import { SCENARIOS, SimulatorTransport, type DriveMode, type ScenarioId } from "@/lib/obd/simulator";
import { SerialTransport } from "@/lib/obd/serial";
import { BleTransport } from "@/lib/obd/ble";
import { DASHBOARD_PIDS } from "@/lib/obd/pids";
import type { WireLogEntry } from "@/lib/obd/transport";
import { runAgent, type AgentEvent } from "@/lib/agent/runner";
import type { Diagnosis, MonitorSample } from "@/lib/agent/executor";
import { LineChart } from "@/components/LineChart";
import { ConfirmClearModal, DiagnosisReport, DriverActionModal, DtcPanel, Gauges, Timeline, WireLog, type TimelineItem } from "@/components/Panels";

type Status = "disconnected" | "connecting" | "connected";
type Dtcs = { stored: string[]; pending: string[]; permanent: string[] };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; calls: number; model: string };

const HISTORY_MS = 120_000;
const FAST_PIDS = ["o2b1s1", "o2b1s2", "rpm", "stft1"];
// Claude Opus 5.5 list prices, USD per million tokens.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export default function Home() {
  const [mode, setMode] = useState<ConnectMode>("simulator");
  const [scenario, setScenario] = useState<ScenarioId | "mystery">("mystery");
  const [actualScenario, setActualScenario] = useState<ScenarioId | null>(null);
  const [status, setStatus] = useState<Status>("disconnected");
  const [connError, setConnError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<{ vin: string | null; protocol: string; adapter: string; transport: string } | null>(null);
  const [live, setLive] = useState<Record<string, number | null>>({});
  const [history, setHistory] = useState<MonitorSample[]>([]);
  const [dtcs, setDtcs] = useState<Dtcs | null>(null);
  const [wire, setWire] = useState<WireLogEntry[]>([]);
  const [complaint, setComplaint] = useState("");
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [testLabel, setTestLabel] = useState<string | null>(null);
  const [driverPrompt, setDriverPrompt] = useState<{ action: DriveMode; instruction: string; resolve: (ok: boolean) => void } | null>(null);
  const [clearPrompt, setClearPrompt] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null);
  const [support, setSupport] = useState({ serial: false, ble: false });

  const elmRef = useRef<Elm327 | null>(null);
  const historyRef = useRef<MonitorSample[]>([]);
  const wireRef = useRef<WireLogEntry[]>([]);
  const pollPaused = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    setSupport({ serial: SerialTransport.supported(), ble: BleTransport.supported() });
  }, []);

  // Throttle wire-log renders: the adapter can produce dozens of lines a second.
  useEffect(() => {
    const iv = setInterval(() => setWire((w) => (w.length === wireRef.current.length ? w : [...wireRef.current])), 400);
    return () => clearInterval(iv);
  }, []);

  const pushSample = useCallback((s: MonitorSample) => {
    const cutoff = s.t - HISTORY_MS;
    historyRef.current = [...historyRef.current.filter((h) => h.t >= cutoff), s];
    setHistory(historyRef.current);
    setLive((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(s.values).filter(([, v]) => v !== null)) }));
  }, []);

  // Continuous dashboard polling (paused while the agent runs a monitored test).
  useEffect(() => {
    if (status !== "connected") return;
    let alive = true;
    let cycle = 0;
    (async () => {
      while (alive && elmRef.current) {
        if (!pollPaused.current) {
          try {
            // Fast-changing signals every cycle, the full set every third, so O2 switching stays visible.
            const keys = cycle++ % 3 === 0 ? DASHBOARD_PIDS : FAST_PIDS;
            const values = await elmRef.current.readPids(keys);
            if (alive) pushSample({ t: Date.now(), values });
          } catch {}
        }
        await new Promise((r) => setTimeout(r, 40));
      }
    })();
    return () => {
      alive = false;
    };
  }, [status, pushSample]);

  const connect = async () => {
    setConnError(null);
    setStatus("connecting");
    wireRef.current = [];
    historyRef.current = [];
    setHistory([]);
    setDtcs(null);
    setDiagnosis(null);
    setItems([]);
    const chosen: ScenarioId = scenario === "mystery" ? SCENARIOS[Math.floor(Math.random() * (SCENARIOS.length - 1))].id : scenario;
    setActualScenario(chosen);
    if (mode === "simulator") setComplaint(SCENARIOS.find((s) => s.id === chosen)!.blurb);
    try {
      const elm = await connectObd(mode, chosen, (e) => wireRef.current.push(e));
      elmRef.current = elm;
      const vin = await elm.readVin();
      setVehicle({ vin, protocol: elm.info!.protocol, adapter: elm.info!.version, transport: elm.transport.label });
      setDtcs(await elm.readDtcs());
      setStatus("connected");
    } catch (e) {
      setConnError((e as Error).message);
      setStatus("disconnected");
      elmRef.current = null;
    }
  };

  const disconnect = async () => {
    abortRef.current?.abort();
    const elm = elmRef.current;
    elmRef.current = null;
    setStatus("disconnected");
    await elm?.close();
  };

  const applyEvent = useCallback((e: AgentEvent) => {
    setItems((prev) => {
      const last = prev[prev.length - 1];
      const nextId = () => ++idRef.current;
      switch (e.type) {
        case "block_start":
          if (e.block === "thinking") return [...prev, { id: nextId(), kind: "thinking", text: "" }];
          if (e.block === "text") return [...prev, { id: nextId(), kind: "text", text: "" }];
          return prev;
        case "thinking":
          if (last?.kind === "thinking") return [...prev.slice(0, -1), { ...last, text: last.text + e.text }];
          return [...prev, { id: nextId(), kind: "thinking", text: e.text }];
        case "text":
          if (last?.kind === "text") return [...prev.slice(0, -1), { ...last, text: last.text + e.text }];
          return [...prev, { id: nextId(), kind: "text", text: e.text }];
        case "tool_call":
          return [...prev.filter((p) => !((p.kind === "thinking" || p.kind === "text") && !p.text.trim())), { id: nextId(), kind: "tool", toolId: e.id, name: e.name, input: e.input as Record<string, unknown> }];
        case "tool_result":
          return prev.map((p) => (p.kind === "tool" && p.toolId === e.id ? { ...p, result: e.result, isError: e.isError, ms: e.ms } : p));
        case "error":
          return [...prev, { id: nextId(), kind: "error", text: e.error }];
        default:
          return prev;
      }
    });
    if (e.type === "usage") {
      setUsage((u) => ({
        input: (u?.input ?? 0) + e.usage.input_tokens,
        output: (u?.output ?? 0) + e.usage.output_tokens,
        cacheRead: (u?.cacheRead ?? 0) + (e.usage.cache_read_input_tokens ?? 0),
        cacheWrite: (u?.cacheWrite ?? 0) + (e.usage.cache_creation_input_tokens ?? 0),
        calls: (u?.calls ?? 0) + 1,
        model: e.model,
      }));
    }
  }, []);

  const run = async () => {
    const elm = elmRef.current;
    if (!elm) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setItems([]);
    setDiagnosis(null);
    setUsage(null);
    const sim = elm.transport instanceof SimulatorTransport ? elm.transport.vehicle : undefined;
    try {
      await runAgent(
        complaint,
        {
          elm,
          vehicle: sim,
          signal: ac.signal,
          requestDriverAction: (action, instruction) => new Promise((resolve) => setDriverPrompt({ action, instruction, resolve })),
          confirmClear: (reason) => new Promise((resolve) => setClearPrompt({ reason, resolve })),
          onMonitorStart: (label) => {
            pollPaused.current = true;
            setTestLabel(label);
          },
          onMonitorSample: pushSample,
          onDtcs: setDtcs,
          onDiagnosis: setDiagnosis,
        },
        (e) => {
          if (e.type === "tool_result") {
            pollPaused.current = false;
            setTestLabel(null);
          }
          applyEvent(e);
        },
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") applyEvent({ type: "error", error: (e as Error).message });
    } finally {
      pollPaused.current = false;
      setTestLabel(null);
      setRunning(false);
      sim?.setMode("idle");
    }
  };

  const cost = usage ? (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1e6 : 0;
  const connected = status === "connected";
  const isSim = vehicle?.transport.startsWith("Simulator");

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      {/* Header + connection */}
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-sm font-medium text-ink-2">AI diagnostic technician</h1>
        <div className="flex rounded-lg border border-line bg-surface-1 p-0.5 text-sm" role="tablist">
          {(
            [
              ["simulator", "Simulator", true],
              ["serial", "USB adapter", support.serial],
              ["ble", "Bluetooth LE", support.ble],
            ] as const
          ).map(([m, label, ok]) => (
            <button
              key={m}
              disabled={!ok || status !== "disconnected"}
              onClick={() => setMode(m)}
              title={ok ? undefined : "Not supported in this browser. Use Chrome or Edge."}
              className={`rounded-md px-3 py-1 ${mode === m ? "bg-surface-2 text-ink" : "text-ink-2"} disabled:opacity-40`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "simulator" && (
          <select
            value={scenario}
            disabled={status !== "disconnected"}
            onChange={(e) => setScenario(e.target.value as ScenarioId | "mystery")}
            className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-sm text-ink disabled:opacity-50"
          >
            <option value="mystery">Mystery car (random fault)</option>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}: {s.blurb}
              </option>
            ))}
          </select>
        )}
        {connected ? (
          <button onClick={disconnect} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
            Disconnect
          </button>
        ) : (
          <button onClick={connect} disabled={status === "connecting"} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60">
            {status === "connecting" ? "Connecting…" : "Connect"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-2">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-good" : status === "connecting" ? "pulse bg-warning" : "bg-muted"}`} />
          {connected && vehicle ? (
            <span className="tabular">
              VIN {vehicle.vin ?? "n/a"} · {vehicle.protocol} · {vehicle.adapter} · {vehicle.transport}
            </span>
          ) : (
            <span>{status === "connecting" ? "Initializing adapter…" : "Not connected"}</span>
          )}
        </div>
      </header>

      {connError && (
        <div className="mb-4 rounded-lg border border-critical/40 bg-critical/10 px-4 py-2 text-sm text-ink">
          <span className="text-critical">● Connection failed:</span> {connError}
        </div>
      )}

      <main className="grid grid-cols-12 gap-5">
        {/* Live data */}
        <section className="col-span-12 space-y-4 xl:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">Live data</h2>
            {testLabel && (
              <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs text-accent">
                <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" /> Agent test: {testLabel}
              </span>
            )}
          </div>
          <Gauges values={live} />
          <LineChart
            title="Fuel trims, bank 1"
            unit="%"
            series={[
              { key: "stft1", label: "Short-term", color: "var(--series-1)" },
              { key: "ltft1", label: "Long-term", color: "var(--series-2)" },
            ]}
            data={history}
            yMin={-25}
            yMax={25}
            refValue={0}
          />
          <LineChart
            title="Oxygen sensors, bank 1"
            unit="V"
            series={[
              { key: "o2b1s1", label: "Upstream", color: "var(--series-1)" },
              { key: "o2b1s2", label: "Downstream", color: "var(--series-2)" },
            ]}
            data={history}
            yMin={0}
            yMax={1}
            refValue={0.45}
            windowS={20}
          />
          <LineChart title="Engine speed" unit="rpm" series={[{ key: "rpm", label: "RPM", color: "var(--series-1)" }]} data={history} yMin={0} yMax={5000} />
        </section>

        {/* Agent */}
        <section className="col-span-12 md:col-span-7 xl:col-span-4">
          <div className="panel flex h-full max-h-[calc(100vh-110px)] min-h-[520px] flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-ink">AI technician</h2>
              {usage && (
                <span className="tabular text-[11px] text-muted" title={`${usage.model} · ${usage.calls} model calls · ${usage.cacheRead.toLocaleString()} cached input tokens`}>
                  {usage.calls} steps · {(usage.input + usage.cacheRead + usage.cacheWrite).toLocaleString()} in / {usage.output.toLocaleString()} out · ${cost.toFixed(3)}
                </span>
              )}
            </div>
            <label className="mb-1 text-xs text-muted" htmlFor="complaint">
              What&apos;s the car doing?
            </label>
            <div className="mb-3 flex gap-2">
              <input
                id="complaint"
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
                placeholder="e.g. check engine light, rough idle when cold"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink placeholder:text-muted"
              />
              {running ? (
                <button onClick={() => abortRef.current?.abort()} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2">
                  Stop
                </button>
              ) : (
                <button onClick={run} disabled={!connected} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                  Diagnose
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {items.length === 0 && !running ? (
                <p className="mt-8 text-center text-sm text-muted">
                  {connected ? "Describe the symptom and press Diagnose. The agent reads codes, runs live tests on the engine and explains what it finds." : "Connect to a car or start the simulator."}
                </p>
              ) : (
                <Timeline items={items} running={running} />
              )}
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="col-span-12 space-y-4 md:col-span-5 xl:col-span-3">
          {diagnosis && <DiagnosisReport d={diagnosis} />}
          {diagnosis && isSim && actualScenario && scenario === "mystery" && (
            <div className="panel px-4 py-3 text-xs text-ink-2">
              Simulator ground truth: <span className="text-ink">{SCENARIOS.find((s) => s.id === actualScenario)?.name}</span> ({actualScenario.replaceAll("_", " ")})
            </div>
          )}
          <DtcPanel dtcs={dtcs} />
          <WireLog log={wire} />
        </section>
      </main>

      {driverPrompt && (
        <DriverActionModal
          action={driverPrompt.action}
          instruction={driverPrompt.instruction}
          simulated={!!isSim}
          onDone={(ok) => {
            driverPrompt.resolve(ok);
            setDriverPrompt(null);
          }}
        />
      )}
      {clearPrompt && (
        <ConfirmClearModal
          reason={clearPrompt.reason}
          onDone={(ok) => {
            clearPrompt.resolve(ok);
            setClearPrompt(null);
          }}
        />
      )}
    </div>
  );
}
