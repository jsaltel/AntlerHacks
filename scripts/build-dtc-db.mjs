#!/usr/bin/env node
/**
 * Builds the trouble-code database from two openly licensed sources:
 *   - OBDex (CC0-1.0): every generic SAE J2012 / ISO 15031-6 code, with causes and symptoms.
 *   - Wal33D/dtc-database (MIT): manufacturer-specific definitions for 33 brands.
 *
 * Writes:
 *   docs/DTC_CODES.md                 the human-readable master list
 *   src/lib/kb/data/dtc-codes.json    the lookup data the app reads at runtime
 *
 * Run: node scripts/build-dtc-db.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OBDEX = "https://foerbsnavi.github.io/OBDex";
const WAL33D_SHA = "04c43d72e7db7197658b6f72fe582c5076d9eee8";
const WAL33D = `https://raw.githubusercontent.com/Wal33D/dtc-database/${WAL33D_SHA}/data/source-data`;

/** Brand families: brands in one family share most of their manufacturer codes. */
const FAMILIES = [
  { id: "FORD", name: "Ford, Lincoln, Mercury", brands: ["FORD", "LINCOLN", "MERCURY"] },
  { id: "GM", name: "GM: Chevrolet, GMC, Buick, Cadillac, Pontiac, Oldsmobile, Saturn, Geo", brands: ["GM", "CHEVY", "GMC", "BUICK", "CADILLAC", "PONTIAC", "OLDSMOBILE", "SATURN", "GEO"] },
  { id: "CHRYSLER", name: "Chrysler, Dodge, Jeep, Plymouth", brands: ["CHRYSLER", "DODGE", "JEEP", "PLYMOUTH"] },
  { id: "TOYOTA", name: "Toyota, Lexus", brands: ["TOYOTA", "LEXUS"] },
  { id: "HONDA", name: "Honda, Acura", brands: ["HONDA", "ACURA"] },
  // The source's Infiniti list is a copy of Honda's; Infiniti is a Nissan brand and uses Nissan's codes.
  { id: "NISSAN", name: "Nissan, Infiniti", brands: ["NISSAN"] },
  { id: "VW", name: "Volkswagen, Audi", brands: ["VOLKSWAGEN", "AUDI"] },
  { id: "BMW", name: "BMW", brands: ["BMW"] },
  { id: "MERCEDES", name: "Mercedes-Benz", brands: ["MERCEDES"] },
  { id: "MAZDA", name: "Mazda", brands: ["MAZDA"] },
  { id: "SUBARU", name: "Subaru", brands: ["SUBARU"] },
  { id: "MITSUBISHI", name: "Mitsubishi", brands: ["MITSUBISHI"] },
  { id: "KIA", name: "Kia", brands: ["KIA"] },
  { id: "JAGUAR", name: "Jaguar", brands: ["JAGUAR"] },
  { id: "SUZUKI", name: "Suzuki", brands: ["SUZUKI"] },
];
const BRAND_FILE = { CHEVY: "chevy", VOLKSWAGEN: "volkswagen", MERCEDES: "mercedes" };
const BRAND_LABEL = {
  FORD: "Ford", LINCOLN: "Lincoln", MERCURY: "Mercury", GM: "GM", CHEVY: "Chevrolet", GMC: "GMC", BUICK: "Buick", CADILLAC: "Cadillac", PONTIAC: "Pontiac",
  OLDSMOBILE: "Oldsmobile", SATURN: "Saturn", GEO: "Geo", CHRYSLER: "Chrysler", DODGE: "Dodge", JEEP: "Jeep", PLYMOUTH: "Plymouth", TOYOTA: "Toyota", LEXUS: "Lexus",
  HONDA: "Honda", ACURA: "Acura", NISSAN: "Nissan", VOLKSWAGEN: "Volkswagen", AUDI: "Audi", BMW: "BMW", MERCEDES: "Mercedes-Benz", MAZDA: "Mazda", SUBARU: "Subaru",
  MITSUBISHI: "Mitsubishi", KIA: "Kia", JAGUAR: "Jaguar", SUZUKI: "Suzuki",
};

const CODE_RE = /^[PCBU][0-9A-F]{4}$/;
const tidy = (s) => s.replace(/\s+/g, " ").replace(/\s+([,.)])/g, "$1").trim();
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True for code ranges SAE reserves for manufacturers: P1xxx, P30xx-P33xx, and B/C/U 1xxx-2xxx. */
function isManufacturerRange(code) {
  const d = code[1];
  if (code[0] === "P") return d === "1" || (d === "3" && "0123".includes(code[2]));
  return d === "1" || d === "2";
}

async function get(url, as = "text") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === "json" ? res.json() : res.text();
}

function parseList(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([PCBU][0-9A-Fa-f]{4})\s*[-–:]\s*(.+?)\s*$/);
    if (!m) continue;
    const code = m[1].toUpperCase();
    if (!out.has(code)) out.set(code, tidy(m[2]));
  }
  return out;
}

const SYSTEMS = { P: "Powertrain", B: "Body", C: "Chassis", U: "Network" };

async function main() {
  console.log("Fetching OBDex generic codes…");
  const [obdex, meta] = await Promise.all([get(`${OBDEX}/generic.min.json`, "json"), get(`${OBDEX}/meta.json`, "json")]);

  const generic = {};
  for (const c of obdex) {
    if (!CODE_RE.test(c.code)) continue;
    // Compact record: t title, d description, c causes ("likelihood: text"), s symptoms, r [difficulty, eur low, eur high], m lights the MIL.
    const causes = (c.common_causes ?? []).filter((x) => x.label?.en).slice(0, 5).map((x) => `${x.likelihood ?? "possible"}: ${tidy(x.label.en)}`);
    const symptoms = (c.symptoms ?? []).map((x) => x.en).filter(Boolean).slice(0, 3);
    const cost = c.repair?.estimated_cost_eur;
    generic[c.code] = {
      t: tidy(c.title?.en ?? ""),
      ...(c.description?.en && { d: tidy(c.description.en) }),
      ...(causes.length && { c: causes }),
      ...(symptoms.length && { s: symptoms }),
      ...(c.repair && { r: [c.repair.difficulty ?? null, cost?.[0] ?? null, cost?.[1] ?? null] }),
      ...(c.flags?.mil && { m: 1 }),
    };
  }
  console.log(`  ${Object.keys(generic).length} generic codes`);

  console.log("Fetching manufacturer lists…");
  const brands = FAMILIES.flatMap((f) => f.brands);
  const lists = await Promise.all(
    [...brands, "OTHER"].map(async (b) => [b, parseList(await get(`${WAL33D}/${BRAND_FILE[b] ?? b.toLowerCase()}_codes.txt`))]),
  );

  /** makes[BRAND][code] = meaning. Only manufacturer-reserved ranges, never overriding a generic code. */
  const makes = {};
  let dropped = 0;
  for (const [brand, list] of lists) {
    const out = {};
    for (const [code, title] of list) {
      if (!isManufacturerRange(code) || generic[code]) {
        dropped++;
        continue;
      }
      out[code] = title;
    }
    makes[brand] = out;
  }
  const unattributed = makes.OTHER;
  delete makes.OTHER;
  // Unattributed rows only add value where no named brand defines the code.
  const named = new Set(Object.values(makes).flatMap((m) => Object.keys(m)));
  for (const code of Object.keys(unattributed)) if (named.has(code)) delete unattributed[code];

  const mfrRows = Object.values(makes).reduce((n, m) => n + Object.keys(m).length, 0);
  console.log(`  ${mfrRows} manufacturer definitions across ${brands.length} brands, ${Object.keys(unattributed).length} unattributed, ${dropped} skipped (generic range)`);

  const built = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: "OBDex", url: "https://github.com/foerbsnavi/OBDex", license: "CC0-1.0", version: meta.generated_at },
    { name: "Wal33D/dtc-database", url: "https://github.com/Wal33D/dtc-database", license: "MIT", version: WAL33D_SHA.slice(0, 7) },
  ];

  const families = FAMILIES.map(({ id, name, brands }) => ({ id, name, brands }));
  await mkdir(join(ROOT, "src/lib/kb/data"), { recursive: true });
  await writeFile(join(ROOT, "src/lib/kb/data/dtc-codes.json"), JSON.stringify({ built, sources, families, brandLabels: BRAND_LABEL, generic, makes, unattributed }));

  await mkdir(join(ROOT, "docs"), { recursive: true });
  await writeFile(join(ROOT, "docs/DTC_CODES.md"), markdown({ built, sources, generic, makes, unattributed, mfrRows }));
  console.log("Wrote docs/DTC_CODES.md and src/lib/kb/data/dtc-codes.json");
}

const esc = (s) => s.replace(/\|/g, "\\|");

function markdown({ built, sources, generic, makes, unattributed, mfrRows }) {
  const L = [];
  const genericCodes = Object.keys(generic).sort();
  L.push("# OBD-II trouble code master list", "");
  L.push(`Generated ${built} by \`node scripts/build-dtc-db.mjs\`. Do not edit by hand; rerun the script to refresh.`, "");
  L.push(
    `**${genericCodes.length.toLocaleString()} generic codes** (the same on every car) and **${mfrRows.toLocaleString()} manufacturer-specific definitions** across ${FAMILIES.length} brand families, plus ${Object.keys(unattributed).length.toLocaleString()} manufacturer codes with no known brand.`,
    "",
  );
  L.push("| Source | What it covers | License |", "| --- | --- | --- |");
  L.push(`| [OBDex](${sources[0].url}) (${sources[0].version.slice(0, 10)}) | Generic SAE J2012 / ISO 15031-6 codes with causes, symptoms and repair estimates | CC0-1.0 |`);
  L.push(`| [Wal33D/dtc-database](${sources[1].url}) (\`${sources[1].version}\`) | Manufacturer-specific codes | MIT |`, "");

  L.push("## How to read a code", "");
  L.push("A code is a letter and four characters, for example **P0420**.", "");
  L.push("| Position | Meaning |", "| --- | --- |");
  L.push("| 1st, letter | **P** powertrain (engine, transmission) · **B** body · **C** chassis (brakes, steering, suspension) · **U** network (module communication) |");
  L.push("| 2nd | **0** generic, the same on every car · **1** manufacturer-specific · **2** generic for P, manufacturer for B/C/U · **3** P30–P33 manufacturer, P34–P39 generic, U3 generic |");
  L.push("| 3rd | Subsystem. For P0: 0–2 fuel and air, 3 ignition / misfire, 4 emissions, 5 speed and idle, 6 computer, 7–9 transmission |");
  L.push("| 4th–5th | The specific fault |", "");
  L.push(
    "Manufacturer-specific codes mean different things on different brands. P1135 is an oxygen sensor heater on a Toyota but a pedal sensor on a Ford. Torque reads the VIN, works out the brand from its first three characters, and uses that brand's table. When the brand is unknown it lists the possible meanings.",
    "",
  );

  L.push("## Contents", "");
  const fams = ["P0", "P2", "P3", "B0", "C0", "U0", "U3"];
  L.push("- Generic codes: " + fams.map((f) => `[${f}xxx](#generic-${f.toLowerCase()}xxx)`).join(" · "));
  L.push("- Manufacturer codes: " + FAMILIES.map((f) => `[${f.name.split(":")[0]}](#${anchor(f)})`).join(" · "));
  L.push("- [Manufacturer codes, brand unknown](#manufacturer-codes-brand-unknown)", "");

  L.push("## Generic codes", "");
  for (const fam of fams) {
    const codes = genericCodes.filter((c) => c.startsWith(fam));
    if (!codes.length) continue;
    L.push(`### Generic ${fam}xxx`, "", `${SYSTEMS[fam[0]]} · ${codes.length.toLocaleString()} codes`, "", "| Code | Meaning |", "| --- | --- |");
    for (const c of codes) L.push(`| ${c} | ${esc(generic[c].t)} |`);
    L.push("");
  }

  L.push("## Manufacturer-specific codes", "");
  for (const f of FAMILIES) {
    // code -> meaning -> brands that use it
    const byCode = new Map();
    for (const b of f.brands) {
      for (const [code, title] of Object.entries(makes[b] ?? {})) {
        const meanings = byCode.get(code) ?? new Map();
        const k = key(title);
        const e = meanings.get(k) ?? { title, brands: [] };
        e.brands.push(b);
        meanings.set(k, e);
        byCode.set(code, meanings);
      }
    }
    if (!byCode.size) continue;
    L.push(`### ${f.name}`, "", `${byCode.size.toLocaleString()} codes`, "", "| Code | Meaning |", "| --- | --- |");
    for (const code of [...byCode.keys()].sort()) {
      const meanings = [...byCode.get(code).values()];
      const multi = meanings.length > 1 || (f.brands.length > 1 && meanings[0].brands.length < f.brands.length);
      const text = meanings
        .map((m) => (multi ? `${esc(m.title)} _(${m.brands.map((b) => BRAND_LABEL[b]).join(", ")})_` : esc(m.title)))
        .join("<br>");
      L.push(`| ${code} | ${text} |`);
    }
    L.push("");
  }

  const other = Object.keys(unattributed).sort();
  L.push("## Manufacturer codes, brand unknown", "");
  L.push("These come from the source without a brand. Most look like Ford-family body and network codes. Treat them as a likely meaning, not a certain one.", "");
  L.push("| Code | Likely meaning |", "| --- | --- |");
  for (const c of other) L.push(`| ${c} | ${esc(unattributed[c])} |`);
  L.push("");
  return L.join("\n");
}

const anchor = (f) => f.name.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
