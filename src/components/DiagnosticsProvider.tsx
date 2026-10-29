"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Elm327 } from "@/lib/obd/elm327";
import { connectObd, type ConnectMode } from "@/lib/obd/connect";
import { SCENARIOS, SimulatorTransport, type ScenarioId } from "@/lib/obd/simulator";
import { SerialTransport } from "@/lib/obd/serial";
import { BleTransport } from "@/lib/obd/ble";
import { DASHBOARD_PIDS } from "@/lib/obd/pids";
import type { WireLogEntry } from "@/lib/obd/transport";
import type Anthropic from "@anthropic-ai/sdk";
import { runConversation, runQuickDiagnosis, type AgentEvent } from "@/lib/agent/runner";
import type { Diagnosis, MonitorSample } from "@/lib/agent/executor";
import type { TimelineItem } from "@/components/Panels";
import { ReportSheet } from "@/components/ReportSheet";

export type Status = "disconnected" | "connecting" | "connected";
export type Dtcs = { stored: string[]; pending: string[]; permanent: string[] };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; calls: number; model: string };

const HISTORY_MS = 120_000;
const FAST_PIDS = ["o2b1s1", "o2b1s2", "rpm", "stft1"];
// Claude Opus 5.5 list prices, USD per million tokens.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

/**
 * Owns the OBD connection, live-data polling and the AI technician run, so the
 * Diagnostics and AI Technician tabs share one adapter session and a diagnosis
 * keeps running while you switch tabs.
 */
export function DiagnosticsProvider({ children }: { children: React.ReactNode }) {
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
  const [support, setSupport] = useState({ serial: false, ble: false });
  // The printable report sheet, opened from the report's "View report sheet" button.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportMeta, setReportMeta] = useState<{ complaint: string; at: Date } | null>(null);
  const complaintRef = useRef("");

  const elmRef = useRef<Elm327 | null>(null);
  const historyRef = useRef<MonitorSample[]>([]);
  const wireRef = useRef<WireLogEntry[]>([]);
  const pollPaused = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const messagesRef = useRef<Anthropic.Beta.BetaMessageParam[]>([]);

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
    // Keep the chat so questions asked before connecting carry over; the old report belonged to the previous car.
    setDiagnosis(null);
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

  /** Sends one chat message to the technician; the conversation continues across messages. */
  const send = async (text: string, shown = text, quick = false) => {
    if ((!quick && !text.trim()) || running) return;
    const elm = elmRef.current ?? undefined;
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setItems((prev) => [...prev, { id: ++idRef.current, kind: "user", text: shown }]);
    const messages = messagesRef.current;
    const before = messages.length;
    if (!quick) messages.push({ role: "user", content: elm ? text : `${text}\n\n[No vehicle is connected right now.]` });
    const sim = elm?.transport instanceof SimulatorTransport ? elm.transport.vehicle : undefined;
    try {
      const execCtx: Parameters<typeof runConversation>[1] = {
        elm,
        vin: vehicle?.vin,
        vehicle: sim,
        signal: ac.signal,
        // Hands-off: the demo car's virtual driver performs test conditions; a real car stays at idle.
        requestDriverAction: async () => !!sim,
        confirmClear: async () => false,
        onMonitorStart: (label) => {
          pollPaused.current = true;
          setTestLabel(label);
        },
        onMonitorSample: pushSample,
        onDtcs: setDtcs,
        onDiagnosis: (d) => {
          setDiagnosis(d);
          setReportMeta({ complaint: complaintRef.current, at: new Date() });
        },
      };
      const onEvent = (e: AgentEvent) => {
        if (e.type === "tool_result") {
          pollPaused.current = false;
          setTestLabel(null);
        }
        applyEvent(e);
      };
      // A full diagnosis collects every measurement in one pass and asks for the report once.
      if (quick) await runQuickDiagnosis(messages, text, execCtx, onEvent);
      else await runConversation(messages, execCtx, onEvent);
    } catch (e) {
      // Drop the unfinished exchange so the transcript never ends in an unanswered tool call.
      messages.length = before;
      if ((e as Error).name !== "AbortError") applyEvent({ type: "error", error: (e as Error).message });
      else applyEvent({ type: "error", error: "Stopped." });
    } finally {
      pollPaused.current = false;
      setTestLabel(null);
      setRunning(false);
      sim?.setMode("idle");
    }
  };

  const run = () => {
    complaintRef.current = complaint;
    return send(complaint, `Run a full diagnosis${complaint ? `: ${complaint}` : ""}`, true);
  };

  const newChat = () => {
    abortRef.current?.abort();
    messagesRef.current = [];
    setItems([]);
    setDiagnosis(null);
    setUsage(null);
  };

  const cost = usage ? (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1e6 : 0;
  const connected = status === "connected";
  const isSim = vehicle?.transport.startsWith("Simulator");

  const value = {
    mode, setMode, scenario, setScenario, actualScenario, status, connError, vehicle, live, history, dtcs, wire,
    complaint, setComplaint, running, items, diagnosis, usage, testLabel, support, cost, connected, isSim: !!isSim,
    connect, disconnect, run, send, newChat, reportMeta, openSheet: () => setSheetOpen(true), stop: () => abortRef.current?.abort(),
  };

  return (
    <DiagnosticsContext.Provider value={value}>
      {children}
      {sheetOpen && diagnosis && <ReportSheet onClose={() => setSheetOpen(false)} />}
    </DiagnosticsContext.Provider>
  );
}

type DiagnosticsState = {
  mode: ConnectMode;
  setMode: (m: ConnectMode) => void;
  scenario: ScenarioId | "mystery";
  setScenario: (s: ScenarioId | "mystery") => void;
  actualScenario: ScenarioId | null;
  status: Status;
  connError: string | null;
  vehicle: { vin: string | null; protocol: string; adapter: string; transport: string } | null;
  live: Record<string, number | null>;
  history: MonitorSample[];
  dtcs: Dtcs | null;
  wire: WireLogEntry[];
  complaint: string;
  setComplaint: (c: string) => void;
  running: boolean;
  items: TimelineItem[];
  diagnosis: Diagnosis | null;
  /** When the latest report was made and the concern it was run for. */
  reportMeta: { complaint: string; at: Date } | null;
  openSheet: () => void;
  usage: Usage | null;
  testLabel: string | null;
  support: { serial: boolean; ble: boolean };
  cost: number;
  connected: boolean;
  isSim: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  run: () => Promise<void>;
  send: (text: string) => Promise<void>;
  newChat: () => void;
  stop: () => void;
};

const DiagnosticsContext = createContext<DiagnosticsState | null>(null);

export function useDiagnostics(): DiagnosticsState {
  const ctx = useContext(DiagnosticsContext);
  if (!ctx) throw new Error("useDiagnostics must be used inside DiagnosticsProvider");
  return ctx;
}
