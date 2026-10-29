import type Anthropic from "@anthropic-ai/sdk";
import { ToolInputs, type ToolName } from "./tools";
import { executeTool, type ExecContext } from "./executor";

type Msg = Anthropic.Beta.BetaMessageParam;

export type AgentEvent =
  | { type: "step_start"; step: number }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "block_start"; block: string; name?: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; result: unknown; isError: boolean; ms: number }
  | { type: "usage"; usage: Anthropic.Beta.BetaUsage; model: string }
  | { type: "done"; reason: string }
  | { type: "error"; error: string };

const MAX_STEPS = 40;

/**
 * Client-side agent loop: the model runs on our API route; its tools run here,
 * next to the OBD adapter.
 */
export async function runAgent(complaint: string, ctx: ExecContext, emit: (e: AgentEvent) => void): Promise<void> {
  const messages: Msg[] = [{ role: "user", content: diagnoseRequest(complaint) }];
  return runConversation(messages, ctx, emit);
}

export function diagnoseRequest(complaint: string) {
  return `Diagnose this vehicle. Owner's complaint: "${complaint || "No specific complaint; run a full health check."}"`;
}

/**
 * Runs the model on an ongoing chat transcript until it stops calling tools.
 * The transcript is appended in place, so the next user message continues
 * the same conversation.
 */
export async function runConversation(messages: Msg[], ctx: ExecContext, emit: (e: AgentEvent) => void, mode?: "report"): Promise<void> {
  for (let step = 0; step < MAX_STEPS; step++) {
    emit({ type: "step_start", step });
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, mode }),
      signal: ctx.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Agent API returned ${res.status}`);

    let final: Anthropic.Beta.BetaMessage | null = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "thinking") emit({ type: "thinking", text: ev.text });
        else if (ev.type === "text") emit({ type: "text", text: ev.text });
        else if (ev.type === "block_start") emit({ type: "block_start", block: ev.block, name: ev.name });
        else if (ev.type === "message") final = ev.message;
        else if (ev.type === "error") throw new Error(ev.error);
      }
    }
    if (!final) throw new Error("Agent stream ended without a message");
    emit({ type: "usage", usage: final.usage, model: final.model });

    if (final.stop_reason === "refusal") {
      emit({ type: "error", error: "The model declined this request." });
      return;
    }
    messages.push({ role: "assistant", content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (final.stop_reason === "pause_turn") continue;

    const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      emit({ type: "done", reason: final.stop_reason ?? "end_turn" });
      return;
    }
    if (final.stop_reason === "max_tokens") throw new Error("Model output was truncated mid tool call (max_tokens)");

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      emit({ type: "tool_call", id: tu.id, name: tu.name, input: tu.input });
      const t0 = performance.now();
      const schema = ToolInputs[tu.name as ToolName];
      let result: unknown;
      let isError = false;
      if (!schema) {
        result = { error: `Unknown tool ${tu.name}` };
        isError = true;
      } else {
        const parsed = schema.safeParse(tu.input);
        if (!parsed.success) {
          result = { INVALID_INPUT: JSON.stringify(tu.input), issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
          isError = true;
        } else {
          try {
            result = await executeTool(tu.name as ToolName, parsed.data, ctx);
          } catch (e) {
            if ((e as Error).name === "AbortError") throw e;
            result = { error: (e as Error).message };
            isError = true;
          }
        }
      }
      emit({ type: "tool_result", id: tu.id, result, isError, ms: Math.round(performance.now() - t0) });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result), is_error: isError || undefined });
    }
    messages.push({ role: "user", content: results });
    // The report is the whole job in report mode; skip the model's closing turn.
    if (mode === "report" && toolUses.some((t) => t.name === "submit_diagnosis") && !results.some((r) => r.is_error)) {
      emit({ type: "done", reason: "report_submitted" });
      return;
    }
  }
  emit({ type: "error", error: `Stopped after ${MAX_STEPS} steps` });
}

const FUEL_PIDS = ["rpm", "stft1", "ltft1", "maf", "o2b1s1", "o2b1s2"];

/**
 * Fast full diagnosis (about 20 s instead of minutes): the browser collects every
 * measurement in one fixed pass (codes, freeze frame, knowledge base, idle and, on the
 * demo car, 2500 rpm sensor windows), then a single model call writes the report.
 */
export async function runQuickDiagnosis(messages: Msg[], complaint: string, ctx: ExecContext, emit: (e: AgentEvent) => void): Promise<void> {
  let n = 0;
  const call = async (name: ToolName, input: unknown) => {
    const id = `quick_${Date.now()}_${n++}`;
    emit({ type: "tool_call", id, name, input });
    const t0 = performance.now();
    let result: unknown;
    let isError = false;
    try {
      result = await executeTool(name, input, ctx);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      result = { error: (e as Error).message };
      isError = true;
    }
    emit({ type: "tool_result", id, result, isError, ms: Math.round(performance.now() - t0) });
    return result;
  };

  const evidence: Record<string, unknown> = {};
  evidence.vehicle = await call("get_vehicle_info", {});
  const dtcs = (await call("read_dtcs", {})) as { stored?: { code: string }[]; pending?: { code: string }[]; permanent?: { code: string }[] };
  evidence.trouble_codes = dtcs;
  evidence.freeze_frame = await call("read_freeze_frame", {});
  const codes = [...new Set([...(dtcs.stored ?? []), ...(dtcs.pending ?? []), ...(dtcs.permanent ?? [])].map((c) => c.code))];
  // Knowledge-base lookups are network calls, so they run while the adapter samples.
  const lookups = Promise.all(codes.map((code) => call("lookup_dtc", { code })));
  evidence.snapshot = await call("read_live_data", { pids: ["coolant", "voltage", "iat", "load", "throttle", "runtime"] });
  evidence.idle = await call("monitor_pids", { pids: FUEL_PIDS, duration_s: 3, label: "warm idle" });
  if (ctx.vehicle) {
    // Only the demo car can change its own operating condition; a real car is tested at idle.
    await call("request_driver_action", { action: "hold_2500", instruction: "Steady 2500 rpm" });
    evidence.rpm_2500 = await call("monitor_pids", { pids: FUEL_PIDS, duration_s: 3, label: "steady 2500 rpm" });
    await call("request_driver_action", { action: "idle", instruction: "Back to idle" });
  }
  evidence.code_lookups = await lookups;

  messages.push({
    role: "user",
    content: `${diagnoseRequest(complaint)}

Every measurement has already been collected for you (below): codes, freeze frame, knowledge-base entries, and live sensor windows${ctx.vehicle ? " at idle and at a steady 2500 rpm" : " at idle"}. Do not ask for more data. Reason over these numbers and call submit_diagnosis now with the complete report. Keep it tight: 3-7 repair steps, only the parts actually needed, cite measured values as evidence.

<measurements>
${JSON.stringify(evidence)}
</measurements>`,
  });
  return runConversation(messages, ctx, emit, "report");
}
