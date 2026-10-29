import type { Elm327 } from "../obd/elm327";
import type { VehicleModel, DriveMode } from "../obd/simulator";
import { PID_BY_KEY } from "../obd/pids";
import { DTC_KB, lookupDtc } from "../kb/dtcs";
import { fetchDtcs } from "../kb/dtc-client";
import type { ToolInputs, ToolName } from "./tools";
import type { z } from "zod";

export type Diagnosis = z.infer<(typeof ToolInputs)["submit_diagnosis"]>;

export interface MonitorSample {
  t: number;
  values: Record<string, number | null>;
}

export interface ExecContext {
  /** Absent when chatting without a car connected; only knowledge-base tools work then. */
  elm?: Elm327;
  /** The car's VIN, used to pick the right brand table for manufacturer-specific codes. */
  vin?: string | null;
  /** Present in simulator mode: driver actions are applied to the vehicle model. */
  vehicle?: VehicleModel;
  requestDriverAction(action: DriveMode, instruction: string): Promise<boolean>;
  confirmClear(reason: string): Promise<boolean>;
  onMonitorStart(label: string, pids: string[], durationS: number): void;
  onMonitorSample(sample: MonitorSample): void;
  onDtcs(report: { stored: string[]; pending: string[]; permanent: string[] }): void;
  onDiagnosis(d: Diagnosis): void;
  signal: AbortSignal;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function stats(key: string, xs: number[], durationS: number) {
  if (!xs.length) return { key, unsupported: true };
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const stdev = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const third = Math.max(1, Math.floor(n / 3));
  const head = xs.slice(0, third).reduce((a, b) => a + b, 0) / third;
  const tail = xs.slice(-third).reduce((a, b) => a + b, 0) / third;
  const def = PID_BY_KEY[key];
  const out: Record<string, unknown> = {
    key,
    name: def.name,
    unit: def.unit,
    samples: n,
    min: r2(Math.min(...xs)),
    max: r2(Math.max(...xs)),
    mean: r2(mean),
    stdev: r2(stdev),
    trend: r2(tail - head),
  };
  if (key.startsWith("o2")) {
    let crossings = 0;
    for (let i = 1; i < n; i++) if ((xs[i - 1] - 0.45) * (xs[i] - 0.45) < 0) crossings++;
    out.switches_per_s = r2(crossings / 2 / durationS);
    out.pct_time_rich = Math.round((xs.filter((x) => x > 0.45).length / n) * 100);
  }
  return out;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), rej(new DOMException("Aborted", "AbortError"))), { once: true });
  });

/** Runs one validated tool call against the live adapter. Returns JSON-serializable output. */
const OFFLINE_TOOLS: ToolName[] = ["lookup_dtc", "submit_diagnosis"];

export async function executeTool(name: ToolName, input: unknown, ctx: ExecContext): Promise<unknown> {
  if (!ctx.elm && !OFFLINE_TOOLS.includes(name))
    throw new Error("No vehicle is connected. Answer from your knowledge (lookup_dtc still works) or ask the person to connect the adapter or start the simulator.");
  const elm = ctx.elm!;
  switch (name) {
    case "get_vehicle_info": {
      const vin = await elm.readVin();
      return {
        vin,
        adapter: elm.info?.version,
        protocol: elm.info?.protocol,
        battery_voltage: elm.info?.batteryVoltage,
        supported_pids: elm.describeSupported(),
        transport: elm.transport.label,
      };
    }
    case "read_dtcs": {
      const rep = await elm.readDtcs();
      ctx.onDtcs(rep);
      const found = await fetchDtcs([...rep.stored, ...rep.pending, ...rep.permanent], ctx.vin).catch(() => []);
      const describe = (c: string) => {
        const f = found.find((x) => x.code === c);
        return { code: c, title: f?.title ?? lookupDtc(c).title, ...(f?.make && { make: f.make }) };
      };
      return { stored: rep.stored.map(describe), pending: rep.pending.map(describe), permanent: rep.permanent.map(describe) };
    }
    case "read_freeze_frame": {
      const ff = await elm.readFreezeFrame();
      return ff ?? { freeze_frame: null, note: "No freeze frame stored (no confirmed code, or codes were cleared)." };
    }
    case "read_live_data": {
      const { pids } = input as { pids: string[] };
      const values = await elm.readPids(pids);
      return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === null ? "unsupported" : `${v} ${PID_BY_KEY[k].unit}`]));
    }
    case "monitor_pids": {
      const { pids, duration_s, label } = input as { pids: string[]; duration_s: number; label: string };
      ctx.onMonitorStart(label, pids, duration_s);
      const series: Record<string, number[]> = Object.fromEntries(pids.map((p) => [p, []]));
      const start = Date.now();
      while (Date.now() - start < duration_s * 1000) {
        if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const values = await elm.readPids(pids);
        for (const p of pids) if (values[p] !== null) series[p].push(values[p]!);
        ctx.onMonitorSample({ t: Date.now(), values });
        await sleep(60, ctx.signal);
      }
      const actual = (Date.now() - start) / 1000;
      return { condition: label, duration_s: r2(actual), stats: pids.map((p) => stats(p, series[p], actual)) };
    }
    case "request_driver_action": {
      const { action, instruction } = input as { action: DriveMode; instruction: string };
      const ok = await ctx.requestDriverAction(action, instruction);
      if (!ok) return { done: false, note: "The person declined or could not perform this action. Continue without it." };
      ctx.vehicle?.setMode(action);
      // Give the engine and fuel control a moment to settle before measuring.
      await sleep(action === "snap_throttle" ? 300 : 2500, ctx.signal);
      return { done: true, action };
    }
    case "lookup_dtc": {
      const code = (input as { code: string }).code.toUpperCase();
      const [found] = await fetchDtcs([code], ctx.vin).catch(() => []);
      const expert = DTC_KB[code];
      return {
        ...(found ?? lookupDtc(code)),
        // Hand-written workshop notes, for the most common codes.
        ...(expert && { severity: expert.severity, workshop_causes: expert.causes, discriminators: expert.discriminators, cost_usd: expert.costUsd }),
      };
    }
    case "clear_dtcs": {
      const ok = await ctx.confirmClear((input as { reason: string }).reason);
      if (!ok) return { cleared: false, note: "The person declined clearing codes." };
      const cleared = await elm.clearDtcs();
      ctx.onDtcs(await elm.readDtcs());
      return { cleared };
    }
    case "submit_diagnosis": {
      ctx.onDiagnosis(input as Diagnosis);
      return { received: true };
    }
  }
}
