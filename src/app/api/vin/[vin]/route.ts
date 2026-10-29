import { decodeVinOffline, type DecodedVehicle } from "@/lib/vehicle/vin";

export const runtime = "nodejs";

// VINs never change their decode, so a process-lifetime cache is safe.
const cache = new Map<string, DecodedVehicle>();

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bBmw\b|\bGmc\b|\bRam\b/gi, (m) => m.toUpperCase());

async function decodeNhtsa(vin: string): Promise<DecodedVehicle | null> {
  const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;
  const r = (await res.json()).Results?.[0] as Record<string, string> | undefined;
  if (!r?.Make) return null;
  const offline = decodeVinOffline(vin);
  const liters = r.DisplacementL ? `${Number(r.DisplacementL).toFixed(1)}L` : "";
  const cyl = r.EngineConfiguration && r.EngineCylinders ? `${r.EngineConfiguration.startsWith("V") ? "V" : r.EngineConfiguration.startsWith("In") ? "I" : r.EngineConfiguration[0]}${r.EngineCylinders}` : "";
  return {
    vin,
    valid: offline.valid,
    year: Number(r.ModelYear) || offline.year,
    make: titleCase(r.Make),
    model: r.Model || offline.model,
    trim: r.Trim || r.Series || offline.trim,
    engine: [liters, cyl].filter(Boolean).join(" ") || offline.engine,
    bodyClass: r.BodyClass || offline.bodyClass,
    plant: [r.PlantCity, r.PlantCountry].filter(Boolean).map(titleCase).join(", ") || null,
    source: "nhtsa",
  };
}

/** GET /api/vin/:vin → decoded vehicle (NHTSA vPIC when reachable, offline decoder otherwise). */
export async function GET(_req: Request, { params }: { params: Promise<{ vin: string }> }) {
  const vin = (await params).vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) return Response.json({ error: "Not a VIN" }, { status: 400 });
  let decoded = cache.get(vin);
  if (!decoded) {
    decoded = (await decodeNhtsa(vin).catch(() => null)) ?? decodeVinOffline(vin);
    if (decoded.source === "nhtsa") cache.set(vin, decoded);
  }
  return Response.json(decoded, { headers: { "Cache-Control": decoded.source === "nhtsa" ? "public, max-age=86400" : "no-store" } });
}
