import type { z } from "zod";
import { ENVIRONMENTS, cloneTune, envFor, runDrag, runDyno, stockTune, type DynoResult, type EngineSpec, type Issue, type Tune } from "../sim/engine";
import type { TeamToolInputs, TeamToolName } from "./team";

export type Plan = z.infer<(typeof TeamToolInputs)["submit_plan"]>;
export type Calibration = z.infer<(typeof TeamToolInputs)["submit_calibration"]>;
export type SimReport = z.infer<(typeof TeamToolInputs)["submit_sim_report"]>;
export type Review = z.infer<(typeof TeamToolInputs)["submit_review"]>;

type In<N extends TeamToolName> = z.infer<(typeof TeamToolInputs)[N]>;

const r1 = (v: number) => Math.round(v * 10) / 10;
const half = (v: number) => Math.round(v * 2) / 2;

/** Conditions where any failure blocks approval. Bad fuel only requires a fuel warning. */
const BLOCKING_ENVS = ["standard", "hot_day", "altitude", "track"];

export function dynoSummary(d: DynoResult, every = 500) {
  return {
    peak_hp: `${d.peakHp} hp @ ${d.peakHpRpm} rpm`,
    peak_torque: `${d.peakTorqueNm} Nm @ ${d.peakTorqueRpm} rpm`,
    min_knock_margin_deg: d.minKnockMarginDeg,
    max_egt_c: d.maxEgtC,
    max_injector_duty_pct: d.maxInjectorDutyPct,
    leanest_wot_afr: d.leanestWotAfr,
    max_boost_psi: d.maxBoostPsi,
    issues: d.issues.map((i) => `${i.severity.toUpperCase()} ${i.code}: ${i.message}`),
    table_columns: ["rpm", "hp", "Nm", "boost_psi", "afr", "spark_deg", "knock_margin_deg", "egt_c", "idc_pct"],
    table: d.points
      .filter((p) => p.rpm % every === 0 || p === d.points[d.points.length - 1])
      .map((p) => [p.rpm, Math.round(p.hp), Math.round(p.torqueNm), r1(p.boostPsi), r1(p.afrActual), r1(p.timingActual), r1(p.knockMarginDeg), Math.round(p.egtC), Math.round(p.injectorDutyPct)]),
  };
}

/**
 * The shared bench the agents work on: the engine, the owner's fuel, the
 * factory calibration and the candidate calibration they are developing.
 */
export class Workbench {
  stock: Tune;
  tune: Tune;
  edits: string[] = [];
  plan: Plan | null = null;
  calibration: Calibration | null = null;
  simReport: SimReport | null = null;
  review: Review | null = null;
  previousFixes: string[] = [];
  onChange: () => void = () => {};

  constructor(
    public spec: EngineSpec,
    public octane: number,
    start?: Tune,
  ) {
    this.stock = stockTune(spec);
    this.tune = cloneTune(start ?? this.stock);
    if (this.tune.name === "Stock") this.tune.name = "Torque performance tune";
  }

  env(id: string) {
    return envFor(this.spec, id, this.octane);
  }

  dyno(id = "standard", tune = this.tune) {
    return runDyno(this.spec, tune, this.env(id));
  }

  stressSuite(tune = this.tune) {
    return ENVIRONMENTS.map((e) => ({ id: e.id, label: e.label, result: runDyno(this.spec, tune, this.env(e.id)) }));
  }

  /** Deterministic QA gate: physics failures in realistic conditions, plan limits and table sanity. */
  safetyChecks() {
    const suite = this.stressSuite();
    const blocking: string[] = [];
    const warnings: string[] = [];
    for (const s of suite) {
      for (const i of s.result.issues) {
        const line = `[${s.id}] ${i.code}: ${i.message}`;
        if (i.severity === "fail" && BLOCKING_ENVS.includes(s.id)) blocking.push(line);
        else warnings.push(line);
      }
    }
    if (suite.find((s) => s.id === "low_octane")!.result.issues.some((i) => i.severity === "fail"))
      warnings.push(`[low_octane] Tune is not safe on 87 octane. The package must carry a "${this.octane} octane minimum" warning.`);
    const std = suite[0].result;
    if (this.plan) {
      const L = this.plan.limits;
      if (std.minKnockMarginDeg < L.min_knock_margin_deg) blocking.push(`[plan] Knock margin ${std.minKnockMarginDeg}° is below the plan's ${L.min_knock_margin_deg}° minimum.`);
      if (std.maxEgtC > L.max_egt_c) blocking.push(`[plan] EGT ${std.maxEgtC}°C exceeds the plan's ${L.max_egt_c}°C limit.`);
      if (std.maxInjectorDutyPct > L.max_injector_duty_pct) blocking.push(`[plan] Injector duty ${std.maxInjectorDutyPct}% exceeds the plan's ${L.max_injector_duty_pct}% limit.`);
      if (this.spec.aspiration === "turbo" && Math.max(...this.tune.boostPsi) > L.max_boost_psi) blocking.push(`[plan] Boost target ${Math.max(...this.tune.boostPsi)} psi exceeds the plan's ${L.max_boost_psi} psi.`);
      if (this.tune.revLimit > L.max_rev_limit) blocking.push(`[plan] Rev limit ${this.tune.revLimit} exceeds the plan's ${L.max_rev_limit}.`);
    }
    for (let li = 0; li < this.tune.loadAxis.length; li++) {
      const row = this.tune.ignition[li];
      for (let ri = 1; ri < row.length; ri++) {
        const jump = Math.abs(row[ri] - row[ri - 1]);
        if (jump > 8) blocking.push(`[table] Spark jumps ${jump}° between ${this.tune.rpmAxis[ri - 1]} and ${this.tune.rpmAxis[ri]} rpm at ${this.tune.loadAxis[li]}% load.`);
        else if (jump > 5 && this.tune.loadAxis[li] >= 70) warnings.push(`[table] Spark step of ${jump}° at ${this.tune.rpmAxis[ri]} rpm, ${this.tune.loadAxis[li]}% load.`);
      }
    }
    const stock = this.dyno("standard", this.stock);
    return {
      passed: blocking.length === 0,
      blocking_failures: blocking,
      warnings: [...new Set(warnings)].slice(0, 20),
      gains_vs_stock: { hp: std.peakHp - stock.peakHp, torque_nm: std.peakTorqueNm - stock.peakTorqueNm, pct_hp: r1(((std.peakHp - stock.peakHp) / stock.peakHp) * 100) },
      per_condition: suite.map((s) => ({ condition: s.id, peak_hp: s.result.peakHp, min_knock_margin_deg: s.result.minKnockMarginDeg, max_egt_c: s.result.maxEgtC, max_idc_pct: s.result.maxInjectorDutyPct, fails: s.result.issues.filter((i) => i.severity === "fail").length })),
    };
  }

  private region(rpmFrom: number, rpmTo: number, loadFrom = 10, loadTo = 100) {
    const [ra, rb] = rpmFrom <= rpmTo ? [rpmFrom, rpmTo] : [rpmTo, rpmFrom];
    const [la, lb] = loadFrom <= loadTo ? [loadFrom, loadTo] : [loadTo, loadFrom];
    const cols = this.tune.rpmAxis.map((r, i) => (r >= ra && r <= rb ? i : -1)).filter((i) => i >= 0);
    const rows = this.tune.loadAxis.map((l, i) => (l >= la && l <= lb ? i : -1)).filter((i) => i >= 0);
    if (!cols.length || !rows.length) throw new Error(`No cells in that region. rpm axis: ${this.tune.rpmAxis.join(", ")}; load axis: ${this.tune.loadAxis.join(", ")}`);
    return { rows, cols };
  }

  private changed(line: string) {
    this.edits.push(line);
    this.onChange();
  }

  execute(name: TeamToolName, input: unknown): unknown {
    switch (name) {
      case "scan_engine": {
        const s = this.spec;
        return {
          vehicle: s.name,
          engine: s.engine,
          displacement_l: s.displacementL,
          cylinders: s.cylinders,
          compression: s.compression,
          aspiration: s.aspiration,
          factory_redline: s.redline,
          valvetrain_limit_rpm: s.mechanicalRpm,
          injector_cc_min: s.injectorCcMin,
          internals_torque_limit_nm: s.internalsLimitNm,
          ...(s.aspiration === "turbo" ? { stock_boost_psi: s.stockBoostPsi, turbo_max_efficient_psi: s.turboMaxPsi, intercooler_efficiency: s.intercoolerEff } : {}),
          owner_fuel_octane: this.octane,
          vehicle_mass_kg: s.vehicle.massKg,
          drive: s.vehicle.drive,
          stock_dyno_on_owner_fuel: dynoSummary(this.dyno("standard", this.stock)),
          test_conditions: ENVIRONMENTS.map((e) => `${e.id}: ${e.label}`),
        };
      }
      case "get_plan":
        return { plan: this.plan ?? "No plan yet", qa_required_fixes_from_last_round: this.previousFixes };
      case "get_tune": {
        const { include_part_throttle } = input as In<"get_tune">;
        const t = this.tune;
        const rows = t.loadAxis.map((l, i) => [l, i] as const).filter(([l]) => include_part_throttle || l >= 80);
        return {
          rpm_axis: t.rpmAxis,
          spark_deg_by_load: Object.fromEntries(rows.map(([l, i]) => [`${l}%`, t.ignition[i]])),
          afr_by_load: Object.fromEntries(rows.map(([l, i]) => [`${l}%`, t.afr[i]])),
          ...(this.spec.aspiration === "turbo" ? { boost_psi_wot: t.boostPsi } : {}),
          rev_limit: t.revLimit,
          knock_control_authority_deg: t.knockAuthorityDeg,
          edits_so_far: this.edits,
        };
      }
      case "run_dyno":
        return { condition: (input as In<"run_dyno">).environment, ...dynoSummary(this.dyno((input as In<"run_dyno">).environment)) };
      case "compare_to_stock": {
        const id = (input as In<"compare_to_stock">).environment;
        const a = this.dyno(id, this.stock);
        const b = this.dyno(id);
        return {
          condition: id,
          stock: { peak_hp: a.peakHp, peak_nm: a.peakTorqueNm, min_knock_margin: a.minKnockMarginDeg, max_egt: a.maxEgtC, max_idc: a.maxInjectorDutyPct },
          candidate: { peak_hp: b.peakHp, peak_nm: b.peakTorqueNm, min_knock_margin: b.minKnockMarginDeg, max_egt: b.maxEgtC, max_idc: b.maxInjectorDutyPct },
          gain_hp: b.peakHp - a.peakHp,
          gain_nm: b.peakTorqueNm - a.peakTorqueNm,
          gain_by_rpm: b.points.filter((p) => p.rpm % 1000 === 0).map((p) => {
            const s = a.points.find((x) => x.rpm === p.rpm);
            return { rpm: p.rpm, hp_gain: s ? Math.round(p.hp - s.hp) : null };
          }),
        };
      }
      case "set_ignition": {
        const i = input as In<"set_ignition">;
        const { rows, cols } = this.region(i.rpm_from, i.rpm_to, i.load_from, i.load_to);
        for (const r of rows) for (const c of cols) this.tune.ignition[r][c] = half(Math.max(-10, Math.min(50, i.mode === "add" ? this.tune.ignition[r][c] + i.degrees : i.degrees)));
        this.changed(`Spark ${i.mode === "add" ? (i.degrees >= 0 ? "+" : "") + i.degrees + "°" : "= " + i.degrees + "°"} at ${i.rpm_from}-${i.rpm_to} rpm, ${i.load_from}-${i.load_to}% load`);
        return { cells_changed: rows.length * cols.length, wot_row_now: this.tune.ignition[this.tune.loadAxis.length - 1] };
      }
      case "set_afr": {
        const i = input as In<"set_afr">;
        const { rows, cols } = this.region(i.rpm_from, i.rpm_to, i.load_from, i.load_to);
        for (const r of rows) for (const c of cols) this.tune.afr[r][c] = r1(i.afr);
        this.changed(`AFR = ${i.afr}:1 at ${i.rpm_from}-${i.rpm_to} rpm, ${i.load_from}-${i.load_to}% load`);
        return { cells_changed: rows.length * cols.length, wot_row_now: this.tune.afr[this.tune.loadAxis.length - 1] };
      }
      case "set_boost": {
        if (this.spec.aspiration !== "turbo") throw new Error("This engine is naturally aspirated; there is no boost to set.");
        const i = input as In<"set_boost">;
        const { cols } = this.region(i.rpm_from, i.rpm_to);
        for (const c of cols) this.tune.boostPsi[c] = r1(i.psi);
        this.changed(`Boost = ${i.psi} psi at ${i.rpm_from}-${i.rpm_to} rpm`);
        return { boost_psi_wot_now: this.tune.boostPsi };
      }
      case "set_rev_limit": {
        const { rpm } = input as In<"set_rev_limit">;
        this.tune.revLimit = Math.round(rpm / 50) * 50;
        this.changed(`Rev limit = ${this.tune.revLimit} rpm`);
        return { rev_limit: this.tune.revLimit };
      }
      case "revert_to_stock": {
        this.tune = { ...cloneTune(this.stock), name: this.tune.name };
        this.changed("Reverted to stock calibration");
        return { reverted: true };
      }
      case "run_stress_suite":
        return this.stressSuite().map((s) => ({ condition: s.id, label: s.label, ...dynoSummary(s.result, 1000) }));
      case "run_drag": {
        const env = this.env((input as In<"run_drag">).environment);
        const a = runDrag(this.spec, this.stock, env);
        const b = runDrag(this.spec, this.tune, env);
        const pick = (d: typeof a) => ({ zero_to_60_s: d.zeroTo60s, quarter_mile_s: d.quarterMileS, trap_mph: d.trapMph });
        return { condition: (input as In<"run_drag">).environment, stock: pick(a), candidate: pick(b) };
      }
      case "run_safety_checks":
        return this.safetyChecks();
      case "submit_plan":
        this.plan = input as Plan;
        this.onChange();
        return { received: true };
      case "submit_calibration":
        this.calibration = input as Calibration;
        this.onChange();
        return { received: true };
      case "submit_sim_report":
        this.simReport = input as SimReport;
        this.onChange();
        return { received: true };
      case "submit_review": {
        const r = input as Review;
        if (r.verdict === "approve") {
          const gate = this.safetyChecks();
          if (!gate.passed) throw new Error(`Cannot approve: the automated gate has ${gate.blocking_failures.length} blocking failure(s): ${gate.blocking_failures.join(" | ")}`);
        }
        this.review = r;
        this.onChange();
        return { received: true };
      }
    }
  }
}

export interface TunePackage {
  format: "torque-tune/1";
  created: string;
  name: string;
  vehicle: string;
  engine: string;
  engine_id: string;
  fuel_octane_min: number;
  status: "approved" | "unreviewed";
  emissions_note: string;
  results: { stock_hp: number; tuned_hp: number; stock_nm: number; tuned_nm: number; min_knock_margin_deg: number; max_egt_c: number };
  changelog: string[];
  qa_notes: string | null;
  warnings: Issue[];
  calibration: Tune;
  checksum: string;
}

function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function buildPackage(wb: Workbench): TunePackage {
  const a = wb.dyno("standard", wb.stock);
  const b = wb.dyno("standard");
  const calibration = cloneTune(wb.tune);
  return {
    format: "torque-tune/1",
    created: new Date().toISOString(),
    name: calibration.name,
    vehicle: wb.spec.name,
    engine: wb.spec.engine,
    engine_id: wb.spec.id,
    fuel_octane_min: wb.octane,
    status: wb.review?.verdict === "approve" ? "approved" : "unreviewed",
    emissions_note: "Performance calibration only (spark, fuel, boost, rev limit). Emissions equipment, O2 sensors and OBD monitors are unchanged.",
    results: { stock_hp: a.peakHp, tuned_hp: b.peakHp, stock_nm: a.peakTorqueNm, tuned_nm: b.peakTorqueNm, min_knock_margin_deg: b.minKnockMarginDeg, max_egt_c: b.maxEgtC },
    changelog: wb.calibration?.changelog ?? wb.edits,
    qa_notes: wb.review?.notes ?? null,
    warnings: wb.stressSuite().flatMap((s) => s.result.issues.map((i) => ({ ...i, message: `[${s.id}] ${i.message}` }))),
    calibration,
    checksum: fnv1a(JSON.stringify(calibration)),
  };
}
