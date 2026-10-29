import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { client, MODEL } from "@/lib/agent/stream";
import { PartsResult, type PartsRequest } from "@/lib/kb/parts";
import { brandFromVin, brandLabel } from "@/lib/kb/vin";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM = `You find real replacement parts for a car repair. Use web search to find currently listed parts for this exact vehicle at US retailers (for example RockAuto, FCP Euro, Pelican Parts, ECS Tuning, AutoZone, Advance Auto Parts, O'Reilly, Amazon, or a dealer parts site). For each part the repair needs, report the brand, the part number exactly as listed, the carmaker's original part number when you find it, the current price and the product page URL. Prefer original-equipment brands (the carmaker's own part or its supplier, such as Bosch, Denso, NGK, Continental, Mahle) and give one good option per part. Only use URLs and prices that appeared in your search results; never invent them. If fit is unconfirmed, say so in fitment. Search efficiently, then call submit_parts once.`;

const schema = z.toJSONSchema(PartsResult) as Record<string, unknown>;
delete schema.$schema;
const SUBMIT = {
  name: "submit_parts",
  description: "Report the parts found for this repair. Call exactly once, after searching.",
  input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
};

// Parts listings for one repair on one vehicle; kept while the server runs.
const cache = new Map<string, PartsResult>();

/** Year, make, model and engine from NHTSA's free VIN decoder; null when unavailable. */
async function decodeVin(vin: string): Promise<string | null> {
  try {
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`, { signal: AbortSignal.timeout(5000) });
    const r = ((await res.json()) as { Results?: Record<string, string>[] }).Results?.[0];
    if (!r?.Make) return null;
    const engine = [r.DisplacementL && `${Number(r.DisplacementL).toFixed(1)} L`, r.EngineCylinders && `${r.EngineCylinders}-cyl`, r.EngineModel].filter(Boolean).join(" ");
    return [r.ModelYear, r.Make, r.Model, r.Trim, engine && `(${engine})`].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}

/** POST PartsRequest → real part numbers, prices and links for the repair, from web search. */
export async function POST(req: Request) {
  const body = (await req.json()) as PartsRequest;
  if (!body.cause) return Response.json({ error: "Missing repair" }, { status: 400 });
  const key = `${body.vin ?? ""}:${body.cause}`;
  const hit = cache.get(key);
  if (hit) return Response.json({ result: hit });

  const brand = brandFromVin(body.vin);
  const vehicle = (body.vin && (await decodeVin(body.vin))) || (brand ? brandLabel(brand) : "Unknown vehicle");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Vehicle: ${vehicle}${body.vin ? `\nVIN: ${body.vin}` : ""}
Repair: ${body.cause}
Fix: ${body.fix}
Parts the technician expects to need: ${body.parts.length ? body.parts.map((p) => `${p.qty} × ${p.name}`).join("; ") : "decide from the repair"}`,
    },
  ];

  try {
    for (let turn = 0; turn < 6; turn++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }, SUBMIT],
        messages,
      });
      if (res.stop_reason === "refusal") break;
      messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
      // A long server-side search can pause; re-send and it resumes where it left off.
      if (res.stop_reason === "pause_turn") continue;

      const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "submit_parts");
      if (call) {
        const parsed = PartsResult.safeParse(call.input);
        if (parsed.success) {
          cache.set(key, parsed.data);
          return Response.json({ result: parsed.data });
        }
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Call submit_parts again.` }] });
        continue;
      }
      messages.push({ role: "user", content: "Call submit_parts now with what you found." });
    }
    return Response.json({ error: "Couldn't find parts listings for this repair." }, { status: 502 });
  } catch (err) {
    const msg = err instanceof Anthropic.AuthenticationError ? "Anthropic API key missing or invalid." : err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
