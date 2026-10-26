import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TOOL_DEFINITIONS } from "@/lib/agent/tools";

export const runtime = "nodejs";
export const maxDuration = 300;

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

/**
 * One agent step. The browser owns the loop because the tools run against the
 * OBD adapter plugged into the user's machine: it posts the transcript, we
 * stream Claude's turn back as NDJSON, and the browser executes any tool calls
 * and posts again with the results appended.
 */
export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: Anthropic.Beta.BetaMessageParam[] };

  const body = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"));
      try {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
          cache_control: { type: "ephemeral" },
          system: SYSTEM_PROMPT,
          tools: TOOL_DEFINITIONS,
          messages,
        });
        for await (const ev of stream) {
          if (ev.type === "content_block_start") {
            send({ type: "block_start", index: ev.index, block: ev.content_block.type, name: ev.content_block.type === "tool_use" ? ev.content_block.name : undefined });
          } else if (ev.type === "content_block_delta") {
            if (ev.delta.type === "text_delta") send({ type: "text", index: ev.index, text: ev.delta.text });
            else if (ev.delta.type === "thinking_delta") send({ type: "thinking", index: ev.index, text: ev.delta.thinking });
          }
        }
        const message = await stream.finalMessage();
        send({ type: "message", message });
      } catch (err) {
        const status = err instanceof Anthropic.APIError ? err.status : undefined;
        const msg =
          err instanceof Anthropic.AuthenticationError
            ? "Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY in .env.local."
            : err instanceof Anthropic.RateLimitError
              ? "Rate limited by the Anthropic API. Wait a moment and retry."
              : err instanceof Error
                ? err.message
                : String(err);
        send({ type: "error", status, error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
