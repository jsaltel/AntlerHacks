import { z } from "zod";

/** What the AI technician says about one trouble code, for one make. Shared by the server route and the UI. */
export const DtcExplanation = z.object({
  meaning: z.string().describe("What the code means on this make, in one or two plain sentences a car owner understands"),
  system: z.string().describe("The part of the car involved, e.g. 'Variable valve timing (VANOS)'"),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  safe_to_drive: z.boolean(),
  driving_advice: z.string().describe("One sentence: what to do and avoid until it is fixed"),
  likely_causes: z
    .array(z.object({ cause: z.string(), likelihood: z.enum(["high", "medium", "low"]) }))
    .describe("Most likely first, at most 5"),
  how_to_fix: z.array(z.string()).describe("Ordered diagnostic and repair steps, at most 6, ending with how to verify the fix"),
  diy: z.enum(["easy", "moderate", "hard", "shop"]),
  est_cost_usd: z.object({ low: z.number(), high: z.number() }),
  note: z.string().describe("Caveat when the definition varies by engine or model year, or empty"),
});

export type DtcExplanation = z.infer<typeof DtcExplanation>;
