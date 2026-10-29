import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic();
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

interface StreamArgs {
  system: string;
  tools: Anthropic.Beta.BetaToolUnion[];
  messages: Anthropic.Beta.BetaMessageParam[];
  effort?: "low" | "medium" | "high";
  /** Opus fast mode: same model, up to ~2.5x faster output at premium pricing. Falls back to standard speed if it is rejected or rate limited. */
  fast?: boolean;
}

/**
 * Streams one Claude turn back to the browser as NDJSON. The browser owns the
 * agent loop (tools run next to the adapter or the simulator), so each request
 * is a single model step.
 */
export function streamTurn({ system, tools, messages, effort = "high", fast = false }: StreamArgs): Response {
  const body = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"));
      const open = (speed: boolean) =>
        client.beta.messages.stream({
          model: MODEL,
          max_tokens: 32000,
          betas: speed ? ["server-side-fallback-2026-07-01", "fast-mode-2026-02-01"] : ["server-side-fallback-2026-07-01"],
          ...(speed && { speed: "fast" as const }),
          fallbacks: "default",
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort },
          cache_control: { type: "ephemeral" },
          system,
          tools,
          messages,
        });
      try {
        let stream = open(fast);
        if (fast) {
          // Fast mode has its own rate limit; if it is refused before any output, retry at standard speed.
          try {
            await stream.withResponse();
          } catch (err) {
            if (!(err instanceof Anthropic.RateLimitError || err instanceof Anthropic.BadRequestError)) throw err;
            stream = open(false);
          }
        }
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
