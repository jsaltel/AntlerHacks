import { z } from "zod";

/** What the AI technician says about one trouble code, for one make. Shared by the server route and the UI. */
export const DtcExplanation = z.object({
  title: z.string().describe("Short name of the problem, 2-6 words, no jargon, e.g. 'Throttle sensor problem'"),
  meaning: z.string().describe("One plain sentence, at most 20 words, saying what is wrong"),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  safe_to_drive: z.boolean(),
  driving_advice: z.string().describe("At most 12 words: what to do until it is fixed"),
  likely_causes: z.array(z.object({ cause: z.string().describe("At most 8 plain words"), likelihood: z.enum(["high", "medium", "low"]) })).describe("At most 3, most likely first"),
  how_to_fix: z.array(z.string().describe("One action, at most 12 words, starting with a verb")).describe("3 or 4 steps, the last one checks the fix"),
  diy: z.enum(["easy", "moderate", "hard", "shop"]),
  est_cost_usd: z.object({ low: z.number(), high: z.number() }),
});

export type DtcExplanation = z.infer<typeof DtcExplanation>;
