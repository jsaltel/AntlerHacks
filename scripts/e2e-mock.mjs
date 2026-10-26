// UI + tool-loop smoke test with a scripted stand-in for the model.
// Usage: next start -p 3100, then `node scripts/e2e-mock.mjs`
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const script = [
  [{ name: "get_vehicle_info", input: {} }],
  [{ name: "read_dtcs", input: {} }, { name: "read_freeze_frame", input: {} }],
  [{ name: "lookup_dtc", input: { code: "P0171" } }],
  [{ name: "monitor_pids", input: { pids: ["stft1", "ltft1", "maf", "rpm"], duration_s: 4, label: "warm idle" } }],
  [{ name: "request_driver_action", input: { action: "hold_2500", instruction: "Hold the engine at a steady 2500 rpm in park." } }],
  [{ name: "monitor_pids", input: { pids: ["stft1", "ltft1", "maf", "rpm"], duration_s: 4, label: "steady 2500 rpm" } }],
  [{ name: "request_driver_action", input: { action: "idle", instruction: "Release the throttle." } }],
  [{ name: "submit_diagnosis", input: { summary: "Mock summary.", severity: "repair_soon", safe_to_drive: true, root_causes: [{ cause: "Vacuum leak", confidence: 0.8, evidence: ["LTFT 17% at idle, 5% at 2500"], fix: "Smoke test intake", diy_difficulty: "moderate", est_cost_usd: [20, 300] }], ruled_out: [{ cause: "Dirty MAF", why: "Trims normalize at 2500" }], next_steps: ["Smoke test"] } }],
  [],
];

const toolResults = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message, e.stack?.split("\n").slice(0,4).join(" | ")));
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
await page.route("**/api/agent", async (route) => {
  const body = JSON.parse(route.request().postData());
  const last = body.messages[body.messages.length - 1];
  if (Array.isArray(last.content)) toolResults.push(...last.content.map((c) => JSON.parse(c.content)));
  const step = Math.floor(body.messages.length / 2);
  const calls = script[step] ?? [];
  const content = [{ type: "thinking", thinking: `Step ${step} reasoning.`, signature: "x" }, { type: "text", text: `Step ${step}: checking.` }, ...calls.map((c, i) => ({ type: "tool_use", id: `tu_${step}_${i}`, name: c.name, input: c.input }))];
  const lines = [
    { type: "block_start", block: "thinking" }, { type: "thinking", text: `Step ${step} reasoning.` },
    { type: "block_start", block: "text" }, { type: "text", text: `Step ${step}: checking.` },
    { type: "message", message: { id: "m", type: "message", role: "assistant", model: "mock", content, stop_reason: calls.length ? "tool_use" : "end_turn", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } } },
  ];
  await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
});
await page.goto("http://localhost:" + (process.env.PORT ?? "3100") + "/technician");
await page.selectOption("select", "vacuum_leak");
await page.click("text=Connect");
await page.waitForSelector("text=Disconnect", { timeout: 20000 });
await page.waitForTimeout(2500);
await page.click("button:has-text('Run full diagnosis')");
try { await page.waitForSelector("text=Mock summary.", { timeout: 40000 }); } catch { console.log("TIMEOUT"); }
await page.waitForTimeout(500);
await page.screenshot({ path: process.argv[2] ?? "e2e.png" });
const mon = toolResults.filter((r) => r.condition);
for (const m of mon) console.log(m.condition, JSON.stringify(m.stats.map((s) => [s.key, s.mean, s.samples])));
console.log("dtcs:", JSON.stringify(toolResults.find((r) => r.stored)));
await browser.close();
