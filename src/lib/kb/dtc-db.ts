import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brandLabel } from "./vin";

/**
 * Server-side lookup over data/dtc-codes.json (built by scripts/build-dtc-db.mjs).
 * The file is several MB, so it is read once on demand and never shipped to the browser.
 */

interface GenericRecord {
  t: string;
  d?: string;
  c?: string[];
  s?: string[];
  r?: [string | null, number | null, number | null];
  m?: 1;
}

interface DtcData {
  families: { id: string; name: string; brands: string[] }[];
  generic: Record<string, GenericRecord>;
  makes: Record<string, Record<string, string>>;
  unattributed: Record<string, string>;
}

export interface DtcLookup {
  code: string;
  system: string;
  /** generic: same on every car. manufacturer: from the brand's table. unattributed: likely meaning, brand unknown. unknown: not in any table. */
  source: "generic" | "manufacturer" | "unattributed" | "unknown";
  title: string;
  /** Brand whose table supplied the meaning. */
  make?: string;
  description?: string;
  causes?: string[];
  symptoms?: string[];
  repair?: { difficulty: string | null; cost_eur: [number | null, number | null] };
  lights_check_engine?: boolean;
  /** Manufacturer code with the brand unknown: each meaning and the brands that use it. */
  candidates?: { meaning: string; makes: string[] }[];
}

let cache: Promise<DtcData> | null = null;
const load = () => (cache ??= readFile(join(process.cwd(), "src/lib/kb/data/dtc-codes.json"), "utf8").then((s) => JSON.parse(s) as DtcData));

const SYSTEMS: Record<string, string> = { P: "Powertrain", B: "Body", C: "Chassis", U: "Network" };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function describeDtc(raw: string, brand?: string | null): Promise<DtcLookup> {
  const db = await load();
  const code = raw.toUpperCase().trim();
  const system = SYSTEMS[code[0]] ?? "Unknown";

  const g = db.generic[code];
  if (g) {
    return {
      code,
      system,
      source: "generic",
      title: g.t,
      description: g.d,
      causes: g.c,
      symptoms: g.s,
      repair: g.r ? { difficulty: g.r[0], cost_eur: [g.r[1], g.r[2]] } : undefined,
      lights_check_engine: g.m === 1,
    };
  }

  if (brand) {
    const family = db.families.find((f) => f.brands.includes(brand));
    // The car's own brand first, then sister brands that share its codes.
    for (const b of [brand, ...(family?.brands ?? []).filter((x) => x !== brand)]) {
      const t = db.makes[b]?.[code];
      if (t) return { code, system, source: "manufacturer", title: t, make: brandLabel(b) };
    }
    // Other brands' meanings don't apply to this car, so don't offer them.
    if (isManufacturerCode(code)) return { code, system, source: "unknown", title: `${brandLabel(brand)}-specific code, not in the database`, make: brandLabel(brand) };
  }

  const meanings = new Map<string, { meaning: string; makes: string[] }>();
  for (const [b, table] of Object.entries(db.makes)) {
    const t = table[code];
    if (!t) continue;
    const e = meanings.get(norm(t)) ?? { meaning: t, makes: [] };
    e.makes.push(brandLabel(b));
    meanings.set(norm(t), e);
  }
  const candidates = [...meanings.values()].sort((a, b) => b.makes.length - a.makes.length);
  if (candidates.length === 1) return { code, system, source: "manufacturer", title: candidates[0].meaning, make: candidates[0].makes.join(", ") };
  if (candidates.length > 1) return { code, system, source: "manufacturer", title: "Manufacturer-specific code (meaning depends on the make)", candidates };

  const u = db.unattributed[code];
  if (u) return { code, system, source: "unattributed", title: u };

  return { code, system, source: "unknown", title: isManufacturerCode(code) ? `${system} code, manufacturer-specific` : `${system} code` };
}

/** SAE reserves P1xxx, P30xx-P33xx and B/C/U 1xxx-2xxx for manufacturers. */
function isManufacturerCode(code: string) {
  return code[0] === "P" ? code[1] === "1" || (code[1] === "3" && "0123".includes(code[2])) : code[1] === "1" || code[1] === "2";
}
