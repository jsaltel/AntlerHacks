import { describeDtc } from "@/lib/kb/dtc-db";
import { brandFromVin, brandLabel } from "@/lib/kb/vin";

/** GET /api/dtc?codes=P0420,P1135&vin=1HGCM82633A004352 → meaning of each code for that car's brand. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const codes = (url.searchParams.get("codes") ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[PCBU][0-9A-F]{4}$/.test(c))
    .slice(0, 50);
  const brand = brandFromVin(url.searchParams.get("vin"));
  const results = await Promise.all(codes.map((c) => describeDtc(c, brand)));
  return Response.json({ make: brand ? brandLabel(brand) : null, results });
}
