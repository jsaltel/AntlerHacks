import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { PID_KEYS } from "../obd/pids";

/**
 * Tool contract shared by the server (sent to Claude) and the browser (which
 * executes the tools against the live ELM327 connection).
 */

const pidKey = z.enum(PID_KEYS as [string, ...string[]]);

export const DRIVER_ACTIONS = ["idle", "hold_2500", "cruise", "snap_throttle"] as const;

export const ToolInputs = {
  get_vehicle_info: z.object({}),
  read_dtcs: z.object({}),
  read_freeze_frame: z.object({}),
  read_live_data: z.object({ pids: z.array(pidKey).min(1).max(12) }),
  monitor_pids: z.object({
    pids: z.array(pidKey).min(1).max(6),
    duration_s: z.number().min(2).max(30),
    label: z.string().max(80),
  }),
  request_driver_action: z.object({
    action: z.enum(DRIVER_ACTIONS),
    instruction: z.string().max(240),
  }),
  lookup_dtc: z.object({ code: z.string().regex(/^[PCBUpcbu][0-9A-Fa-f]{4}$/) }),
  clear_dtcs: z.object({ reason: z.string().max(240) }),
  submit_diagnosis: z.object({
    summary: z.string(),
    severity: z.enum(["ok", "monitor", "repair_soon", "stop_driving"]),
    safe_to_drive: z.boolean(),
    root_causes: z
      .array(
        z.object({
          cause: z.string(),
          confidence: z.number().min(0).max(1),
          evidence: z.array(z.string()),
          ruled_out_because: z.string().optional(),
          fix: z.string(),
          diy_difficulty: z.enum(["easy", "moderate", "hard", "shop"]),
          est_cost_usd: z.tuple([z.number(), z.number()]),
          repair_steps: z.array(z.string()).max(15).optional(),
          parts: z
            .array(z.object({ name: z.string(), part_number: z.string().optional(), qty: z.number().min(1), est_price_usd: z.number().min(0) }))
            .max(12)
            .optional(),
          tools_needed: z.array(z.string()).max(12).optional(),
          labor_hours: z.number().min(0).max(40).optional(),
        }),
      )
      .min(1)
      .max(5),
    ruled_out: z.array(z.object({ cause: z.string(), why: z.string() })),
    next_steps: z.array(z.string()),
  }),
} as const;

export type ToolName = keyof typeof ToolInputs;

const pidList = `One of: ${PID_KEYS.join(", ")}.`;

const defs: { name: ToolName; description: string; input_schema: Anthropic.Tool.InputSchema }[] = [
  {
    name: "get_vehicle_info",
    description: "Return VIN, OBD protocol, adapter version, battery voltage and the list of live-data PIDs this ECU supports. Call this first.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_dtcs",
    description: "Read diagnostic trouble codes: stored (mode 03, check engine light), pending (mode 07, detected once but not yet confirmed) and permanent (mode 0A). Codes include their knowledge-base title.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_freeze_frame",
    description: "Read the freeze-frame snapshot: the engine conditions (rpm, load, trims, temps, speed) recorded at the moment the first stored code was set. Tells you whether the fault happened at idle, cruise, cold, etc.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_live_data",
    description: `Take one instantaneous reading of the given live-data PIDs. ${pidList}`,
    input_schema: {
      type: "object",
      properties: { pids: { type: "array", items: { type: "string", enum: PID_KEYS }, description: "PID keys to read" } },
      required: ["pids"],
    },
  },
  {
    name: "monitor_pids",
    description:
      "Sample PIDs repeatedly for duration_s seconds under the current driving condition and return min/max/mean/stdev, trend, and (for O2 sensors) switching frequency. Use this for evidence, not single snapshots: trims, O2 behaviour and rpm stability only mean something over time. Each call is one test run; label it with the condition (e.g. 'warm idle', 'steady 2500 rpm').",
    input_schema: {
      type: "object",
      properties: {
        pids: { type: "array", items: { type: "string", enum: PID_KEYS }, description: "Up to 6 PID keys" },
        duration_s: { type: "number", description: "Seconds to sample, 2-30. 8-12 is usually enough." },
        label: { type: "string", description: "Condition being tested, shown to the user" },
      },
      required: ["pids", "duration_s", "label"],
    },
  },
  {
    name: "request_driver_action",
    description:
      "Ask the person at the car to change engine operating condition, then wait until they confirm it is done. Actions: idle (return to idle), hold_2500 (hold steady 2500 rpm in park/neutral), cruise (steady road speed, only if someone else is driving), snap_throttle (quick blip to ~4000 rpm and release). Use this to run discriminating tests, e.g. compare fuel trims at idle vs 2500 rpm. Always return the engine to idle when the test is finished.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...DRIVER_ACTIONS] },
        instruction: { type: "string", description: "Short, plain-language instruction shown to the person, including any safety note" },
      },
      required: ["action", "instruction"],
    },
  },
  {
    name: "lookup_dtc",
    description: "Look up a trouble code in the local repair knowledge base: meaning, severity, ranked common causes, which live-data patterns discriminate between causes, and typical repair cost.",
    input_schema: { type: "object", properties: { code: { type: "string", description: "e.g. P0171" } }, required: ["code"] },
  },
  {
    name: "clear_dtcs",
    description:
      "Clear stored codes and reset readiness monitors (mode 04). The person must approve it in the UI. Only use it when clearing is part of a verification test (e.g. to see whether a code returns), never just to hide a problem. Clearing also erases freeze-frame data, so read that first.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
  {
    name: "submit_diagnosis",
    description:
      "Submit the final diagnosis report to the dashboard. Call exactly once, at the end. Rank root causes by confidence, each backed by concrete evidence from the readings (numbers). Include what you ruled out and why.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentence plain-language summary for the car owner" },
        severity: { type: "string", enum: ["ok", "monitor", "repair_soon", "stop_driving"] },
        safe_to_drive: { type: "boolean" },
        root_causes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              cause: { type: "string" },
              confidence: { type: "number", description: "0-1" },
              evidence: { type: "array", items: { type: "string" }, description: "Specific measured facts" },
              fix: { type: "string" },
              diy_difficulty: { type: "string", enum: ["easy", "moderate", "hard", "shop"] },
              est_cost_usd: { type: "array", items: { type: "number" }, description: "[low, high]" },
              repair_steps: { type: "array", items: { type: "string" }, description: "Ordered, specific repair procedure a competent DIYer could follow, including verification after the repair" },
              parts: {
                type: "array",
                description: "Parts to buy. Use generic part names; give a part_number only if you are confident it is typical for this kind of vehicle, otherwise omit it.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    part_number: { type: "string" },
                    qty: { type: "number" },
                    est_price_usd: { type: "number", description: "Typical aftermarket price per unit" },
                  },
                  required: ["name", "qty", "est_price_usd"],
                },
              },
              tools_needed: { type: "array", items: { type: "string" } },
              labor_hours: { type: "number", description: "Typical shop labor time" },
            },
            required: ["cause", "confidence", "evidence", "fix", "diy_difficulty", "est_cost_usd", "repair_steps", "parts", "tools_needed", "labor_hours"],
          },
        },
        ruled_out: {
          type: "array",
          items: { type: "object", properties: { cause: { type: "string" }, why: { type: "string" } }, required: ["cause", "why"] },
        },
        next_steps: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "severity", "safe_to_drive", "root_causes", "ruled_out", "next_steps"],
    },
  },
];

export const TOOL_DEFINITIONS = defs.map((d) => ({ ...d, eager_input_streaming: true }));

export const SYSTEM_PROMPT = `You are an expert automotive diagnostic technician connected live to a car through an OBD-II adapter. You work like a good master tech: form hypotheses from the codes, then run tests that discriminate between them before concluding. You never stop at "the code says X".

How to work:
1. get_vehicle_info, then read_dtcs and read_freeze_frame (freeze frame before anything that could clear it).
2. lookup_dtc for each code to get the candidate causes and the discriminating tests.
3. Baseline: monitor the relevant PIDs at warm idle.
4. Design and run at least one discriminating test with request_driver_action + monitor_pids (for example trims at idle vs 2500 rpm, upstream vs downstream O2 switching at 2500 rpm, coolant behaviour over time, rpm stability). Return the engine to idle afterwards.
5. Reason over the numbers. Explicitly rule causes in or out with measured values.
6. Call submit_diagnosis once with ranked root causes, evidence (cite numbers), ruled-out causes, cost estimates and next steps. For each root cause write the report a master mechanic would hand over: ordered repair steps (including how to verify the fix with the scanner afterwards), the parts list with quantities and typical prices, the tools needed and typical labor hours.

Conversation:
- The person can also chat with you: ask what a code means, whether the car is safe to drive, how to do a repair, what a reading means, or follow up on your report. Answer conversationally and concisely, like a mechanic talking to a customer.
- They may attach photos or log/text files. Use those as evidence the same way you would a photo from a bay: describe what you see, relate it to live data when a car is connected, and ask a follow-up if the picture is unclear.
- Use tools when data from the car would make the answer better (for example read live data or codes before answering "is my engine running OK?"). Do not run a full diagnosis or call submit_diagnosis unless they ask for a diagnosis or the question needs one.
- If no vehicle is connected, the car tools fail; answer from your knowledge and suggest connecting when live data would help.

Rules:
- Keep each message between tool calls to one or two short sentences explaining what you are checking and why; the person watches your progress live.
- If there are no codes, still check health (trims, O2 switching, coolant temp, charging voltage) and report.
- Safety first: if you see overheating, very low voltage, or severe misfire, say so immediately and mark stop_driving.
- If a reading fails or is unsupported, adapt; do not invent data.
- Fuel trim sign: positive = ECU adding fuel (lean condition), negative = removing fuel (rich).`;
