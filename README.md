# Torque: AI diagnostic technician

Plug a $20 OBD-II adapter into a car, open a browser tab, and an AI agent diagnoses it like a master technician. It reads the codes, then **runs live tests on the engine** ("hold 2500 rpm while I watch the fuel trims") to tell causes apart before it gives an answer.

Built for the AITX & MLOps World Community Hackathon (Antler agents track).

## Why it's more than a code reader

A P0171 "system too lean" code has at least five common causes, from a $5 vacuum hose to a $400 fuel pump. A code reader stops at the code. Torque's agent:

1. Reads stored, pending and permanent codes, plus the freeze-frame data, VIN and battery voltage.
2. Pulls ranked causes and the *discriminating tests* for each cause from a local repair knowledge base.
3. Designs an experiment and asks the driver to change engine state (idle, 2500 rpm, cruise, snap throttle).
4. Samples live PIDs during each condition and computes statistics: mean, spread, trend, and O2 sensor switching frequency.
5. Reasons over the numbers. For example, "LTFT +17% at idle drops to +8% at 2500 rpm, so this is a vacuum leak and not the MAF." It submits a report with ranked root causes, the evidence for each, the causes it ruled out, fixes, and costs.

## Architecture

```
Browser (Chrome/Edge)                               Next.js server
┌──────────────────────────────────────────┐        ┌──────────────────────────┐
│ Dashboard (gauges, charts, timeline)     │        │ /api/agent               │
│ Agent loop  ──── transcript ────────────────────▶ │  Claude (tool use,       │
│   ▲  executes tool calls locally  ◀── streamed ── │  adaptive thinking,      │
│   │                                      │ NDJSON │  streamed reasoning)     │
│ ELM327 driver (queue, ISO-TP, J1979)     │        └──────────────────────────┘
│   ├─ Web Serial  → USB ELM327 / OBDLink  │
│   ├─ Web Bluetooth → BLE adapters        │
│   └─ Simulator  → emulated ELM327 + engine model
└──────────────────────────────────────────┘
```

* **Tools run where the hardware is.** The model runs server-side (the API key never reaches the browser), but its tools execute in the browser, next to the adapter. Each step posts the transcript to `/api/agent`, which streams Claude's turn back. The browser then runs the tool calls against the car and posts the results.
* **One protocol stack for all transports.** The simulator emulates an ELM327 v1.5 *on the wire*: AT commands, the `>` prompt, headers-off hex and ISO-TP multi-frame responses. The demo therefore runs the exact same driver code as a real car.
* **A physically plausible fault model.** Fuel trims respond to airflow, O2 sensors switch with load, and coolant warms up over time. A vacuum leak and a dirty MAF both set P0171/P0174, but they behave differently at 2500 rpm, so the agent has to run the test to tell them apart. Cleared codes come back as pending and then stored while the fault persists.
* **Safety rails.** Clearing codes needs explicit user approval in the UI. Driver actions are prompts the person confirms, and tool inputs are schema-validated (zod) before execution.
* **Observability.** The UI shows tokens, cache hits and the cost of each diagnosis, along with the raw ELM327 wire log.

| Path | What it is |
|---|---|
| `src/lib/obd/elm327.ts` | ELM327 driver: command queue, prompt framing, multi-frame reassembly, mode 01/02/03/04/07/09/0A |
| `src/lib/obd/simulator.ts` | Engine model + ELM327 emulator with 6 fault scenarios |
| `src/lib/obd/serial.ts`, `ble.ts` | Web Serial (baud auto-detect 38400/115200/9600) and Web Bluetooth transports |
| `src/lib/kb/dtcs.ts` | Repair knowledge base: causes, discriminating tests, costs |
| `src/lib/kb/dtc-db.ts`, `src/app/api/dtc` | Trouble-code database: every generic SAE code plus manufacturer tables for 30+ brands, picked by the VIN's brand. Human-readable list in [docs/DTC_CODES.md](docs/DTC_CODES.md) |
| `src/lib/agent/tools.ts` | Tool contract + system prompt (shared by server and browser) |
| `src/lib/agent/runner.ts`, `executor.ts` | Browser-side agent loop and tool execution |
| `src/app/api/agent/route.ts` | Claude streaming endpoint (diagnostics) |
| `src/lib/agent/stream.ts` | Shared NDJSON streaming of one Claude turn |
| `src/lib/sim/engine.ts` | Engine + vehicle physics: VE, turbo spool, intake heat, injectors, spark vs knock limit, EGT, dyno, drag strip |
| `src/lib/tune/team.ts` | The four tuning agents: roles, prompts and tool contracts |
| `src/lib/tune/workbench.ts` | Tool execution on the simulated engine, the QA safety gate and the tune package |
| `src/lib/tune/pipeline.ts` | Plan → calibrate → simulate → QA loop (up to 3 rounds) |
| `src/app/tune/page.tsx`, `src/app/sim/page.tsx` | Tuning lab and car simulator pages |
| `src/components/SketchfabCar.tsx` | Embedded Sketchfab 3D cars: camera views and paint via the Viewer API |

## Pages

* **Home** (`/`): a get-started guide: get an adapter, plug it in, connect it to the laptop, press Connect, ask the technician. It also has a one-click simulator demo.
* **Diagnostics** (`/diagnostics`): connection, live gauges and charts, trouble codes and the wire log.
* **AI Technician** (`/technician`): a chat with the AI technician above. Type questions or problems (it works without a car, too), or run a full diagnosis. Both tabs share one adapter connection, so a diagnosis keeps running when you switch tabs. The report includes, for each root cause, step-by-step repair instructions, a parts list with prices, tools and labor hours.
* **Tuning** (`/tune`): pick the car and fuel, describe the goal, and a team of four Claude agents develops an ECU calibration on the simulated engine:
  * **Lead tuner** scans the engine, dynos stock in several conditions and writes a plan with hard safety limits.
  * **Calibration engineer** edits the spark, AFR and boost maps and rev limit, measuring each change on the dyno.
  * **Simulation engineer** stress-tests the candidate (hot day, bad fuel, altitude, track heat soak, drag strip).
  * **QA & safety reviewer** runs the automated gate and approves the tune or sends it back with numeric fixes.
  
  You can also edit the maps by hand. Approved tunes export as a JSON package or go to the simulator. Tunes stay virtual: emissions controls are never touched, and flashing a real ECU needs a platform-specific flash tool (an ELM327 can't write maps).
* **Simulator** (`/sim`): five cars (Civic Si, GTI, Mustang GT, Alfa Romeo Giulia Quadrifoglio, Jeep Wrangler Rubicon JK). The Giulia and Wrangler show an interactive 3D model embedded from Sketchfab (by MaximePages and ROH3D) through the Viewer API, with camera views and, for the Giulia, paint colors. The models are the creators' work and are embedded, not copied into this repo. Drive the car in real time (throttle slider, arrow keys, auto launch or cruise) with stock or saved tunes, change conditions, inject faults (clogged injectors, boost leak, heat soak, bad fuel) and compare stock vs tune across a test matrix.

## Run it

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000 in Chrome or Edge (get-started page)
```

* **Simulator:** choose a scenario, or "Mystery car" for a random fault that is revealed after the diagnosis. Then Connect, and Diagnose.
* **Real car:** plug the USB ELM327 or OBDLink adapter into the car and the laptop, turn the ignition on (engine running for live tests), pick **USB adapter**, and choose the port. Web Serial needs Chrome or Edge on localhost or HTTPS.

Tests:

```bash
npx tsx scripts/sim-smoke.ts                 # protocol stack against every simulator scenario
npx tsx scripts/engine-check.ts              # stock dyno, drag and safety results for every car and condition
node scripts/build-dtc-db.mjs                # refresh the trouble-code database and docs/DTC_CODES.md
npm run build && npx next start -p 3100 &
node scripts/e2e-mock.mjs out.png            # full UI + tool loop with a scripted model (no API key needed)
```
