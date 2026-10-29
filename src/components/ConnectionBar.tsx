"use client";
import { SCENARIOS, type ScenarioId } from "@/lib/obd/simulator";
import { MODE_LABEL } from "./AppShell";
import { useDiagnostics } from "./DiagnosticsProvider";
import { PageHeader } from "./PageHeader";

/** Page title plus adapter picker, demo-car scenario and connect button, shared by the vehicle pages. */
export function ConnectionBar({ title, description }: { title: string; description?: string }) {
  const { mode, setMode, scenario, setScenario, status, connError, vehicle, support, connected, connect, disconnect } = useDiagnostics();
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="panel mb-5 flex flex-wrap items-center gap-3 px-3 py-2.5">
        <div className="flex rounded-lg border border-line bg-page p-0.5 text-sm" role="tablist" aria-label="Connection type">
          {(
            [
              ["simulator", true],
              ["serial", support.serial],
              ["ble", support.ble],
            ] as const
          ).map(([m, ok]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              disabled={!ok || status !== "disconnected"}
              onClick={() => setMode(m)}
              title={ok ? undefined : "Not supported in this browser. Use Chrome or Edge."}
              className={`rounded-md px-3 py-1 ${mode === m ? "bg-surface-2 text-ink" : "text-ink-2"} disabled:opacity-40`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {mode === "simulator" && (
          <select
            value={scenario}
            disabled={status !== "disconnected"}
            onChange={(e) => setScenario(e.target.value as ScenarioId | "mystery")}
            className="max-w-full min-w-0 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink disabled:opacity-50"
            aria-label="Demo car fault"
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
        <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-ink-2">
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${connected ? "bg-good" : status === "connecting" ? "pulse bg-warning" : "bg-muted"}`} />
          {connected && vehicle ? (
            <span className="tabular truncate">
              VIN {vehicle.vin ?? "n/a"} · {vehicle.protocol} · {vehicle.adapter} · {vehicle.transport}
            </span>
          ) : (
            <span>{status === "connecting" ? "Initializing adapter…" : "Not connected"}</span>
          )}
        </div>
      </div>

      {connError && (
        <div className="mb-4 rounded-lg border border-critical/40 bg-critical/10 px-4 py-2 text-sm text-ink">
          <span className="text-critical">● Connection failed:</span> {connError}
        </div>
      )}
    </>
  );
}
