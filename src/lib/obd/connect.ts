import { Elm327, ObdError } from "./elm327";
import { SerialTransport } from "./serial";
import { BleTransport } from "./ble";
import { SimulatorTransport, type ScenarioId } from "./simulator";
import type { WireLogEntry } from "./transport";

export type ConnectMode = "simulator" | "serial" | "ble";

const BAUD_RATES = [38400, 115200, 9600];

export async function connectObd(mode: ConnectMode, scenario: ScenarioId, onWire: (e: WireLogEntry) => void): Promise<Elm327> {
  const transport = mode === "serial" ? new SerialTransport(BAUD_RATES[0]) : mode === "ble" ? new BleTransport() : new SimulatorTransport(scenario);
  await transport.open();
  const elm = new Elm327(transport);
  elm.onWire = onWire;

  if (transport instanceof SerialTransport) {
    // Clones ship at 38400, OBDLink at 115200: probe with ATI before full init.
    let found = false;
    for (let i = 0; i < BAUD_RATES.length && !found; i++) {
      if (i > 0) await transport.reopen(BAUD_RATES[i]);
      try {
        await elm.send("ATI", 1500);
        found = true;
      } catch {
        onWire({ t: Date.now(), dir: "rx", text: `(no reply at ${BAUD_RATES[i]} baud)` });
      }
    }
    if (!found) {
      await transport.close();
      throw new ObdError("Adapter did not respond at 38400, 115200 or 9600 baud. Is it plugged in and the ignition on?");
    }
  }

  try {
    await elm.init();
  } catch (e) {
    await transport.close();
    throw e;
  }
  return elm;
}
