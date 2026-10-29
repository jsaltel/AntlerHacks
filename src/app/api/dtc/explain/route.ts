import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { client, MODEL } from "@/lib/agent/stream";
import { describeDtc } from "@/lib/kb/dtc-db";
import { DtcExplanation } from "@/lib/kb/explain";
import { brandFromVin, brandLabel } from "@/lib/kb/vin";

export const runtime = "nodejs";

const SYSTEM = `You are a master automotive technician explaining one trouble code to a car owner who is not a mechanic. Use what you know about this make (and engine, if the VIN tells you) to get the meaning, causes and fixes right, but write for the owner: short plain sentences, everyday words, no acronyms or part numbers, no hedging. Keep to the word limits in the schema. If the local database has no definition, use your knowledge of that manufacturer's codes. Prices in US dollars for parts plus typical independent-shop labor.`;

// Explanations don't change for a given code and make, so keep them for the life of the server.
const cache = new Map<string, DtcExplanation>();

/** POST { code, vin } → the AI technician's explanation of that code for this car's make. */
export async function POST(req: Request) {
  const { code: raw, vin } = (await req.json()) as { code?: string; vin?: string | null };
  const code = (raw ?? "").trim().toUpperCase();
  if (!/^[PCBU][0-9A-F]{4}$/.test(code)) return Response.json({ error: "Invalid code" }, { status: 400 });
  const brand = brandFromVin(vin);
  const key = `v2:${brand ?? "?"}:${code}`;
  const hit = cache.get(key);
  if (hit) return Response.json({ explanation: hit });

  const known = await describeDtc(code, brand);
  const prompt = `Code: ${code}
Make: ${brand ? brandLabel(brand) : "unknown"}${vin ? `\nVIN: ${vin}` : ""}
Local database entry: ${JSON.stringify(known)}`;

  const ask = (fast: boolean) =>
    client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: fast ? ["server-side-fallback-2026-07-01", "fast-mode-2026-02-01"] : ["server-side-fallback-2026-07-01"],
      ...(fast && { speed: "fast" as const }),
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(DtcExplanation) },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

  try {
    let res;
    try {
      res = await ask(true);
    } catch (err) {
      // Fast mode has its own rate limit; fall back to standard speed.
      if (!(err instanceof Anthropic.RateLimitError || err instanceof Anthropic.BadRequestError)) throw err;
      res = await ask(false);
    }
    if (res.stop_reason === "refusal" || !res.parsed_output) return Response.json({ error: "No explanation available for this code." }, { status: 502 });
    cache.set(key, res.parsed_output);
    return Response.json({ explanation: res.parsed_output });
  } catch (err) {
    const msg = err instanceof Anthropic.AuthenticationError ? "Anthropic API key missing or invalid." : err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
