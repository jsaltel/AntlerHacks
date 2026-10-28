import type { ObdTransport } from "./transport";

// GATT services used by common BLE ELM327 adapters (Vgate iCar Pro, OBDLink CX,
// HM-10 style clones, and the "iOS" generic adapters).
const KNOWN_SERVICES = [
  "0000fff0-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "0000180a-0000-1000-8000-00805f9b34fb",
];

export class BleTransport implements ObdTransport {
  readonly kind = "ble" as const;
  label = "Bluetooth LE";
  private device: BluetoothDevice | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private cb: (chunk: string) => void = () => {};

  static supported() {
    return typeof navigator !== "undefined" && !!navigator.bluetooth;
  }

  onData(cb: (chunk: string) => void) {
    this.cb = cb;
  }

  async open() {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth is not available. Use Chrome or Edge on desktop.");
    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: KNOWN_SERVICES,
      });
    } catch (e) {
      throw new Error(explainBleError(e));
    }
    const server = await this.device.gatt!.connect();
    const services = await server.getPrimaryServices();
    let rx: BluetoothRemoteGATTCharacteristic | null = null;
    for (const svc of services) {
      for (const ch of await svc.getCharacteristics()) {
        if (!rx && (ch.properties.notify || ch.properties.indicate)) rx = ch;
        if (!this.tx && (ch.properties.write || ch.properties.writeWithoutResponse)) this.tx = ch;
      }
      if (rx && this.tx) break;
    }
    if (!rx || !this.tx) throw new Error("No ELM327 serial characteristics found on this device");
    const decoder = new TextDecoder();
    rx.addEventListener("characteristicvaluechanged", () => {
      if (rx!.value) this.cb(decoder.decode(rx!.value));
    });
    await rx.startNotifications();
    this.label = `BLE ${this.device.name ?? "adapter"}`;
  }

  async write(text: string) {
    if (!this.tx) throw new Error("BLE adapter is not connected");
    const bytes = new TextEncoder().encode(text);
    // BLE MTU is often 20 bytes; chunk writes to be safe.
    for (let i = 0; i < bytes.length; i += 20) {
      const part = bytes.slice(i, i + 20);
      if (this.tx.properties.writeWithoutResponse && this.tx.writeValueWithoutResponse) {
        await this.tx.writeValueWithoutResponse(part);
      } else {
        await this.tx.writeValue(part);
      }
    }
  }

  async close() {
    this.device?.gatt?.disconnect();
    this.device = null;
    this.tx = null;
  }
}

function explainBleError(e: unknown): string {
  const msg = e instanceof DOMException || e instanceof Error ? e.message : String(e);
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotFoundError" && /cancelled|canceled/i.test(msg)) return msg;
  if (/globally disabled|permission has been blocked|User or their enterprise policy/i.test(msg)) {
    return "Web Bluetooth is turned off in this browser. Open the app in Chrome or Edge (not Brave, Safari, Firefox, or the Cursor preview). In Brave: brave://flags → enable “Web Bluetooth API” and relaunch. In Chrome: chrome://settings/content/bluetoothDevices → Allow, then use http://localhost (HTTPS or localhost only).";
  }
  return msg || "Bluetooth connection failed";
}
