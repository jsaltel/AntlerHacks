import type Anthropic from "@anthropic-ai/sdk";
import { ROLE_BY_ID, toolDefinitionsFor, type RoleId } from "@/lib/tune/team";
import { streamTurn } from "@/lib/agent/stream";

export const runtime = "nodejs";
export const maxDuration = 300;

/** One step of one tuning-team agent. The browser runs the loop and the simulator. */
export async function POST(req: Request) {
  const { role, messages } = (await req.json()) as { role: RoleId; messages: Anthropic.Beta.BetaMessageParam[] };
  const def = ROLE_BY_ID[role];
  if (!def) return Response.json({ error: `Unknown role ${role}` }, { status: 400 });
  return streamTurn({ system: def.prompt, tools: toolDefinitionsFor(def), messages, effort: def.effort });
}
