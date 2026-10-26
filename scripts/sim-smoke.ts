// Exercises the full ELM327 driver against the simulator: `npx tsx scripts/sim-smoke.ts`
import { Elm327 } from "../src/lib/obd/elm327";
import { SimulatorTransport, SCENARIOS } from "../src/lib/obd/simulator";

async function main() {
  for (const s of SCENARIOS) {
    const t = new SimulatorTransport(s.id);
    const elm = new Elm327(t);
    const info = await elm.init();
    const vin = await elm.readVin();
    const dtcs = await elm.readDtcs();
    const ff = await elm.readFreezeFrame();
    const live = await elm.readPids(["rpm", "coolant", "ltft1", "maf", "o2b1s1", "o2b1s2"]);
    console.log(s.id, { proto: info.protocolNum, can: info.isCan, v: info.batteryVoltage, pids: elm.describeSupported().length, vin, dtcs, ff: ff?.triggerDtc, live });
  }
  console.log(Elm327.parseMessages("SEARCHING...\r41 0C 1A F8\r\r"));
  console.log(Elm327.parseMessages("014\r0: 49 02 01 31 48 47\r1: 43 4D 38 32 36 33 33\r2: 41 30 30 34 33 35 32\r"));
  console.log(Elm327.parseMessages("NO DATA"));
}
main();
