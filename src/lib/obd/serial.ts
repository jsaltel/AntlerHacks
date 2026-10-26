import type { ObdTransport } from "./transport";

/**
 * USB (or paired classic-Bluetooth COM port) ELM327 adapter via Web Serial.
 * Works in Chrome / Edge on desktop. OBDLink adapters default to 115200 baud,
 * most clones to 38400, so we try both.
 */
export class SerialTransport implements ObdTransport {
  readonly kind = "serial" as const;
  label = "USB serial";
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private cb: (chunk: string) => void = () => {};
  private closed = false;
  private generation = 0;
  private loop: Promise<void> = Promise.resolve();

  constructor(private baudRate = 38400) {}

  static supported() {
    return typeof navigator !== "undefined" && !!navigator.serial;
  }

  onData(cb: (chunk: string) => void) {
    this.cb = cb;
  }

  async open() {
    if (!navigator.serial) throw new Error("Web Serial is not available. Use Chrome or Edge on desktop.");
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baudRate });
    const info = this.port.getInfo();
    this.label = `USB serial ${info.usbVendorId?.toString(16) ?? ""}:${info.usbProductId?.toString(16) ?? ""} @ ${this.baudRate}`;
    this.loop = this.readLoop();
  }

  private async readLoop() {
    const gen = ++this.generation;
    const decoder = new TextDecoder();
    while (this.port?.readable && !this.closed && gen === this.generation) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this.cb(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Non-fatal read errors (e.g. framing): loop and re-acquire the reader.
      } finally {
        this.reader.releaseLock();
      }
    }
  }

  /** Re-opens the already-granted port at another baud rate (for auto-detect). */
  async reopen(baudRate: number) {
    if (!this.port) throw new Error("Serial port is not open");
    this.closed = true;
    try {
      await this.reader?.cancel();
    } catch {}
    await this.loop;
    await this.port.close();
    this.baudRate = baudRate;
    await this.port.open({ baudRate });
    this.closed = false;
    const info = this.port.getInfo();
    this.label = `USB serial ${info.usbVendorId?.toString(16) ?? ""}:${info.usbProductId?.toString(16) ?? ""} @ ${baudRate}`;
    this.loop = this.readLoop();
  }

  async write(text: string) {
    if (!this.port?.writable) throw new Error("Serial port is not open");
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text));
    } finally {
      writer.releaseLock();
    }
  }

  async close() {
    this.closed = true;
    try {
      await this.reader?.cancel();
    } catch {}
    await this.loop;
    try {
      await this.port?.close();
    } catch {}
    this.port = null;
  }
}
