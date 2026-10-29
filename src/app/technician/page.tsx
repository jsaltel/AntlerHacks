"use client";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { isAttachable, kindOf, type AttachmentKind } from "@/lib/agent/attachments";
import { DialCluster } from "@/components/Dial";
import { SCENARIOS } from "@/lib/obd/simulator";
import { ConnectionBar } from "@/components/ConnectionBar";
import { useDiagnostics } from "@/components/DiagnosticsProvider";
import { DiagnosisReport, DtcPanel, Gauges, Timeline } from "@/components/Panels";

const SUGGESTIONS = ["What do my trouble codes mean?", "Is my car safe to drive right now?", "My engine idles rough when cold. What could it be?", "What does P0420 mean and how much does it cost to fix?"];

type Attachment = { id: string; file: File; url: string; kind: AttachmentKind };

function filesFromClipboard(data: DataTransfer | null) {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file || !isAttachable(file)) return;
    const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  for (const file of Array.from(data.files ?? [])) push(file);
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") push(item.getAsFile());
  }
  return files;
}

function AttachmentPreview({ item, onRemove }: { item: Attachment; onRemove: (id: string) => void }) {
  return (
    <div className="relative" title={item.file.name}>
      {item.kind === "image" ? (
        <img src={item.url} alt={item.file.name} className="h-12 w-12 rounded-md object-cover" />
      ) : (
        <div className="flex h-12 min-w-12 items-center justify-center rounded-md border border-line bg-page px-1.5">
          <span className="font-mono text-[10px] leading-none text-ink-2">{item.file.name.slice(0, 10)}</span>
        </div>
      )}
      <button
        type="button"
        aria-label={`Remove ${item.file.name}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onRemove(item.id)}
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface-1 text-[10px] leading-none text-ink-2 hover:bg-page hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}

export default function Technician() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const complaintRef = useRef<HTMLTextAreaElement>(null);
  const focusComplaint = () => complaintRef.current?.focus({ preventScroll: true });
  const attachmentsRef = useRef<Attachment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  attachmentsRef.current = attachments;
  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) URL.revokeObjectURL(item.url);
    };
  }, []);
  const addFiles = (list: FileList | File[] | null) => {
    if (!list?.length) return;
    const next = Array.from(list)
      .filter(isAttachable)
      .map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      url: URL.createObjectURL(file),
      kind: kindOf(file),
    }));
    setAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const onPasteFiles = (e: ClipboardEvent) => {
    const files = filesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  };
  const removeFile = (id: string) => {
    setAttachments((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((a) => a.id !== id);
    });
    requestAnimationFrame(() => focusComplaint());
  };
  const consumeAttachments = () => {
    const current = attachmentsRef.current;
    const files = current.map((a) => a.file);
    for (const a of current) URL.revokeObjectURL(a.url);
    attachmentsRef.current = [];
    setAttachments([]);
    return files;
  };
  const { live, dtcs, vehicle, complaint, setComplaint, running, items, diagnosis, usage, cost, testLabel, connected, isSim, scenario, actualScenario, run, send, newChat, stop, openSheet } = useDiagnostics();
  const submitChat = () => {
    if (running) return;
    const files = attachmentsRef.current.map((a) => a.file);
    if (!complaint.trim() && files.length === 0) return;
    const q = complaint;
    consumeAttachments();
    setComplaint("");
    send(q, { files });
  };
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <ConnectionBar title="AI technician" description="Ask anything about your car." />
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
                    {connected ? "Ask about a light, a noise, a code or a repair. You can add a photo or a log with +." : "Connect your car for answers based on live data."}
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
                submitChat();
              }}
            >
              <div
                className="cursor-text rounded-lg border border-line bg-surface-2"
                onPaste={onPasteFiles}
                onMouseDown={(e) => {
                  const el = e.target instanceof Element ? e.target : (e.target as Node).parentElement;
                  if (!el) return;
                  if (el.closest("label[for='technician-attachments'], #technician-attachments, #complaint")) return;
                  e.preventDefault();
                  focusComplaint();
                }}
              >
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2.5 px-2.5 pt-2.5">
                    {attachments.map((item) => (
                      <AttachmentPreview key={item.id} item={item} onRemove={removeFile} />
                    ))}
                  </div>
                )}
                <div className="flex items-center pl-1.5">
                  <input
                    ref={fileInputRef}
                    id="technician-attachments"
                    type="file"
                    accept="image/*,.log,.txt,.csv,.json"
                    multiple
                    className="sr-only"
                    onChange={(e) => addFiles(e.target.files)}
                  />
                  <label
                    htmlFor="technician-attachments"
                    title="add an image or log..."
                    aria-label="add an image or log..."
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg leading-none text-ink-2 hover:bg-page hover:text-ink"
                  >
                    +
                  </label>
                  <textarea
                    id="complaint"
                    ref={complaintRef}
                    value={complaint}
                    onChange={(e) => setComplaint(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitChat();
                      }
                    }}
                    rows={1}
                    placeholder="Ask a question or add a photo or log…"
                    aria-label="Message the AI technician"
                    className="field-sizing-content max-h-32 min-h-8 w-full flex-1 resize-none bg-transparent py-1.5 pl-2 pr-3 text-sm leading-5 text-ink placeholder:text-muted"
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (running) return;
                    const files = consumeAttachments();
                    run(files);
                    setComplaint("");
                  }}
                  disabled={!connected || running}
                  title={connected ? "Read codes, run live tests and write a full report" : "Connect a car first"}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                >
                  Run full diagnosis
                </button>
                {running ? (
                  <button type="button" onClick={stop} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2">
                    Stop
                  </button>
                ) : (
                  <button type="button" onClick={submitChat} disabled={!complaint.trim() && attachments.length === 0} className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                    Send
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>

        <section className="col-span-12 space-y-4 lg:col-span-5">
          <DialCluster rpm={live.rpm} speed={live.speed} />
          <Gauges values={live} />
          {diagnosis && <DiagnosisReport d={diagnosis} onOpen={openSheet} />}
          {diagnosis && isSim && actualScenario && scenario === "mystery" && (
            <div className="panel px-4 py-3 text-xs text-ink-2">
              Simulator ground truth: <span className="text-ink">{SCENARIOS.find((s) => s.id === actualScenario)?.name}</span> ({actualScenario.replaceAll("_", " ")})
            </div>
          )}
          <DtcPanel dtcs={dtcs} vin={vehicle?.vin} />
        </section>
      </main>
    </div>
  );
}
