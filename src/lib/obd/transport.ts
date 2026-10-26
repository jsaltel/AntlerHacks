/**
 * A byte-stream link to an ELM327-compatible adapter. Every transport (USB
 * serial, BLE, simulator) speaks the same raw ELM327 text protocol, so the
 * protocol layer above it is exercised identically in the demo and in a car.
 */
export interface ObdTransport {
  readonly kind: "serial" | "ble" | "simulator";
  readonly label: string;
  open(): Promise<void>;
  write(text: string): Promise<void>;
  /** Registers the single consumer of incoming text chunks. */
  onData(cb: (chunk: string) => void): void;
  close(): Promise<void>;
}

export type WireDirection = "tx" | "rx";
export interface WireLogEntry {
  t: number;
  dir: WireDirection;
  text: string;
}
