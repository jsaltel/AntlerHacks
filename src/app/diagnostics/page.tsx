"use client";
import Link from "next/link";
import { LineChart } from "@/components/LineChart";
import { ConnectionBar } from "@/components/ConnectionBar";
import { useDiagnostics } from "@/components/DiagnosticsProvider";
import { DiagnosisReport, DtcPanel, Gauges, WireLog } from "@/components/Panels";

export default function Diagnostics() {
  const { live, history, dtcs, wire, diagnosis, running, testLabel, connected } = useDiagnostics();
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <ConnectionBar title="Live diagnostics" />
      <main className="grid grid-cols-12 gap-5">
        <section className="col-span-12 space-y-4 lg:col-span-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">Live data</h2>
            {testLabel && (
              <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs text-accent">
                <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" /> Agent test: {testLabel}
              </span>
            )}
          </div>
          <Gauges values={live} />
          <div className="grid gap-4 xl:grid-cols-2">
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
          </div>
          <LineChart title="Engine speed" unit="rpm" series={[{ key: "rpm", label: "RPM", color: "var(--series-1)" }]} data={history} yMin={0} yMax={5000} />
        </section>

        <section className="col-span-12 space-y-4 lg:col-span-4">
          <div className="panel flex items-center justify-between gap-3 p-4">
            <div className="text-sm text-ink-2">
              {running ? "The AI technician is diagnosing this car." : diagnosis ? "Diagnosis report ready." : connected ? "Want a full diagnosis with live tests?" : "Connect, then let the AI technician diagnose the car."}
            </div>
            <Link href="/technician" className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white">
              {running ? "Watch" : diagnosis ? "Open" : "AI technician"} →
            </Link>
          </div>
          {diagnosis && <DiagnosisReport d={diagnosis} />}
          <DtcPanel dtcs={dtcs} />
          <WireLog log={wire} />
        </section>
      </main>
    </div>
  );
}
