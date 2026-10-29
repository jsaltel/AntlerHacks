import { decodeVinOffline, type DecodedVehicle } from "./vin";

const KEY = "vin-decode:";

/** Decodes a VIN via /api/vin (NHTSA), cached per browser; falls back to the offline decoder. */
export async function fetchVehicle(vin: string): Promise<DecodedVehicle> {
  try {
    const hit = localStorage.getItem(KEY + vin);
    if (hit) return JSON.parse(hit);
  } catch {}
  try {
    const res = await fetch(`/api/vin/${encodeURIComponent(vin)}`);
    if (!res.ok) throw new Error(String(res.status));
    const v = (await res.json()) as DecodedVehicle;
    if (v.source === "nhtsa") {
      try {
        localStorage.setItem(KEY + vin, JSON.stringify(v));
      } catch {}
    }
    return v;
  } catch {
    return decodeVinOffline(vin);
  }
}
