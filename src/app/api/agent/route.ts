import type Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { streamTurn } from "@/lib/agent/stream";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One agent step. The browser owns the loop because the tools run against the
 * OBD adapter plugged into the user's machine: it posts the transcript, we
 * stream Claude's turn back as NDJSON, and the browser executes any tool calls
 * and posts again with the results appended.
 */
export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: Anthropic.Beta.BetaMessageParam[] };
  return streamTurn({ system: SYSTEM_PROMPT, tools: TOOL_DEFINITIONS, messages });
}
