"use client";
import { useRef } from "react";
import { SCENARIOS } from "@/lib/obd/simulator";
import { ConnectionBar } from "@/components/ConnectionBar";
import { useDiagnostics } from "@/components/DiagnosticsProvider";
import { DiagnosisReport, DtcPanel, Gauges, Timeline } from "@/components/Panels";

const SUGGESTIONS = ["What do my trouble codes mean?", "Is my car safe to drive right now?", "My engine idles rough when cold. What could it be?", "What does P0420 mean and how much does it cost to fix?"];

export default function Technician() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { live, dtcs, complaint, setComplaint, running, items, diagnosis, usage, cost, testLabel, connected, isSim, scenario, actualScenario, run, send, newChat, stop } = useDiagnostics();
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <ConnectionBar title="AI technician" />
      <main className="grid grid-cols-12 gap-5">
        <section className="col-span-12 lg:col-span-7">
          <div className="panel flex h-[calc(100vh-150px)] min-h-[560px] flex-col p-4">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-sm font-medium text-ink">Chat with the technician</h2>
              {usage && (
                <span className="tabular text-[11px] text-muted" title={`${usage.model} · ${usage.calls} model calls · ${usage.cacheRead.toLocaleString()} cached input tokens`}>
                  {usage.calls} steps · ${cost.toFixed(3)}
                </span>
              )}
              {items.length > 0 && (
                <button onClick={newChat} disabled={running} className="ml-auto text-xs text-ink-2 hover:text-ink disabled:opacity-40">
                  New chat
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {items.length === 0 && !running ? (
                <div className="mt-6 text-center">
                  <p className="mb-4 text-sm text-muted">
                    Ask anything about your car: a warning light, a noise, a code, whether it&apos;s safe to drive, or how to fix something.
                    {connected ? " The technician can read live data and codes from the car while it answers." : " Connect the car for answers based on live data."}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((q) => (
                      <button key={q} onClick={() => send(q)} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs text-ink-2 hover:text-ink">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <Timeline items={items} running={running} />
              )}
            </div>
            {testLabel && (
              <span className="mt-2 flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs text-accent">
                <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" /> Running test: {testLabel}
              </span>
            )}
            <form
              className="mt-3 border-t border-line pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const q = complaint;
                setComplaint("");
                send(q);
              }}
            >
              <div className="flex items-center rounded-lg border border-line bg-surface-2 pl-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,.log,.txt,.csv,.json"
                  multiple
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden
                />
                <button
                  type="button"
                  title="add an image, video or log..."
                  aria-label="add an image, video or log..."
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg leading-none text-ink-2 hover:bg-page hover:text-ink"
                >
                  +
                </button>
                <textarea
                  id="complaint"
                  value={complaint}
                  onChange={(e) => setComplaint(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={1}
                  placeholder="Describe a problem or ask a question… (Enter to send, Shift+Enter for a new line)"
                  aria-label="Message the AI technician"
                  className="field-sizing-content max-h-32 min-h-8 w-full flex-1 resize-none bg-transparent py-1.5 pl-2 pr-3 text-sm leading-5 text-ink placeholder:text-muted"
                />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    run();
                    setComplaint("");
                  }}
                  disabled={!connected || running}
                  title={connected ? "Read codes, run live tests and write a full report" : "Connect a car first"}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                >
                  Run full diagnosis
                </button>
                <span className="text-[11px] text-muted">{connected ? "uses the text box as the complaint" : "needs a connected car"}</span>
                {running ? (
                  <button type="button" onClick={stop} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2">
                    Stop
                  </button>
                ) : (
                  <button type="submit" disabled={!complaint.trim()} className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                    Send
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>

        <section className="col-span-12 space-y-4 lg:col-span-5">
          <Gauges values={live} />
          {diagnosis && <DiagnosisReport d={diagnosis} />}
          {diagnosis && isSim && actualScenario && scenario === "mystery" && (
            <div className="panel px-4 py-3 text-xs text-ink-2">
              Simulator ground truth: <span className="text-ink">{SCENARIOS.find((s) => s.id === actualScenario)?.name}</span> ({actualScenario.replaceAll("_", " ")})
            </div>
          )}
          <DtcPanel dtcs={dtcs} />
        </section>
      </main>
    </div>
  );
}
