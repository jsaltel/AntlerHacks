/** Where on the car a trouble code points, so the 3D view can highlight it. */

export type Zone = "engine" | "intake" | "exhaust" | "cooling" | "fuel_tank" | "transmission" | "battery" | "electronics" | "chassis";

export const ZONE_LABELS: Record<Zone, string> = {
  engine: "Engine (ignition / combustion)",
  intake: "Air intake & fuel metering",
  exhaust: "Exhaust, O2 sensors & catalytic converter",
  cooling: "Cooling system",
  fuel_tank: "Fuel tank & EVAP",
  transmission: "Transmission",
  battery: "Battery & charging",
  electronics: "Engine computer & wiring",
  chassis: "Brakes, steering & suspension",
};

const SPECIFIC: Record<string, Zone> = {
  P0101: "intake", P0171: "intake", P0172: "intake", P0174: "intake", P0175: "intake", P0505: "intake",
  P0128: "cooling", P0217: "cooling", P0115: "cooling", P0116: "cooling", P0117: "cooling", P0118: "cooling",
  P0401: "engine",
  P0442: "fuel_tank", P0455: "fuel_tank", P0456: "fuel_tank", P0440: "fuel_tank", P0441: "fuel_tank", P0446: "fuel_tank",
  P0562: "battery", P0563: "battery",
};

export function zoneFor(raw: string): Zone {
  const code = raw.toUpperCase().trim();
  if (SPECIFIC[code]) return SPECIFIC[code];
  const n = parseInt(code.slice(2), 16);
  switch (code[0]) {
    case "C":
      return "chassis";
    case "B":
    case "U":
      return "electronics";
  }
  if (code[1] !== "0" && code[1] !== "2") return "electronics"; // Manufacturer-specific: can't place it reliably.
  if (n >= 0x130 && n <= 0x167) return "exhaust"; // O2 sensors
  if (n < 0x300) return "intake";
  if (n < 0x400) return "engine";
  if (n < 0x440) return "exhaust";
  if (n < 0x460) return "fuel_tank";
  if (n < 0x500) return "engine";
  if (n < 0x600) return n >= 0x560 ? "battery" : "intake";
  if (n < 0x700) return "electronics";
  return "transmission";
}

export interface ZoneFault {
  zone: Zone;
  codes: string[];
  /** Stored (confirmed) beats pending. */
  stored: boolean;
}

/** Groups the car's codes by zone, stored codes first. */
export function faultZones(dtcs: { stored: string[]; pending: string[]; permanent: string[] } | null): ZoneFault[] {
  if (!dtcs) return [];
  const byZone = new Map<Zone, ZoneFault>();
  const add = (code: string, stored: boolean) => {
    const zone = zoneFor(code);
    const f = byZone.get(zone) ?? { zone, codes: [], stored: false };
    if (!f.codes.includes(code)) f.codes.push(code);
    f.stored ||= stored;
    byZone.set(zone, f);
  };
  dtcs.stored.forEach((c) => add(c, true));
  dtcs.permanent.forEach((c) => add(c, true));
  dtcs.pending.forEach((c) => add(c, false));
  return [...byZone.values()].sort((a, b) => Number(b.stored) - Number(a.stored));
}
