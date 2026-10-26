import type Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent } from "../agent/runner";
import { ROLE_BY_ID, TeamToolInputs, type RoleId, type TeamToolName } from "./team";
import type { Review, Workbench } from "./workbench";

type Msg = Anthropic.Beta.BetaMessageParam;

export type TeamEvent = AgentEvent & { role: RoleId; round: number };

const MAX_STEPS = 30;
export const MAX_ROUNDS = 3;

/** Reads one NDJSON-streamed model step from /api/tune-agent. */
async function step(role: RoleId, messages: Msg[], signal: AbortSignal, emit: (e: AgentEvent) => void): Promise<Anthropic.Beta.BetaMessage> {
  const res = await fetch("/api/tune-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, messages }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Tune agent API returned ${res.status}`);
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
  return final;
}

/** Runs one agent until it calls its finishing tool. Tools execute on the workbench in the browser. */
async function runRole(role: RoleId, brief: string, wb: Workbench, signal: AbortSignal, emit: (e: AgentEvent) => void) {
  const def = ROLE_BY_ID[role];
  const messages: Msg[] = [{ role: "user", content: brief }];
  for (let i = 0; i < MAX_STEPS; i++) {
    emit({ type: "step_start", step: i });
    const final = await step(role, messages, signal, emit);
    emit({ type: "usage", usage: final.usage, model: final.model });
    if (final.stop_reason === "refusal") throw new Error(`${def.title} declined this request.`);
    messages.push({ role: "assistant", content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (final.stop_reason === "pause_turn") continue;
    const uses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      // Nudge an agent that stops talking without handing over its work.
      messages.push({ role: "user", content: `Finish by calling ${def.finish}.` });
      continue;
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let finished = false;
    for (const tu of uses) {
      emit({ type: "tool_call", id: tu.id, name: tu.name, input: tu.input });
      const t0 = performance.now();
      let result: unknown;
      let isError = false;
      const schema = def.tools.includes(tu.name as TeamToolName) ? TeamToolInputs[tu.name as TeamToolName] : undefined;
      const parsed = schema?.safeParse(tu.input);
      if (!schema) {
        result = { error: `Tool ${tu.name} is not available to the ${def.title}` };
        isError = true;
      } else if (!parsed!.success) {
        result = { INVALID_INPUT: JSON.stringify(tu.input), issues: parsed!.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) };
        isError = true;
      } else {
        try {
          result = wb.execute(tu.name as TeamToolName, parsed!.data);
          if (tu.name === def.finish) finished = true;
        } catch (e) {
          result = { error: (e as Error).message };
          isError = true;
        }
      }
      emit({ type: "tool_result", id: tu.id, result, isError, ms: Math.round(performance.now() - t0) });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result), is_error: isError || undefined });
    }
    if (finished) return;
    messages.push({ role: "user", content: results });
  }
  throw new Error(`${def.title} did not finish within ${MAX_STEPS} steps`);
}

/**
 * The tuning pipeline: the lead tuner plans, then calibration, simulation and
 * QA iterate until QA approves or the round limit is reached.
 */
export async function runTeam(goal: string, wb: Workbench, signal: AbortSignal, emit: (e: TeamEvent) => void): Promise<"approved" | "rejected"> {
  const tag = (role: RoleId, round: number) => (e: AgentEvent) => emit({ ...e, role, round });

  await runRole("lead", `The owner wants: "${goal || "More power, still safe as a daily driver."}"\nThey will run ${wb.octane} octane fuel. Scan the engine and write the tuning plan.`, wb, signal, tag("lead", 0));

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const fixes = wb.previousFixes.length ? `\nQA rejected the previous round. Required fixes:\n- ${wb.previousFixes.join("\n- ")}` : "";
    await runRole("calibration", `Round ${round}. Develop the calibration to the lead tuner's plan (call get_plan).${fixes}`, wb, signal, tag("calibration", round));
    wb.simReport = null;
    await runRole("simulation", `Round ${round}. The calibration engineer submitted: ${JSON.stringify(wb.calibration)}. Validate the candidate tune.`, wb, signal, tag("simulation", round));
    wb.review = null;
    await runRole(
      "qa",
      `Round ${round} of at most ${MAX_ROUNDS}. Calibration changelog: ${JSON.stringify(wb.calibration)}\nSimulation report: ${JSON.stringify(wb.simReport)}\nReview the tune and approve or reject it.`,
      wb,
      signal,
      tag("qa", round),
    );
    // Set by the QA agent's submit_review call inside runRole.
    const review = wb.review as Review | null;
    if (review?.verdict === "approve") return "approved";
    wb.previousFixes = review?.required_fixes ?? [];
  }
  return "rejected";
}
