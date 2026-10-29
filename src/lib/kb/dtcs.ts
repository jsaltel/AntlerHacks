export interface DtcInfo {
  code: string;
  title: string;
  system: string;
  severity: "low" | "moderate" | "high" | "critical";
  causes: string[];
  /** How live data separates the causes, so the agent can design a test. */
  discriminators: string[];
  costUsd: [number, number];
}

const K: DtcInfo[] = [
  {
    code: "P0171", title: "System too lean (bank 1)", system: "Fuel / air metering", severity: "moderate",
    causes: ["Vacuum leak (intake gasket, PCV hose, brake booster line)", "Dirty or failing MAF sensor", "Weak fuel pump or clogged fuel filter", "Leaking exhaust before upstream O2 sensor", "Faulty upstream O2 sensor (rare)"],
    discriminators: [
      "Compare long-term trims at idle vs ~2500 rpm. Trims high at idle that drop toward normal at 2500 point to a vacuum leak (fixed leak area matters less as airflow rises).",
      "Trims high at idle AND as high or higher at 2500 point to under-reporting MAF or fuel delivery. Check MAF: at warm idle a healthy engine reads roughly 1.0-1.5 g/s per liter of displacement, and about 3x that at 2500 rpm no-load. A low MAF reading plus lean trims everywhere points at the MAF.",
      "If both banks are lean (P0171 + P0174) the cause is common to both banks (MAF, fuel pressure, large vacuum leak) rather than a bank-specific injector or gasket.",
    ],
    costUsd: [20, 450],
  },
  {
    code: "P0174", title: "System too lean (bank 2)", system: "Fuel / air metering", severity: "moderate",
    causes: ["Vacuum leak", "Dirty or failing MAF sensor", "Low fuel pressure", "Intake manifold gasket leak on bank 2"],
    discriminators: ["Same tests as P0171. Paired with P0171 it indicates a cause shared by both banks."],
    costUsd: [20, 450],
  },
  {
    code: "P0172", title: "System too rich (bank 1)", system: "Fuel / air metering", severity: "moderate",
    causes: ["Leaking injector", "High fuel pressure / failed regulator", "MAF over-reporting", "Saturated EVAP purge valve stuck open"],
    discriminators: ["Negative trims at all rpm with MAF reading high suggests MAF; negative only at idle suggests purge valve stuck open."],
    costUsd: [50, 600],
  },
  {
    code: "P0101", title: "MAF sensor range / performance", system: "Air metering", severity: "moderate",
    causes: ["Contaminated MAF hot wire", "Air leak between MAF and throttle body", "Clogged air filter", "Failing MAF sensor"],
    discriminators: ["Compare measured MAF to expected for rpm/load; low MAF with positive trims at all rpm is classic contamination. Cleaning with MAF cleaner is the first, cheap step."],
    costUsd: [10, 300],
  },
  {
    code: "P0300", title: "Random / multiple cylinder misfire", system: "Ignition / combustion", severity: "high",
    causes: ["Worn spark plugs", "Failing coil(s)", "Vacuum leak", "Low fuel pressure", "Low compression"],
    discriminators: ["If accompanied by a single-cylinder code (P030X), focus on that cylinder first. RPM instability at idle that improves at higher rpm is typical of ignition misfire."],
    costUsd: [80, 900],
  },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): DtcInfo => ({
    code: `P030${n}`, title: `Cylinder ${n} misfire detected`, system: "Ignition / combustion", severity: "high",
    causes: [`Spark plug cylinder ${n}`, `Ignition coil cylinder ${n}`, `Fuel injector cylinder ${n}`, "Low compression (valve / ring)", "Intake leak near that runner"],
    discriminators: [
      "Swap the coil with a neighbouring cylinder, clear codes and re-run: if the misfire code moves, the coil is bad; if it stays, check plug then injector.",
      "Short-term trims run slightly positive during misfire because unburnt oxygen reaches the O2 sensor.",
      "A flashing check engine light means raw fuel is entering the catalytic converter. Avoid hard driving to prevent cat damage.",
    ],
    costUsd: [25, 400],
  })),
  {
    code: "P0420", title: "Catalyst efficiency below threshold (bank 1)", system: "Emissions", severity: "low",
    causes: ["Worn catalytic converter", "Faulty downstream O2 sensor", "Exhaust leak near sensors", "Engine running rich or misfiring (damaging cat)"],
    discriminators: [
      "Watch upstream vs downstream O2 at steady 2500 rpm. A healthy cat stores oxygen, so downstream sits steady ~0.6-0.75 V while upstream switches 0.1-0.9 V. Downstream mirroring upstream switching means the cat no longer stores oxygen.",
      "Check fuel trims and misfire codes first; a cat fails because of something upstream.",
    ],
    costUsd: [150, 2500],
  },
  {
    code: "P0430", title: "Catalyst efficiency below threshold (bank 2)", system: "Emissions", severity: "low",
    causes: ["Worn catalytic converter (bank 2)", "Faulty bank 2 downstream O2 sensor", "Exhaust leak"],
    discriminators: ["Same as P0420 using bank 2 sensors."],
    costUsd: [150, 2500],
  },
  {
    code: "P0128", title: "Coolant temp below thermostat regulating temperature", system: "Cooling", severity: "moderate",
    causes: ["Thermostat stuck open", "Faulty coolant temp sensor", "Low coolant level"],
    discriminators: ["Coolant temp that plateaus well below ~85-90 °C after 10+ minutes, and drops further at highway speed (more radiator airflow), points to a stuck-open thermostat. A sensor fault usually reads erratic or implausible values instead."],
    costUsd: [80, 350],
  },
  {
    code: "P0217", title: "Engine over-temperature", system: "Cooling", severity: "critical",
    causes: ["Low coolant / leak", "Failed water pump", "Stuck-closed thermostat", "Cooling fan failure", "Head gasket"],
    discriminators: ["Stop driving. Overheating can destroy the engine."],
    costUsd: [100, 3000],
  },
  {
    code: "P0442", title: "EVAP small leak detected", system: "Evaporative emissions", severity: "low",
    causes: ["Loose or worn gas cap", "Cracked EVAP hose", "Faulty purge or vent valve"],
    discriminators: ["Replace/re-seat the gas cap first; a smoke test finds small leaks."],
    costUsd: [15, 400],
  },
  {
    code: "P0455", title: "EVAP large leak detected", system: "Evaporative emissions", severity: "low",
    causes: ["Gas cap missing or not tightened", "Disconnected EVAP hose", "Faulty vent valve"],
    discriminators: ["Check the gas cap first."],
    costUsd: [0, 400],
  },
  {
    code: "P0133", title: "O2 sensor slow response (B1S1)", system: "Emissions / fuel control", severity: "low",
    causes: ["Aging upstream O2 sensor", "Exhaust leak", "Contamination (coolant, oil)"],
    discriminators: ["A healthy upstream sensor switches lean/rich several times per second at 2500 rpm. Lazy, slow switching confirms."],
    costUsd: [60, 300],
  },
  {
    code: "P0135", title: "O2 sensor heater circuit (B1S1)", system: "Emissions", severity: "low",
    causes: ["Failed O2 sensor heater", "Blown heater fuse", "Wiring damage"],
    discriminators: ["Usually requires sensor replacement after confirming fuse."],
    costUsd: [60, 300],
  },
  {
    code: "P0401", title: "EGR flow insufficient", system: "Emissions", severity: "low",
    causes: ["Carbon-clogged EGR passages", "Failed EGR valve", "Faulty DPFE sensor"],
    discriminators: ["Clean EGR passages before replacing parts."],
    costUsd: [100, 600],
  },
  {
    code: "P0505", title: "Idle air control system", system: "Air / idle", severity: "moderate",
    causes: ["Dirty throttle body", "Failing IAC valve", "Vacuum leak"],
    discriminators: ["Idle RPM hunting or stalling; clean throttle body first."],
    costUsd: [10, 300],
  },
  {
    code: "P0562", title: "System voltage low", system: "Charging", severity: "high",
    causes: ["Failing alternator", "Weak battery", "Corroded battery terminals"],
    discriminators: ["Running voltage should be 13.8-14.7 V. Below 13 V with the engine running points at the alternator. With the engine off, 11 V or more is fine and says nothing about charging."],
    costUsd: [0, 700],
  },
  {
    code: "P0700", title: "Transmission control system malfunction", system: "Transmission", severity: "high",
    causes: ["A fault stored in the transmission module"],
    discriminators: ["Read the TCM directly with a scan tool that supports enhanced codes."],
    costUsd: [100, 3500],
  },
];

export const DTC_KB: Record<string, DtcInfo> = Object.fromEntries(K.map((d) => [d.code, d]));

const SYSTEM_NAMES: Record<string, string> = { P: "Powertrain", C: "Chassis", B: "Body", U: "Network" };
const P_GROUPS: [number, number, string][] = [
  [0x000, 0x0ff, "Fuel and air metering / auxiliary emission controls"],
  [0x100, 0x2ff, "Fuel and air metering"],
  [0x300, 0x3ff, "Ignition system or misfire"],
  [0x400, 0x4ff, "Auxiliary emission controls"],
  [0x500, 0x5ff, "Vehicle speed, idle control and auxiliary inputs"],
  [0x600, 0x6ff, "Computer output circuit"],
  [0x700, 0x9ff, "Transmission"],
];

/** Knowledge base lookup with a structural fallback for codes not in the table. */
export function lookupDtc(code: string): DtcInfo | { code: string; title: string; system: string; generic: true; manufacturerSpecific: boolean } {
  const c = code.toUpperCase().trim();
  if (DTC_KB[c]) return DTC_KB[c];
  const sys = SYSTEM_NAMES[c[0]] ?? "Unknown";
  const manufacturerSpecific = c[1] === "1" || c[1] === "3";
  const n = parseInt(c.slice(2), 16);
  const group = c[0] === "P" ? P_GROUPS.find(([a, b]) => n >= a && n <= b)?.[2] : undefined;
  return { code: c, title: group ?? `${sys} code`, system: sys, generic: true, manufacturerSpecific };
}
