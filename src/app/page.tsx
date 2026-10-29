"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MODE_LABEL } from "@/components/AppShell";
import { useDiagnostics } from "@/components/DiagnosticsProvider";
import { Icon } from "@/components/Icons";
import { DiagnosisReport, DtcPanel, Timeline } from "@/components/Panels";
import type { ConnectMode } from "@/lib/obd/connect";
import { SCENARIOS } from "@/lib/obd/simulator";

const STEPS = ["Connect car", "AI diagnosis", "Report"];

/** Guided flow: connect the car, let the AI technician diagnose it, read the report. */
export default function Diagnose() {
  const { connected, diagnosis } = useDiagnostics();
  const reached = !connected ? 0 : diagnosis ? 2 : 1;
  const [picked, setPicked] = useState<number | null>(null);
  // Follow progress automatically whenever the car connects or a new report lands.
  useEffect(() => setPicked(null), [reached, diagnosis]);
  const step = picked ?? reached;

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2 last:flex-none">
            <button
              onClick={() => setPicked(i)}
              disabled={i > reached}
              aria-current={i === step ? "step" : undefined}
              className="flex items-center gap-2 disabled:cursor-default"
            >
              <span
                className={`tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  i === step ? "bg-accent text-white" : i < reached ? "bg-good/20 text-good" : "bg-surface-2 text-muted"
                }`}
              >
                {i < reached && i !== step ? "✓" : i + 1}
              </span>
              <span className={`hidden text-sm sm:inline ${i === step ? "font-medium text-ink" : i <= reached ? "text-ink-2" : "text-muted"}`}>{s}</span>
            </button>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < reached ? "bg-good/50" : "bg-line"}`} />}
          </li>
        ))}
      </ol>

      {step === 0 && <ConnectStep />}
      {step === 1 && <DiagnoseStep />}
      {step === 2 && <ReportStep onRerun={() => setPicked(1)} />}
    </div>
  );
}

function StepTitle({ n, title, sub }: { n: number; title: string; sub?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-1 text-[11px] font-medium tracking-wide text-accent uppercase">Step {n}</p>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
    </div>
  );
}

const OPTIONS: { mode: ConnectMode; hint: string }[] = [
  { mode: "simulator", hint: "No hardware needed" },
  { mode: "serial", hint: "ELM327 cable" },
  { mode: "ble", hint: "OBDLink CX and similar" },
];

function ConnectStep() {
  const { mode, setMode, status, connError, support, connect } = useDiagnostics();
  const ok: Record<ConnectMode, boolean> = { simulator: true, serial: support.serial, ble: support.ble };
  return (
    <section>
      <StepTitle n={1} title="Connect your car" sub="Plug the adapter into the port under the dashboard and turn the ignition on. No adapter? Use the demo car." />
      <div className="mb-5 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Connection type">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            role="radio"
            aria-checked={mode === o.mode}
            disabled={!ok[o.mode] || status !== "disconnected"}
            onClick={() => setMode(o.mode)}
            className={`panel p-4 text-left disabled:opacity-40 ${mode === o.mode ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-accent/50"}`}
          >
            <div className="text-sm font-medium text-ink">{MODE_LABEL[o.mode]}</div>
            <div className="text-xs text-ink-2">{ok[o.mode] ? o.hint : "Needs Chrome or Edge"}</div>
          </button>
        ))}
      </div>

      {connError && <div className="mb-4 rounded-lg border border-critical/40 bg-critical/10 px-4 py-2 text-sm text-ink">{connError}</div>}

      <div className="flex flex-wrap items-center gap-4">
        <button onClick={connect} disabled={status === "connecting"} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {status === "connecting" ? "Connecting…" : "Connect"}
        </button>
        <Link href="/adapters" className="text-sm text-accent hover:underline">
          Which adapter should I buy?
        </Link>
      </div>
    </section>
  );
}

function DiagnoseStep() {
  const { vehicle, isSim, dtcs, live, complaint, setComplaint, running, items, testLabel, run, stop } = useDiagnostics();
  const codes = dtcs ? dtcs.stored.length + dtcs.pending.length + dtcs.permanent.length : null;
  const facts = [
    ["Codes", codes === null ? "–" : String(codes)],
    ["RPM", live.rpm == null ? "–" : live.rpm.toFixed(0)],
    ["Coolant", live.coolant == null ? "–" : `${live.coolant.toFixed(0)} °C`],
    ["Battery", live.voltage == null ? "–" : `${live.voltage.toFixed(1)} V`],
  ];
  return (
    <section>
      <StepTitle n={2} title={running ? "Diagnosing…" : "Run the AI diagnosis"} sub={`Connected to ${isSim ? "the demo car" : `VIN ${vehicle?.vin ?? "n/a"}`}`} />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="panel px-3 py-2">
            <div className="text-[11px] tracking-wide text-muted uppercase">{k}</div>
            <div className="tabular text-lg font-semibold text-ink">{v}</div>
          </div>
        ))}
      </div>

      {running || items.length > 0 ? (
        <div className="panel mb-4 p-4">
          {testLabel && (
            <span className="mb-3 flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs text-accent">
              <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" /> {testLabel}
            </span>
          )}
          <div className="max-h-[420px] overflow-y-auto pr-1">
            <Timeline items={items} running={running} />
          </div>
        </div>
      ) : null}

      {running ? (
        <button onClick={stop} className="rounded-lg border border-line px-4 py-2 text-sm text-ink-2 hover:bg-surface-2">
          Stop
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <label htmlFor="symptom" className="mb-1.5 block text-sm text-ink-2">
            What are you noticing? <span className="text-muted">(optional)</span>
          </label>
          <textarea
            id="symptom"
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            rows={2}
            placeholder="Rough idle, check engine light, strange noise…"
            className="mb-3 w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted"
          />
          <button type="submit" className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">
            <Icon name="wrench" size={16} /> Start diagnosis
          </button>
        </form>
      )}
    </section>
  );
}

function ReportStep({ onRerun }: { onRerun: () => void }) {
  const { diagnosis, dtcs, vehicle, isSim, scenario, actualScenario, run } = useDiagnostics();
  if (!diagnosis) return null;
  return (
    <section>
      <StepTitle n={3} title="Your report" />
      <div className="mb-5 flex flex-wrap gap-2">
        <Link href="/technician" className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">
          <Icon name="chat" size={16} /> Ask a follow-up
        </Link>
        <button
          onClick={() => {
            onRerun();
            run();
          }}
          className="rounded-lg border border-line px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
        >
          Diagnose again
        </button>
        <Link href="/diagnostics" className="rounded-lg border border-line px-4 py-2 text-sm text-ink-2 hover:bg-surface-2">
          Live data
        </Link>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DiagnosisReport d={diagnosis} />
        </div>
        <div className="space-y-4">
          <DtcPanel dtcs={dtcs} vin={vehicle?.vin} />
          {isSim && actualScenario && scenario === "mystery" && (
            <div className="panel px-4 py-3 text-xs text-ink-2">
              Actual demo fault: <span className="text-ink">{SCENARIOS.find((s) => s.id === actualScenario)?.name}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
