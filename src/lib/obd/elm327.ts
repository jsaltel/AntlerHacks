import type { ObdTransport, WireLogEntry } from "./transport";
import { PID_BY_KEY, PID_BY_NUM, hex2 } from "./pids";
import { decodeDtc } from "./dtc";

export class ObdError extends Error {}

const ERROR_MARKERS = ["UNABLE TO CONNECT", "CAN ERROR", "BUS ERROR", "BUS INIT: ...ERROR", "STOPPED", "FB ERROR", "DATA ERROR", "BUFFER FULL", "ACT ALERT", "LV RESET"];

export interface AdapterInfo {
  version: string;
  protocol: string;
  protocolNum: number;
  isCan: boolean;
  batteryVoltage: number | null;
  supportedPids: number[];
}

export interface DtcReport {
  stored: string[];
  pending: string[];
  permanent: string[];
}

/**
 * ELM327 protocol driver: command queue, prompt framing, ISO-TP multi-frame
 * reassembly and J1979 decoding. Transport-agnostic.
 */
export class Elm327 {
  private buffer = "";
  private waiter: { resolve: (s: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  info: AdapterInfo | null = null;
  onWire: (e: WireLogEntry) => void = () => {};

  constructor(public transport: ObdTransport) {
    transport.onData((chunk) => this.handleData(chunk));
  }

  private handleData(chunk: string) {
    this.buffer += chunk;
    const idx = this.buffer.indexOf(">");
    if (idx === -1) return;
    const raw = this.buffer.slice(0, idx);
    this.buffer = this.buffer.slice(idx + 1);
    this.onWire({ t: Date.now(), dir: "rx", text: raw.replace(/\r+/g, " ⏎ ").trim() });
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      const w = this.waiter;
      this.waiter = null;
      w.resolve(raw);
    }
  }

  /** Sends one command and resolves with the raw text before the '>' prompt. Serialized. */
  send(cmd: string, timeoutMs = 4000): Promise<string> {
    const run = async () => {
      this.buffer = "";
      const p = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiter = null;
          reject(new ObdError(`Timeout waiting for response to ${cmd}`));
        }, timeoutMs);
        this.waiter = { resolve, reject, timer };
      });
      this.onWire({ t: Date.now(), dir: "tx", text: cmd });
      await this.transport.write(cmd + "\r");
      return p;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async init(): Promise<AdapterInfo> {
    const reset = (await this.send("ATZ", 6000)).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    const version = reset.find((l) => l.includes("ELM") || l.includes("STN")) ?? reset.pop() ?? "unknown";
    for (const c of ["ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0"]) await this.send(c);
    // The first OBD request triggers the protocol search, which can take a while.
    const supported = await this.supportedPids(12000);
    const dpn = (await this.send("ATDPN")).trim().replace(/^A/, "");
    const protocolNum = parseInt(dpn, 16) || 0;
    const protocol = (await this.send("ATDP")).trim();
    const rv = (await this.send("ATRV")).trim();
    const batteryVoltage = parseFloat(rv) || null;
    this.info = {
      version,
      protocol,
      protocolNum,
      isCan: protocolNum >= 6 && protocolNum <= 9,
      batteryVoltage,
      supportedPids: supported,
    };
    return this.info;
  }

  /** Splits a raw response into J1979 messages (byte arrays), reassembling ISO-TP frames. */
  static parseMessages(raw: string): number[][] {
    const lines = raw
      .split(/[\r\n]+/)
      .map((l) => l.replace(/\s+/g, "").toUpperCase())
      .filter((l) => l && !l.startsWith("SEARCHING") && l !== "OK");
    if (lines.some((l) => l === "NODATA" || l.includes("NODATA"))) return [];
    if (lines.some((l) => l === "?")) throw new ObdError("Adapter did not understand the command");
    const err = lines.find((l) => ERROR_MARKERS.some((m) => l.includes(m.replace(/\s+/g, ""))));
    if (err) throw new ObdError(`Adapter error: ${err}`);

    const messages: number[][] = [];
    let mfLen = 0;
    let mf: string | null = null;
    const flushMf = () => {
      if (mf !== null) messages.push(hexBytes(mf).slice(0, mfLen || undefined));
      mf = null;
      mfLen = 0;
    };
    for (const line of lines) {
      if (/^[0-9A-F]{3}$/.test(line)) {
        flushMf();
        mfLen = parseInt(line, 16);
        mf = "";
      } else if (/^[0-9A-F]:/.test(line)) {
        if (mf === null) mf = "";
        mf += line.slice(2);
      } else if (/^[0-9A-F]+$/.test(line)) {
        flushMf();
        messages.push(hexBytes(line));
      }
    }
    flushMf();
    return messages;
  }

  async query(mode: number, pid?: number, extra = "", timeoutMs?: number): Promise<number[][]> {
    const cmd = hex2(mode) + (pid !== undefined ? hex2(pid) : "") + extra;
    return Elm327.parseMessages(await this.send(cmd, timeoutMs));
  }

  async supportedPids(timeoutMs = 4000): Promise<number[]> {
    const out: number[] = [];
    for (const base of [0x00, 0x20, 0x40]) {
      if (base !== 0x00 && !out.includes(base)) break;
      const msgs = await this.query(0x01, base, "", timeoutMs);
      const m = msgs.find((b) => b[0] === 0x41 && b[1] === base);
      if (!m) break;
      const mask = m.slice(2, 6);
      for (let i = 0; i < 32; i++) {
        if (mask[i >> 3] & (0x80 >> (i & 7))) out.push(base + i + 1);
      }
    }
    return out;
  }

  /** Reads one mode-01 PID by key; returns null when the ECU has no data for it. */
  async readPid(key: string): Promise<number | null> {
    const def = PID_BY_KEY[key];
    if (!def) throw new ObdError(`Unknown PID ${key}`);
    const msgs = await this.query(0x01, def.pid);
    const m = msgs.find((b) => b[0] === 0x41 && b[1] === def.pid);
    if (!m || m.length < 2 + def.bytes) return null;
    return round(def.decode(m.slice(2, 2 + def.bytes)));
  }

  async readPids(keys: string[]): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    for (const k of keys) {
      try {
        out[k] = await this.readPid(k);
      } catch {
        out[k] = null;
      }
    }
    return out;
  }

  private async readDtcMode(mode: 0x03 | 0x07 | 0x0a): Promise<string[]> {
    const msgs = await this.query(mode);
    const codes = new Set<string>();
    for (const m of msgs) {
      if (m[0] !== mode + 0x40) continue;
      // CAN responses carry a count byte; legacy protocols pad to 3 codes per frame.
      const body = this.info?.isCan !== false ? m.slice(2) : m.slice(1);
      for (let i = 0; i + 1 < body.length; i += 2) {
        const c = decodeDtc(body[i], body[i + 1]);
        if (c) codes.add(c);
      }
    }
    return [...codes];
  }

  async readDtcs(): Promise<DtcReport> {
    return {
      stored: await this.readDtcMode(0x03),
      pending: await this.readDtcMode(0x07),
      permanent: await this.readDtcMode(0x0a).catch(() => []),
    };
  }

  async clearDtcs(): Promise<boolean> {
    const msgs = await this.query(0x04, undefined, "", 8000);
    return msgs.some((m) => m[0] === 0x44);
  }

  async readFreezeFrame(): Promise<{ triggerDtc: string | null; values: Record<string, number> } | null> {
    const trig = await this.query(0x02, 0x02, "00");
    const t = trig.find((m) => m[0] === 0x42 && m[1] === 0x02);
    const triggerDtc = t ? decodeDtc(t[3], t[4]) : null;
    if (!triggerDtc) return null;
    const values: Record<string, number> = {};
    for (const key of ["rpm", "speed", "coolant", "load", "stft1", "ltft1", "stft2", "ltft2", "map", "maf", "throttle", "iat"]) {
      const def = PID_BY_KEY[key];
      const msgs = await this.query(0x02, def.pid, "00").catch(() => []);
      const m = msgs.find((b) => b[0] === 0x42 && b[1] === def.pid);
      if (m && m.length >= 3 + def.bytes) values[key] = round(def.decode(m.slice(3, 3 + def.bytes)));
    }
    return { triggerDtc, values };
  }

  async readVin(): Promise<string | null> {
    const msgs = await this.query(0x09, 0x02, "", 6000).catch(() => []);
    let bytes: number[] = [];
    for (const m of msgs) {
      if (m[0] !== 0x49 || m[1] !== 0x02) continue;
      bytes = bytes.concat(m.slice(3));
    }
    const vin = String.fromCharCode(...bytes.filter((b) => b >= 0x30 && b <= 0x5a));
    return vin.length >= 11 ? vin.slice(-17) : null;
  }

  describeSupported(): string[] {
    return (this.info?.supportedPids ?? []).map((p) => PID_BY_NUM.get(p)?.key).filter((k): k is string => !!k);
  }

  async close() {
    await this.transport.close();
  }
}

function hexBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;
