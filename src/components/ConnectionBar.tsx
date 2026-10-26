"use client";
import { SCENARIOS, type ScenarioId } from "@/lib/obd/simulator";
import { useDiagnostics } from "./DiagnosticsProvider";

/** Adapter picker, simulator scenario and connect button, shared by the Diagnostics and AI Technician tabs. */
export function ConnectionBar({ title }: { title: string }) {
  const { mode, setMode, scenario, setScenario, status, connError, vehicle, support, connected, connect, disconnect } = useDiagnostics();
  return (
    <>
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <h1 className="mr-2 text-sm font-medium text-ink-2">{title}</h1>
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
    </>
  );
}
