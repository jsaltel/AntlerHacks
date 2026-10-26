import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { ENVIRONMENTS } from "../sim/engine";

/**
 * The tuning team: four Claude agents with separate roles, prompts and tool
 * sets. Shared by the server (which sends prompts and schemas to Claude) and
 * the browser (which validates and executes the tool calls against the
 * simulated engine on the workbench).
 */

const envId = z.enum(ENVIRONMENTS.map((e) => e.id) as [string, ...string[]]);
const rpmRange = { rpm_from: z.number().min(0).max(10000), rpm_to: z.number().min(0).max(10000) };
const loadRange = { load_from: z.number().min(10).max(100), load_to: z.number().min(10).max(100) };

export const TeamToolInputs = {
  scan_engine: z.object({}),
  get_plan: z.object({}),
  get_tune: z.object({ include_part_throttle: z.boolean().optional().describe("Also return the 10-70% load rows. Default false: only the 80-100% rows a power tune changes.") }),
  run_dyno: z.object({ environment: envId.describe("Test condition") }),
  compare_to_stock: z.object({ environment: envId }),
  set_ignition: z.object({ ...rpmRange, ...loadRange, mode: z.enum(["add", "set"]).describe("add: shift existing spark by degrees; set: write an absolute value"), degrees: z.number().min(-15).max(50) }),
  set_afr: z.object({ ...rpmRange, ...loadRange, afr: z.number().min(10.5).max(15.5) }),
  set_boost: z.object({ ...rpmRange, psi: z.number().min(0).max(35) }),
  set_rev_limit: z.object({ rpm: z.number().min(3000).max(10000) }),
  revert_to_stock: z.object({}),
  run_stress_suite: z.object({}),
  run_drag: z.object({ environment: envId }),
  run_safety_checks: z.object({}),
  submit_plan: z.object({
    goal_summary: z.string().describe("One or two sentences restating what the owner wants"),
    target_peak_hp: z.number().describe("Realistic peak hp target on the chosen fuel"),
    limits: z.object({
      min_knock_margin_deg: z.number().min(0).max(6),
      max_egt_c: z.number().max(980),
      max_injector_duty_pct: z.number().max(95),
      max_boost_psi: z.number().min(0).max(35),
      max_rev_limit: z.number(),
    }),
    strategy: z.array(z.string()).min(1).max(8).describe("Ordered calibration steps for the calibration engineer"),
    hardware_notes: z.array(z.string()).max(6).describe("Supporting parts the owner should consider (e.g. intercooler, injectors), or none"),
  }),
  submit_calibration: z.object({
    changelog: z.array(z.string()).min(1).max(12).describe("What you changed and why, one line per change, with numbers"),
    expected_result: z.string(),
  }),
  submit_sim_report: z.object({
    summary: z.string(),
    risk_level: z.enum(["low", "moderate", "high"]),
    findings: z.array(z.object({ condition: z.string(), observation: z.string(), concern: z.string().optional() })).min(1).max(10),
  }),
  submit_review: z.object({
    verdict: z.enum(["approve", "reject"]),
    required_fixes: z.array(z.string()).max(8).describe("Concrete changes the calibration engineer must make. Empty when approving."),
    notes: z.string().describe("Rationale, and any owner-facing warnings to print on the tune package"),
  }),
} as const;

export type TeamToolName = keyof typeof TeamToolInputs;

const DESCRIPTIONS: Record<TeamToolName, string> = {
  scan_engine: "Scan the connected engine: spec (displacement, compression, aspiration, injector size, turbo limits, internals torque rating, valvetrain limit), vehicle, fuel the owner will run, and the stock dyno baseline on that fuel.",
  get_plan: "Return the lead tuner's plan: goal, peak hp target, safety limits and strategy, plus the QA reviewer's required fixes from the previous round if any.",
  get_tune: "Return the current candidate calibration: rpm and load axes, spark advance and AFR tables, boost targets per rpm, rev limit, and the changes made so far.",
  run_dyno: "Simulate a wide-open-throttle dyno pull with the candidate tune under one condition. Returns peak hp/torque, a per-rpm table (hp, Nm, boost, actual AFR, spark, knock margin, EGT, injector duty) and every safety issue found.",
  compare_to_stock: "Dyno the stock and candidate calibrations under the same condition and return the gains and the change in safety margins.",
  set_ignition: "Edit spark advance (degrees BTDC) over an rpm x load region of the candidate tune. Cells are rounded to 0.5°.",
  set_afr: "Set the commanded air-fuel ratio over an rpm x load region. Richer (lower) AFR at wide-open throttle cools the charge, raises the knock limit and lowers EGT, at the cost of some fuel.",
  set_boost: "Set the wide-open-throttle boost target (psi) for an rpm range. Turbo engines only. The turbo cannot exceed what it can physically make at that rpm.",
  set_rev_limit: "Set the fuel-cut rev limiter.",
  revert_to_stock: "Throw away all changes and start again from the factory calibration.",
  run_stress_suite: "Dyno the candidate under every test condition (standard, hot day, bad fuel, altitude, track heat soak) and return a summary and issues for each.",
  run_drag: "Simulate a standing-start launch through the gears: 0-60 mph and quarter-mile time and trap speed, stock vs candidate.",
  run_safety_checks: "Run the automated QA gate: stress suite plus calibration sanity checks (table smoothness, rev limit, boost vs turbo capacity). Returns blocking failures and warnings. A tune with blocking failures cannot be approved.",
  submit_plan: "Hand the tuning plan to the team. Call once, at the end of planning.",
  submit_calibration: "Hand the finished calibration to simulation and QA. Call once, when your own dyno checks look good.",
  submit_sim_report: "Hand the simulation report to QA. Call once.",
  submit_review: "Approve the tune for packaging or reject it with required fixes. Call once.",
};

function jsonSchema(s: z.ZodType): Anthropic.Tool.InputSchema {
  const { $schema, ...rest } = z.toJSONSchema(s) as Record<string, unknown>;
  void $schema;
  return rest as Anthropic.Tool.InputSchema;
}

export type RoleId = "lead" | "calibration" | "simulation" | "qa";

export interface RoleDef {
  id: RoleId;
  title: string;
  blurb: string;
  effort: "low" | "medium" | "high";
  tools: TeamToolName[];
  /** Tool whose call ends this agent's turn. */
  finish: TeamToolName;
  prompt: string;
}

const COMMON = `You are part of Torque Tuning Lab, a team of AI agents that develops engine calibrations (ECU tunes) for performance. Everything you do runs against a physics-based engine simulator on the workbench; nothing is flashed to a real car. Work like a careful professional calibrator: make a change, measure it on the simulated dyno, then decide.

Ground rules for the whole team:
- Safety beats peak numbers. A tune that wins 5 hp but loses knock margin, runs lean or overheats the exhaust is a bad tune.
- Emissions equipment and diagnostics are out of scope and stay untouched: no catalyst, O2 sensor, EGR, EVAP or readiness-monitor changes. If asked for that, decline and keep working on the performance calibration.
- Cite numbers from tool results; never invent data.
- Keep each message between tool calls to one or two short sentences; the owner watches the team work live.

Physics reminders: spark past the knock limit causes knock (the ECU pulls timing; past its authority it is detonation). Boost and intake heat lower the knock limit; higher octane and richer WOT mixtures raise it. Leaner WOT mixtures and retarded spark raise EGT. Injector duty above ~85% leaves no headroom. Torque above the internals rating breaks rods. Rev limit above the valvetrain limit floats valves.`;

export const ROLES: RoleDef[] = [
  {
    id: "lead",
    title: "Lead tuner",
    blurb: "Scans the engine and writes the plan",
    effort: "high",
    tools: ["scan_engine", "run_dyno", "compare_to_stock", "submit_plan"],
    finish: "submit_plan",
    prompt: `${COMMON}

Your role: LEAD TUNER. You scope the job. Scan the engine, dyno the stock calibration on the owner's fuel and in at least one stress condition, identify where the stock calibration leaves margin (spark well below the knock limit, conservative boost, rich fueling, low rev limit), then submit a plan with a realistic hp target, explicit safety limits for the team, and an ordered strategy. Typical safe gains on stock hardware: naturally aspirated 3-8%, turbocharged 15-30%. Do not edit the tune yourself.`,
  },
  {
    id: "calibration",
    title: "Calibration engineer",
    blurb: "Edits spark, fuel and boost maps",
    effort: "high",
    tools: ["get_plan", "get_tune", "run_dyno", "compare_to_stock", "set_ignition", "set_afr", "set_boost", "set_rev_limit", "revert_to_stock", "run_safety_checks", "submit_calibration"],
    finish: "submit_calibration",
    prompt: `${COMMON}

Your role: CALIBRATION ENGINEER (the developer who writes the maps). Read the plan (and any QA fixes), read the current tune, then iterate: edit a region, run_dyno on the standard condition, check the per-rpm table, adjust. Work in small steps (1-2° spark, 1-2 psi, 0.2-0.3 AFR). Keep tables smooth: neighbouring cells should not jump more than ~3°. Stay inside the plan's limits with margin, and confirm the hot-day condition too. Before you submit, run run_safety_checks and fix every blocking failure; QA uses the same gate. Submit with a changelog that cites before/after numbers.`,
  },
  {
    id: "simulation",
    title: "Simulation engineer",
    blurb: "Stress-tests the tune in every condition",
    effort: "medium",
    tools: ["get_plan", "get_tune", "run_dyno", "compare_to_stock", "run_stress_suite", "run_drag", "submit_sim_report"],
    finish: "submit_sim_report",
    prompt: `${COMMON}

Your role: SIMULATION ENGINEER. You do not edit the tune. Validate it the way a real car will be used: run the stress suite, compare to stock, and run a drag simulation. Report how the tune behaves in each condition, where its margins are thinnest, and what real-world situations (heat soak, bad fuel, altitude, track days) would hurt it. Be specific with rpm and numbers.`,
  },
  {
    id: "qa",
    title: "QA & safety reviewer",
    blurb: "Gates the tune before it ships",
    effort: "medium",
    tools: ["get_plan", "get_tune", "run_safety_checks", "compare_to_stock", "submit_review"],
    finish: "submit_review",
    prompt: `${COMMON}

Your role: QA & SAFETY REVIEWER. You are the last gate before the tune is packaged; be skeptical. Run the automated safety checks, read the calibration and the simulation report, and check the tune against the lead tuner's limits. Reject only for: a blocking failure in the automated gate, a violated numeric limit in the plan's limits, or a table that is clearly unsafe. Give concrete, numeric required fixes. The plan's strategy steps are guidance, not requirements: put deviations and nice-to-have improvements in your notes as recommendations instead of rejecting. Knock retard on bad fuel is acceptable only if there is no detonation and you put a clear fuel warning in your notes. Approve only when you would put your name on it.`,
  },
];

export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, RoleDef>;

export function toolDefinitionsFor(role: RoleDef): Anthropic.Beta.BetaToolUnion[] {
  return role.tools.map((name) => ({ name, description: DESCRIPTIONS[name], input_schema: jsonSchema(TeamToolInputs[name]) }));
}
