/** SAE J1979 mode 01 parameter IDs this app understands. */
export interface PidDef {
  pid: number;
  key: string;
  name: string;
  unit: string;
  bytes: number;
  decode: (d: number[]) => number;
  /** Inverse of decode, used by the simulator to encode values on the wire. */
  encode: (v: number) => number[];
  min: number;
  max: number;
}

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const word = (v: number) => {
  const w = Math.max(0, Math.min(65535, Math.round(v)));
  return [w >> 8, w & 0xff];
};
const trim = (d: number[]) => ((d[0] - 128) * 100) / 128;
const trimEnc = (v: number) => [clampByte((v * 128) / 100 + 128)];

export const PIDS: PidDef[] = [
  { pid: 0x04, key: "load", name: "Engine load", unit: "%", bytes: 1, decode: (d) => (d[0] * 100) / 255, encode: (v) => [clampByte((v * 255) / 100)], min: 0, max: 100 },
  { pid: 0x05, key: "coolant", name: "Coolant temp", unit: "°C", bytes: 1, decode: (d) => d[0] - 40, encode: (v) => [clampByte(v + 40)], min: -40, max: 130 },
  { pid: 0x06, key: "stft1", name: "Short-term fuel trim B1", unit: "%", bytes: 1, decode: trim, encode: trimEnc, min: -25, max: 25 },
  { pid: 0x07, key: "ltft1", name: "Long-term fuel trim B1", unit: "%", bytes: 1, decode: trim, encode: trimEnc, min: -25, max: 25 },
  { pid: 0x08, key: "stft2", name: "Short-term fuel trim B2", unit: "%", bytes: 1, decode: trim, encode: trimEnc, min: -25, max: 25 },
  { pid: 0x09, key: "ltft2", name: "Long-term fuel trim B2", unit: "%", bytes: 1, decode: trim, encode: trimEnc, min: -25, max: 25 },
  { pid: 0x0b, key: "map", name: "Intake manifold pressure", unit: "kPa", bytes: 1, decode: (d) => d[0], encode: (v) => [clampByte(v)], min: 0, max: 255 },
  { pid: 0x0c, key: "rpm", name: "Engine RPM", unit: "rpm", bytes: 2, decode: (d) => (d[0] * 256 + d[1]) / 4, encode: (v) => word(v * 4), min: 0, max: 7000 },
  { pid: 0x0d, key: "speed", name: "Vehicle speed", unit: "km/h", bytes: 1, decode: (d) => d[0], encode: (v) => [clampByte(v)], min: 0, max: 200 },
  { pid: 0x0e, key: "timing", name: "Timing advance", unit: "°", bytes: 1, decode: (d) => d[0] / 2 - 64, encode: (v) => [clampByte((v + 64) * 2)], min: -64, max: 64 },
  { pid: 0x0f, key: "iat", name: "Intake air temp", unit: "°C", bytes: 1, decode: (d) => d[0] - 40, encode: (v) => [clampByte(v + 40)], min: -40, max: 100 },
  { pid: 0x10, key: "maf", name: "Mass air flow", unit: "g/s", bytes: 2, decode: (d) => (d[0] * 256 + d[1]) / 100, encode: (v) => word(v * 100), min: 0, max: 200 },
  { pid: 0x11, key: "throttle", name: "Throttle position", unit: "%", bytes: 1, decode: (d) => (d[0] * 100) / 255, encode: (v) => [clampByte((v * 255) / 100)], min: 0, max: 100 },
  { pid: 0x14, key: "o2b1s1", name: "O2 sensor B1S1 (upstream)", unit: "V", bytes: 2, decode: (d) => d[0] / 200, encode: (v) => [clampByte(v * 200), 0xff], min: 0, max: 1.275 },
  { pid: 0x15, key: "o2b1s2", name: "O2 sensor B1S2 (downstream)", unit: "V", bytes: 2, decode: (d) => d[0] / 200, encode: (v) => [clampByte(v * 200), 0xff], min: 0, max: 1.275 },
  { pid: 0x1f, key: "runtime", name: "Run time since start", unit: "s", bytes: 2, decode: (d) => d[0] * 256 + d[1], encode: (v) => word(v), min: 0, max: 65535 },
  { pid: 0x2f, key: "fuel", name: "Fuel level", unit: "%", bytes: 1, decode: (d) => (d[0] * 100) / 255, encode: (v) => [clampByte((v * 255) / 100)], min: 0, max: 100 },
  { pid: 0x42, key: "voltage", name: "Control module voltage", unit: "V", bytes: 2, decode: (d) => (d[0] * 256 + d[1]) / 1000, encode: (v) => word(v * 1000), min: 0, max: 20 },
  { pid: 0x46, key: "ambient", name: "Ambient air temp", unit: "°C", bytes: 1, decode: (d) => d[0] - 40, encode: (v) => [clampByte(v + 40)], min: -40, max: 60 },
  { pid: 0x5c, key: "oiltemp", name: "Engine oil temp", unit: "°C", bytes: 1, decode: (d) => d[0] - 40, encode: (v) => [clampByte(v + 40)], min: -40, max: 160 },
];

export const PID_BY_KEY = Object.fromEntries(PIDS.map((p) => [p.key, p])) as Record<string, PidDef>;
export const PID_BY_NUM = new Map(PIDS.map((p) => [p.pid, p]));
export const PID_KEYS = PIDS.map((p) => p.key);

/** PIDs the dashboard polls continuously, in priority order. */
export const DASHBOARD_PIDS = ["rpm", "speed", "coolant", "load", "stft1", "ltft1", "o2b1s1", "o2b1s2", "maf", "throttle", "map", "voltage"];

export const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
