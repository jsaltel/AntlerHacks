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

/**
 * Components drawn inside the generated cars. "cyl3" is cylinder 3,
 * "cylinders" means all of them.
 */
export type PartId =
  | `cyl${number}`
  | "cylinders" | "engine_block" | "intake" | "maf" | "throttle" | "egr"
  | "radiator" | "thermostat"
  | "o2_up" | "cat" | "o2_down" | "muffler"
  | "fuel_tank" | "evap" | "gas_cap"
  | "transmission" | "battery" | "ecu" | "wheels";

const ZONE_PARTS: Record<Zone, PartId[]> = {
  engine: ["engine_block"],
  intake: ["intake"],
  exhaust: ["cat"],
  cooling: ["radiator"],
  fuel_tank: ["fuel_tank"],
  transmission: ["transmission"],
  battery: ["battery"],
  electronics: ["ecu"],
  chassis: ["wheels"],
};

/** The component(s) a code points at, and what to call them. */
export function partsFor(raw: string): { parts: PartId[]; label: string } {
  const code = raw.toUpperCase().trim();
  const n = parseInt(code.slice(2), 16);
  const generic = code[0] === "P" && (code[1] === "0" || code[1] === "2");
  const cyl = /^P030([1-9])$/.exec(code);
  if (cyl) return { parts: [`cyl${Number(cyl[1])}`], label: `Cylinder ${cyl[1]} (plug, coil, injector)` };
  if (generic) {
    if (code === "P0300") return { parts: ["cylinders"], label: "All cylinders" };
    if (["P0171", "P0172", "P0174", "P0175"].includes(code)) return { parts: ["intake", "maf"], label: "Intake manifold & MAF sensor" };
    if (n >= 0x100 && n <= 0x104) return { parts: ["maf"], label: "MAF sensor" };
    if ((n >= 0x120 && n <= 0x124) || (n >= 0x505 && n <= 0x507)) return { parts: ["throttle"], label: "Throttle body & idle control" };
    if ((n >= 0x130 && n <= 0x135) || (n >= 0x150 && n <= 0x155)) return { parts: ["o2_up"], label: "Upstream O2 sensor" };
    if ((n >= 0x136 && n <= 0x141) || (n >= 0x156 && n <= 0x161)) return { parts: ["o2_down"], label: "Downstream O2 sensor" };
    if (n >= 0x420 && n <= 0x439) return { parts: ["cat"], label: "Catalytic converter" };
    if (code === "P0217") return { parts: ["radiator", "engine_block"], label: "Radiator & engine (overheating)" };
    if (n >= 0x480 && n <= 0x485) return { parts: ["radiator"], label: "Radiator & cooling fan" };
    if ((n >= 0x115 && n <= 0x119) || n === 0x125 || n === 0x128) return { parts: ["thermostat"], label: "Thermostat & coolant sensor" };
    if (n >= 0x400 && n <= 0x409) return { parts: ["egr"], label: "EGR valve" };
    if (code === "P0455" || code === "P0457" || code === "P0456" || code === "P0442") return { parts: ["gas_cap", "evap"], label: "Gas cap & EVAP lines" };
    if (n >= 0x440 && n <= 0x459) return { parts: ["evap", "fuel_tank"], label: "EVAP canister & fuel tank" };
    if (n >= 0x560 && n <= 0x563) return { parts: ["battery"], label: "Battery & charging" };
  }
  const zone = zoneFor(code);
  return { parts: ZONE_PARTS[zone], label: ZONE_LABELS[zone] };
}

export interface PartFault {
  label: string;
  parts: PartId[];
  zone: Zone;
  codes: string[];
  stored: boolean;
}

/** Groups the car's codes by the component they point at, stored codes first. */
export function faultParts(dtcs: { stored: string[]; pending: string[]; permanent: string[] } | null): PartFault[] {
  if (!dtcs) return [];
  const byLabel = new Map<string, PartFault>();
  const add = (code: string, stored: boolean) => {
    const { parts, label } = partsFor(code);
    const f = byLabel.get(label) ?? { label, parts, zone: zoneFor(code), codes: [], stored: false };
    if (!f.codes.includes(code)) f.codes.push(code);
    f.stored ||= stored;
    byLabel.set(label, f);
  };
  dtcs.stored.forEach((c) => add(c, true));
  dtcs.permanent.forEach((c) => add(c, true));
  dtcs.pending.forEach((c) => add(c, false));
  return [...byLabel.values()].sort((a, b) => Number(b.stored) - Number(a.stored));
}
