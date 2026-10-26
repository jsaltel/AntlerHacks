/**
 * Mean-value engine model used by the tuning page, the agent team and the car
 * simulator. It is not a CFD model: it captures the trade-offs a calibrator
 * actually fights (airflow vs boost, spark vs knock, AFR vs EGT, injector
 * capacity, mechanical limits) with plausible numbers, so a tune that is
 * dangerous on paper is dangerous here too.
 */

export interface EngineSpec {
  id: string;
  name: string;
  engine: string;
  displacementL: number;
  cylinders: number;
  compression: number;
  aspiration: "na" | "turbo";
  redline: number;
  /** Highest rpm the valvetrain tolerates before float. */
  mechanicalRpm: number;
  vePeak: number;
  vePeakRpm: number;
  veWidth: number;
  /** Stock wastegate target, psi. */
  stockBoostPsi: number;
  /** Most boost the turbo can make efficiently before overspeeding. */
  turboMaxPsi: number;
  spoolStartRpm: number;
  spoolFullRpm: number;
  intercoolerEff: number;
  injectorCcMin: number;
  /** Rod/piston torque rating at the crank, Nm. */
  internalsLimitNm: number;
  recommendedOctane: number;
  /** Per-engine combustion efficiency factor, calibrated against factory output. */
  calib: number;
  vehicle: VehicleSpec;
}

export interface VehicleSpec {
  massKg: number;
  gears: number[];
  finalDrive: number;
  tireRadiusM: number;
  cdA: number;
  drive: "fwd" | "rwd" | "awd";
  /** Fraction of weight on the driven axle(s) under acceleration. */
  drivenWeight: number;
  drivetrainEff: number;
}

export interface Environment {
  ambientC: number;
  altitudeM: number;
  octane: number;
  /** Extra intake heat from a hot engine bay, °C. */
  heatSoakC: number;
}

export interface Tune {
  name: string;
  engineId: string;
  rpmAxis: number[];
  /** Engine load %, 10..100. Row 100 is wide-open throttle. */
  loadAxis: number[];
  /** Spark advance, degrees BTDC, [load][rpm]. */
  ignition: number[][];
  /** Commanded air-fuel ratio, [load][rpm]. */
  afr: number[][];
  /** Wide-open-throttle boost target per rpm column, psi (turbo engines only). */
  boostPsi: number[];
  revLimit: number;
  /** Max degrees the knock controller may pull. */
  knockAuthorityDeg: number;
}

export const ENGINES: EngineSpec[] = [
  {
    id: "civic_si",
    name: "Honda Civic Si (8th gen)",
    engine: "K20Z3 2.0L I4 NA",
    displacementL: 2.0,
    cylinders: 4,
    compression: 11.0,
    aspiration: "na",
    redline: 8000,
    mechanicalRpm: 8600,
    vePeak: 1.0,
    vePeakRpm: 7000,
    veWidth: 5200,
    stockBoostPsi: 0,
    turboMaxPsi: 0,
    spoolStartRpm: 0,
    spoolFullRpm: 0,
    intercoolerEff: 0,
    injectorCcMin: 310,
    internalsLimitNm: 290,
    recommendedOctane: 91,
    calib: 1.0,
    vehicle: { massKg: 1300, gears: [3.27, 2.13, 1.52, 1.15, 0.92, 0.74], finalDrive: 4.76, tireRadiusM: 0.31, cdA: 0.68, drive: "fwd", drivenWeight: 0.62, drivetrainEff: 0.87 },
  },
  {
    id: "gti",
    name: "Volkswagen GTI (Mk7)",
    engine: "EA888 2.0L I4 turbo",
    displacementL: 2.0,
    cylinders: 4,
    compression: 9.6,
    aspiration: "turbo",
    redline: 6800,
    mechanicalRpm: 7200,
    vePeak: 0.94,
    vePeakRpm: 3800,
    veWidth: 5200,
    stockBoostPsi: 17,
    turboMaxPsi: 25,
    spoolStartRpm: 1400,
    spoolFullRpm: 2600,
    intercoolerEff: 0.72,
    injectorCcMin: 720,
    internalsLimitNm: 480,
    recommendedOctane: 91,
    calib: 0.82,
    vehicle: { massKg: 1420, gears: [3.77, 2.09, 1.47, 1.1, 1.11, 0.92], finalDrive: 3.39, tireRadiusM: 0.32, cdA: 0.7, drive: "fwd", drivenWeight: 0.62, drivetrainEff: 0.88 },
  },
  {
    id: "mustang_gt",
    name: "Ford Mustang GT (S550)",
    engine: "Coyote 5.0L V8 NA",
    displacementL: 5.0,
    cylinders: 8,
    compression: 12.0,
    aspiration: "na",
    redline: 7500,
    mechanicalRpm: 8000,
    vePeak: 0.98,
    vePeakRpm: 5000,
    veWidth: 5600,
    stockBoostPsi: 0,
    turboMaxPsi: 0,
    spoolStartRpm: 0,
    spoolFullRpm: 0,
    intercoolerEff: 0,
    injectorCcMin: 520,
    internalsLimitNm: 720,
    recommendedOctane: 91,
    calib: 1.19,
    vehicle: { massKg: 1750, gears: [3.66, 2.43, 1.69, 1.32, 1.0, 0.65], finalDrive: 3.55, tireRadiusM: 0.34, cdA: 0.82, drive: "rwd", drivenWeight: 0.55, drivetrainEff: 0.85 },
  },
  {
    id: "giulia_qv",
    name: "Alfa Romeo Giulia Quadrifoglio",
    engine: "2.9L twin-turbo V6",
    displacementL: 2.9,
    cylinders: 6,
    compression: 9.3,
    aspiration: "turbo",
    redline: 7000,
    mechanicalRpm: 7400,
    vePeak: 0.96,
    vePeakRpm: 6000,
    veWidth: 5600,
    stockBoostPsi: 15,
    turboMaxPsi: 27,
    spoolStartRpm: 1300,
    spoolFullRpm: 2400,
    intercoolerEff: 0.78,
    injectorCcMin: 640,
    internalsLimitNm: 760,
    recommendedOctane: 91,
    calib: 1.0,
    // ZF 8-speed automatic.
    vehicle: { massKg: 1580, gears: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64], finalDrive: 3.09, tireRadiusM: 0.345, cdA: 0.72, drive: "rwd", drivenWeight: 0.56, drivetrainEff: 0.88 },
  },
  {
    id: "wrangler_jk",
    name: "Jeep Wrangler Rubicon JK (2017)",
    engine: "3.6L Pentastar V6 NA",
    displacementL: 3.6,
    cylinders: 6,
    compression: 11.3,
    aspiration: "na",
    redline: 6600,
    mechanicalRpm: 7000,
    vePeak: 0.95,
    vePeakRpm: 4800,
    veWidth: 5200,
    stockBoostPsi: 0,
    turboMaxPsi: 0,
    spoolStartRpm: 0,
    spoolFullRpm: 0,
    intercoolerEff: 0,
    injectorCcMin: 400,
    internalsLimitNm: 520,
    recommendedOctane: 87,
    calib: 1.28,
    // 5-speed automatic, 4.10 Rubicon axles, 32-inch tires, part-time 4WD.
    vehicle: { massKg: 2000, gears: [3.59, 2.19, 1.41, 1.0, 0.83], finalDrive: 4.1, tireRadiusM: 0.405, cdA: 1.6, drive: "awd", drivenWeight: 0.7, drivetrainEff: 0.82 },
  },
];

export const ENGINE_BY_ID: Record<string, EngineSpec> = Object.fromEntries(ENGINES.map((e) => [e.id, e]));

export const ENVIRONMENTS: { id: string; label: string; env: (spec: EngineSpec) => Environment }[] = [
  { id: "standard", label: "Standard day (25°C, sea level, recommended fuel)", env: (s) => ({ ambientC: 25, altitudeM: 0, octane: s.recommendedOctane, heatSoakC: 0 }) },
  { id: "hot_day", label: "Hot day, heat-soaked (40°C, +15°C intake)", env: (s) => ({ ambientC: 40, altitudeM: 0, octane: s.recommendedOctane, heatSoakC: 15 }) },
  { id: "low_octane", label: "Bad fuel (87 octane)", env: () => ({ ambientC: 25, altitudeM: 0, octane: 87, heatSoakC: 0 }) },
  { id: "altitude", label: "Altitude (Denver, 1600 m)", env: (s) => ({ ambientC: 20, altitudeM: 1600, octane: s.recommendedOctane, heatSoakC: 0 }) },
  { id: "track", label: "Track session (35°C, +25°C heat soak)", env: (s) => ({ ambientC: 35, altitudeM: 0, octane: s.recommendedOctane, heatSoakC: 25 }) },
];

export function envFor(spec: EngineSpec, id: string, octane?: number): Environment {
  const e = (ENVIRONMENTS.find((x) => x.id === id) ?? ENVIRONMENTS[0]).env(spec);
  return octane && id !== "low_octane" ? { ...e, octane } : e;
}

/* ---------- interpolation ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function axisPos(axis: number[], v: number): [number, number, number] {
  if (v <= axis[0]) return [0, 0, 0];
  const last = axis.length - 1;
  if (v >= axis[last]) return [last, last, 0];
  let i = 0;
  while (axis[i + 1] < v) i++;
  return [i, i + 1, (v - axis[i]) / (axis[i + 1] - axis[i])];
}

export function lookup2d(table: number[][], loadAxis: number[], rpmAxis: number[], load: number, rpm: number): number {
  const [r0, r1, rf] = axisPos(loadAxis, load);
  const [c0, c1, cf] = axisPos(rpmAxis, rpm);
  const a = table[r0][c0] + (table[r0][c1] - table[r0][c0]) * cf;
  const b = table[r1][c0] + (table[r1][c1] - table[r1][c0]) * cf;
  return a + (b - a) * rf;
}

export function lookup1d(values: number[], axis: number[], v: number): number {
  const [i0, i1, f] = axisPos(axis, v);
  return values[i0] + (values[i1] - values[i0]) * f;
}

/* ---------- physics ---------- */

export interface EnginePoint {
  rpm: number;
  load: number;
  mapKpa: number;
  boostPsi: number;
  boostTargetPsi: number;
  iatC: number;
  ve: number;
  airflowGs: number;
  afrTarget: number;
  afrActual: number;
  lambda: number;
  injectorDutyPct: number;
  timingCmd: number;
  timingActual: number;
  mbt: number;
  knockLimit: number;
  /** Knock limit minus commanded timing. Negative means the engine knocks. */
  knockMarginDeg: number;
  knockRetardDeg: number;
  /** Knock beyond what the knock controller can pull: engine-damaging detonation. */
  detonation: boolean;
  egtC: number;
  torqueNm: number;
  hp: number;
  fuelCut: boolean;
}

function baroKpa(altM: number) {
  return 101.3 * Math.exp(-altM / 8400);
}

function veAt(spec: EngineSpec, rpm: number) {
  return Math.max(0.55, spec.vePeak * Math.exp(-(((rpm - spec.vePeakRpm) / spec.veWidth) ** 2)));
}

/** Boost the turbo can physically make at this rpm. */
function turboAvailablePsi(spec: EngineSpec, rpm: number) {
  if (spec.aspiration !== "turbo") return 0;
  const spool = clamp((rpm - spec.spoolStartRpm) / (spec.spoolFullRpm - spec.spoolStartRpm), 0, 1);
  // Small OEM turbos run out of flow near redline.
  const fade = rpm > 5000 ? 1 - ((rpm - 5000) / (spec.redline - 5000)) * 0.3 : 1;
  return spec.turboMaxPsi * 1.1 * spool * fade;
}

function mbtTiming(spec: EngineSpec, rpm: number, density: number) {
  return 30 + (rpm / spec.redline) * 8 - 9 * (density - 1) - (spec.compression - 10) * 0.8;
}

function knockLimitTiming(spec: EngineSpec, rpm: number, density: number, iatC: number, lambda: number, octane: number) {
  return 22 + 1.4 * (octane - 91) - 2.2 * (spec.compression - 10) - 9 * (density - 1) - 0.12 * (iatC - 30) + 10 * (rpm / spec.redline) + 25 * Math.max(0, 0.95 - lambda);
}

export function engineAt(spec: EngineSpec, tune: Tune, env: Environment, rpm: number, load: number): EnginePoint {
  load = clamp(load, 10, 100);
  const baro = baroKpa(env.altitudeM);
  const boostTarget = spec.aspiration === "turbo" ? lookup1d(tune.boostPsi, tune.rpmAxis, rpm) : 0;
  // Boost builds over the top 40% of the pedal.
  const boostFrac = clamp((load - 60) / 40, 0, 1);
  const boostPsi = Math.min(boostTarget, turboAvailablePsi(spec, rpm)) * boostFrac;
  const mapKpa = load <= 60 && spec.aspiration === "turbo" ? 25 + (baro - 25) * (load / 60) : spec.aspiration === "turbo" ? baro + boostPsi * 6.895 : 25 + (baro - 25) * (load / 100);
  const iatC = env.ambientC + env.heatSoakC + (spec.aspiration === "turbo" ? boostPsi * (1 - spec.intercoolerEff) * 3.2 : 5);
  const density = (mapKpa / 101.3) * (298 / (273 + iatC));
  const ve = veAt(spec, rpm);
  const airflowGs = spec.displacementL * (rpm / 120) * ve * density * 1.184;

  const afrTarget = lookup2d(tune.afr, tune.loadAxis, tune.rpmAxis, load, rpm);
  const fuelNeededGs = airflowGs / afrTarget;
  const injectorCapGs = ((spec.injectorCcMin * 0.74) / 60) * spec.cylinders;
  const injectorDutyPct = (fuelNeededGs / injectorCapGs) * 100;
  // Past ~95% duty the injectors are static: the engine gets only what they can flow.
  const fuelGs = Math.min(fuelNeededGs, injectorCapGs * 0.95);
  const afrActual = airflowGs / fuelGs;
  const lambda = afrActual / 14.7;

  const timingCmd = lookup2d(tune.ignition, tune.loadAxis, tune.rpmAxis, load, rpm);
  const mbt = mbtTiming(spec, rpm, density);
  const knockLimit = knockLimitTiming(spec, rpm, density, iatC, lambda, env.octane);
  const knockMarginDeg = knockLimit - timingCmd;
  const knockRetardDeg = knockMarginDeg < 0 ? Math.min(tune.knockAuthorityDeg, -knockMarginDeg + 1) : 0;
  const detonation = knockMarginDeg < -tune.knockAuthorityDeg;
  const timingActual = timingCmd - knockRetardDeg;

  const fLambda = lambda >= 0.87 ? 1 - 2.4 * (lambda - 0.87) ** 2 : 1 - 1.6 * (0.87 - lambda) ** 2;
  const fSpark = Math.max(0.5, 1 - 0.0011 * (timingActual - mbt) ** 2);
  // Fuel-limited (lean) combustion caps energy release.
  const fFuel = Math.min(1, fuelGs / (airflowGs / 12.8));
  const indicated = 128 * spec.calib * spec.displacementL * ve * density * fLambda * fSpark * Math.max(fFuel, 0.85);
  const friction = spec.displacementL * (9 + (rpm / 1000) * 2.2);
  const fuelCut = rpm >= tune.revLimit;
  const torqueNm = fuelCut ? 0 : Math.max(0, indicated - friction);
  const hp = (torqueNm * rpm) / 7120.8;

  // Lean mixtures and retarded spark both push heat into the exhaust.
  const egtC = 560 + (rpm / spec.redline) * 140 + (load / 100) * 120 + (lambda - 0.85) * 900 + Math.max(0, mbt - timingActual) * 9 + boostPsi * 3;

  return { rpm, load, mapKpa, boostPsi, boostTargetPsi: boostTarget, iatC, ve, airflowGs, afrTarget, afrActual, lambda, injectorDutyPct, timingCmd, timingActual, mbt, knockLimit, knockMarginDeg, knockRetardDeg, detonation, egtC, torqueNm, hp, fuelCut };
}

/* ---------- stock calibration ---------- */

export const LOAD_AXIS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function rpmAxisFor(spec: EngineSpec): number[] {
  const n = 12;
  return Array.from({ length: n }, (_, i) => Math.round((1000 + ((spec.redline - 1000) * i) / (n - 1)) / 100) * 100);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const half = (v: number) => Math.round(v * 2) / 2;

/** The factory calibration: conservative spark (3° knock margin on recommended fuel), rich WOT fueling. */
export function stockTune(spec: EngineSpec): Tune {
  const rpmAxis = rpmAxisFor(spec);
  const ref = envFor(spec, "standard");
  const boostPsi = rpmAxis.map((rpm) => (spec.aspiration === "turbo" ? r1(rpm > 5200 ? spec.stockBoostPsi * (1 - ((rpm - 5200) / (spec.redline - 5200)) * 0.2) : spec.stockBoostPsi) : 0));
  const afr = LOAD_AXIS.map((load) =>
    rpmAxis.map((rpm) => {
      const wot = spec.aspiration === "turbo" ? 11.6 : 12.6;
      const enrich = clamp((load - 70) / 30, 0, 1) * clamp(0.6 + rpm / spec.redline, 0, 1);
      return r1(14.7 - (14.7 - wot) * enrich);
    }),
  );
  const tune: Tune = { name: "Stock", engineId: spec.id, rpmAxis, loadAxis: LOAD_AXIS, ignition: [], afr, boostPsi, revLimit: spec.redline, knockAuthorityDeg: 8 };
  // Fill spark one cell at a time using the model's own MBT and knock limit at that operating point.
  tune.ignition = LOAD_AXIS.map((load, li) =>
    rpmAxis.map((rpm, ri) => {
      const probe: Tune = { ...tune, ignition: LOAD_AXIS.map(() => rpmAxis.map(() => 0)) };
      probe.afr = afr;
      const p = engineAt(spec, probe, ref, rpm, load);
      void li;
      void ri;
      return half(Math.min(p.mbt, p.knockLimit - 3));
    }),
  );
  // Factory maps ramp spark smoothly into the boost/knock-limited region instead of stepping.
  for (const row of tune.ignition) for (let i = row.length - 2; i >= 0; i--) row[i] = Math.min(row[i], row[i + 1] + 4);
  return tune;
}

export function cloneTune(t: Tune): Tune {
  return { ...t, rpmAxis: [...t.rpmAxis], loadAxis: [...t.loadAxis], ignition: t.ignition.map((r) => [...r]), afr: t.afr.map((r) => [...r]), boostPsi: [...t.boostPsi] };
}

/* ---------- dyno + safety evaluation ---------- */

export interface Issue {
  severity: "fail" | "warn";
  code: string;
  message: string;
  rpm?: number;
}

export interface DynoResult {
  env: Environment;
  points: EnginePoint[];
  peakHp: number;
  peakHpRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  minKnockMarginDeg: number;
  maxEgtC: number;
  maxInjectorDutyPct: number;
  leanestWotAfr: number;
  maxBoostPsi: number;
  issues: Issue[];
}

export const LIMITS = {
  egtWarnC: 930,
  egtFailC: 980,
  idcWarnPct: 85,
  idcFailPct: 95,
  wotAfrWarn: { na: 13.2, turbo: 12.3 },
  wotAfrFail: { na: 13.8, turbo: 12.8 },
  knockMarginWarnDeg: 1.5,
};

/** Wide-open-throttle pull from 1500 rpm to the rev limiter with safety checks at each point. */
export function runDyno(spec: EngineSpec, tune: Tune, env: Environment): DynoResult {
  const points: EnginePoint[] = [];
  const top = Math.min(tune.revLimit, spec.mechanicalRpm + 400) - 50;
  for (let rpm = 1500; rpm <= top; rpm += 250) points.push(engineAt(spec, tune, env, rpm, 100));
  const issues: Issue[] = [];
  const add = (i: Issue) => {
    if (!issues.some((x) => x.code === i.code)) issues.push(i);
  };
  const kind = spec.aspiration;
  for (const p of points) {
    if (p.detonation) add({ severity: "fail", code: "detonation", rpm: p.rpm, message: `Detonation at ${p.rpm} rpm: spark is ${(-p.knockMarginDeg).toFixed(1)}° past the knock limit, beyond the ${tune.knockAuthorityDeg}° the knock controller can pull. Piston and ring-land damage risk.` });
    else if (p.knockRetardDeg > 0) add({ severity: "warn", code: "knock_retard", rpm: p.rpm, message: `Knock at ${p.rpm} rpm: the knock controller is pulling ${p.knockRetardDeg.toFixed(1)}°. Power is lost and the engine depends on knock control to survive.` });
    else if (p.knockMarginDeg < LIMITS.knockMarginWarnDeg) add({ severity: "warn", code: "thin_knock_margin", rpm: p.rpm, message: `Only ${p.knockMarginDeg.toFixed(1)}° knock margin at ${p.rpm} rpm.` });
    if (p.egtC > LIMITS.egtFailC) add({ severity: "fail", code: "egt", rpm: p.rpm, message: `Exhaust gas temperature ${Math.round(p.egtC)}°C at ${p.rpm} rpm exceeds the ${LIMITS.egtFailC}°C turbine/valve limit.` });
    else if (p.egtC > LIMITS.egtWarnC) add({ severity: "warn", code: "egt_high", rpm: p.rpm, message: `EGT ${Math.round(p.egtC)}°C at ${p.rpm} rpm is close to the limit.` });
    if (p.injectorDutyPct > LIMITS.idcFailPct) add({ severity: "fail", code: "injectors_maxed", rpm: p.rpm, message: `Injectors at ${Math.round(p.injectorDutyPct)}% duty at ${p.rpm} rpm: they cannot deliver the commanded fuel, so the engine runs lean (${p.afrActual.toFixed(1)}:1 actual).` });
    else if (p.injectorDutyPct > LIMITS.idcWarnPct) add({ severity: "warn", code: "injectors_high", rpm: p.rpm, message: `Injector duty ${Math.round(p.injectorDutyPct)}% at ${p.rpm} rpm leaves little headroom.` });
    if (p.afrActual > LIMITS.wotAfrFail[kind]) add({ severity: "fail", code: "lean_wot", rpm: p.rpm, message: `WOT AFR ${p.afrActual.toFixed(1)}:1 at ${p.rpm} rpm is dangerously lean for a ${kind === "turbo" ? "boosted" : "naturally aspirated"} engine.` });
    else if (p.afrActual > LIMITS.wotAfrWarn[kind]) add({ severity: "warn", code: "lean_ish_wot", rpm: p.rpm, message: `WOT AFR ${p.afrActual.toFixed(1)}:1 at ${p.rpm} rpm is on the lean side.` });
    if (p.torqueNm > spec.internalsLimitNm) add({ severity: "fail", code: "internals", rpm: p.rpm, message: `${Math.round(p.torqueNm)} Nm at ${p.rpm} rpm exceeds the ${spec.internalsLimitNm} Nm rating of the stock rods and pistons.` });
    else if (p.torqueNm > spec.internalsLimitNm * 0.92) add({ severity: "warn", code: "internals_close", rpm: p.rpm, message: `${Math.round(p.torqueNm)} Nm is within 8% of the stock internals rating.` });
  }
  if (tune.revLimit > spec.mechanicalRpm) add({ severity: "fail", code: "valve_float", message: `Rev limit ${tune.revLimit} rpm is above the ${spec.mechanicalRpm} rpm valvetrain limit (valve float, piston-to-valve contact).` });
  else if (tune.revLimit > spec.redline + 300) add({ severity: "warn", code: "rev_limit_high", message: `Rev limit ${tune.revLimit} rpm is ${tune.revLimit - spec.redline} rpm over factory redline.` });
  if (spec.aspiration === "turbo") {
    const maxT = Math.max(...tune.boostPsi);
    if (maxT > spec.turboMaxPsi + 1.5) add({ severity: "fail", code: "turbo_overspeed", message: `Boost target ${maxT} psi exceeds the ${spec.turboMaxPsi} psi the stock turbo can make without overspeeding.` });
    else if (maxT > spec.turboMaxPsi) add({ severity: "warn", code: "turbo_edge", message: `Boost target ${maxT} psi is at the edge of the stock turbo's map.` });
  }
  const best = points.reduce((a, b) => (b.hp > a.hp ? b : a), points[0]);
  const bestT = points.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a), points[0]);
  return {
    env,
    points,
    peakHp: Math.round(best.hp),
    peakHpRpm: best.rpm,
    peakTorqueNm: Math.round(bestT.torqueNm),
    peakTorqueRpm: bestT.rpm,
    minKnockMarginDeg: r1(Math.min(...points.map((p) => p.knockMarginDeg))),
    maxEgtC: Math.round(Math.max(...points.map((p) => p.egtC))),
    maxInjectorDutyPct: Math.round(Math.max(...points.map((p) => p.injectorDutyPct))),
    leanestWotAfr: r1(Math.max(...points.map((p) => p.afrActual))),
    maxBoostPsi: r1(Math.max(...points.map((p) => p.boostPsi))),
    issues: issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "fail" ? -1 : 1)),
  };
}

/* ---------- vehicle dynamics ---------- */

export interface DragResult {
  zeroTo60s: number | null;
  quarterMileS: number | null;
  trapMph: number | null;
  trace: { t: number; mph: number; rpm: number; gear: number }[];
}

/** Straight-line launch to the quarter mile, with traction limit, shifts and aero drag. */
export function runDrag(spec: EngineSpec, tune: Tune, env: Environment): DragResult {
  const v = spec.vehicle;
  const g = 9.81;
  const rho = 1.2 * Math.exp(-env.altitudeM / 8400);
  const shiftRpm = Math.min(tune.revLimit - 150, spec.mechanicalRpm);
  const dt = 0.01;
  let t = 0;
  let speed = 0;
  let dist = 0;
  let gear = 0;
  let shiftTimer = 0;
  let z60: number | null = null;
  const trace: DragResult["trace"] = [];
  while (t < 30 && dist < 402.3) {
    const ratio = v.gears[gear] * v.finalDrive;
    // Clutch slip holds launch rpm until the wheels catch up.
    const rpm = Math.max(spec.aspiration === "turbo" ? 3200 : 4000, (speed / v.tireRadiusM) * ratio * (60 / (2 * Math.PI)));
    let force = 0;
    if (shiftTimer > 0) shiftTimer -= dt;
    else {
      const p = engineAt(spec, tune, env, Math.min(rpm, tune.revLimit - 1), 100);
      force = (p.torqueNm * ratio * v.drivetrainEff) / v.tireRadiusM;
    }
    const traction = v.massKg * g * v.drivenWeight * (v.drive === "awd" ? 1.5 : 1.25);
    force = Math.min(force, traction);
    const drag = 0.5 * rho * v.cdA * speed * speed + v.massKg * g * 0.012;
    speed = Math.max(0, speed + ((force - drag) / (v.massKg * 1.08)) * dt);
    dist += speed * dt;
    t += dt;
    const mph = speed * 2.23694;
    if (z60 === null && mph >= 60) z60 = t;
    if (rpm >= shiftRpm && gear < v.gears.length - 1 && shiftTimer <= 0) {
      gear++;
      shiftTimer = 0.25;
    }
    if (Math.round(t / dt) % 10 === 0) trace.push({ t: r1(t * 10) / 10, mph: r1(mph), rpm: Math.round(rpm), gear: gear + 1 });
  }
  return { zeroTo60s: z60 === null ? null : Math.round(z60 * 100) / 100, quarterMileS: dist >= 402.3 ? Math.round(t * 100) / 100 : null, trapMph: dist >= 402.3 ? r1(speed * 2.23694) : null, trace };
}
