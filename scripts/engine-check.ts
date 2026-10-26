// Prints stock dyno, drag and safety results for every engine preset under every environment.
import { ENGINES, ENVIRONMENTS, runDyno, runDrag, stockTune } from "../src/lib/sim/engine";

for (const spec of ENGINES) {
  const tune = stockTune(spec);
  for (const e of ENVIRONMENTS) {
    const env = e.env(spec);
    const d = runDyno(spec, tune, env);
    const dr = e.id === "standard" ? runDrag(spec, tune, env) : null;
    console.log(
      `${spec.id.padEnd(11)} ${e.id.padEnd(10)} ${d.peakHp}hp@${d.peakHpRpm} ${d.peakTorqueNm}Nm@${d.peakTorqueRpm} knockMin ${d.minKnockMarginDeg} egt ${d.maxEgtC} idc ${d.maxInjectorDutyPct} afr ${d.leanestWotAfr} boost ${d.maxBoostPsi}` +
        (dr ? ` | 0-60 ${dr.zeroTo60s}s 1/4 ${dr.quarterMileS}s @${dr.trapMph}` : "") +
        (d.issues.length ? `\n    ${d.issues.map((i) => i.severity + ":" + i.code).join(", ")}` : ""),
    );
  }
}
