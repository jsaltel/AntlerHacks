import { z } from "zod";

/** Real, currently listed parts for one repair on one vehicle, found by web search. */
export const PartsResult = z.object({
  vehicle: z.string().describe("The exact vehicle the parts were matched to, e.g. '2007 BMW 328i (N52 engine)'"),
  parts: z
    .array(
      z.object({
        name: z.string().describe("What the part is, in plain words"),
        brand: z.string(),
        part_number: z.string().describe("The manufacturer part number as listed"),
        oem_number: z.string().describe("The carmaker's original part number if known, else empty"),
        qty: z.number(),
        price_usd: z.number().describe("Current listed price for one, in US dollars"),
        retailer: z.string(),
        url: z.string().describe("Product page URL taken from the search results"),
        fitment: z.string().describe("Short fit note, e.g. 'Fits N52 engines 2006-2011', or a warning if fit is unconfirmed"),
      }),
    )
    .describe("Only the parts the repair needs"),
  note: z.string().describe("One short sentence, e.g. which part to buy first, or empty"),
});

export type PartsResult = z.infer<typeof PartsResult>;

export interface PartsRequest {
  vin?: string | null;
  cause: string;
  fix: string;
  /** The diagnosis's estimated parts list, used as the starting point for the search. */
  parts: { name: string; qty: number }[];
}
