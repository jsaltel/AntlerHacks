import type { ObdTransport } from "./transport";
import { PID_BY_NUM, PIDS, hex2 } from "./pids";
import { encodeDtc } from "./dtc";

export type ScenarioId = "healthy" | "vacuum_leak" | "dirty_maf" | "misfire_cyl3" | "cat_efficiency" | "thermostat_stuck_open";

export const SCENARIOS: { id: ScenarioId; name: string; blurb: string }[] = [
  { id: "vacuum_leak", name: "Lean at idle", blurb: "Check engine light, rough idle when cold" },
  { id: "dirty_maf", name: "Lean everywhere", blurb: "Check engine light, hesitation when accelerating" },
  { id: "misfire_cyl3", name: "Shaky idle", blurb: "Engine shakes at stoplights, flashing CEL once" },
  { id: "cat_efficiency", name: "Emissions fail", blurb: "Failed inspection, rotten egg smell" },
  { id: "thermostat_stuck_open", name: "Cold heater", blurb: "Heater blows lukewarm, temp gauge stays low" },
  { id: "healthy", name: "Healthy car", blurb: "No complaints, routine check" },
];

export type DriveMode = "idle" | "hold_2500" | "cruise" | "snap_throttle";

interface ScenarioFaults {
  stored: string[];
  pending: string[];
  freeze: Record<string, number> | null;
}

const FAULTS: Record<ScenarioId, ScenarioFaults> = {
  healthy: { stored: [], pending: [], freeze: null },
  vacuum_leak: { stored: ["P0171", "P0174"], pending: [], freeze: { rpm: 742, speed: 0, coolant: 88, load: 21, stft1: 6.3, ltft1: 17.2, stft2: 5.5, ltft2: 16.4, map: 36, maf: 3.9, throttle: 12, iat: 31 } },
  dirty_maf: { stored: ["P0171", "P0174"], pending: ["P0101"], freeze: { rpm: 2380, speed: 64, coolant: 91, load: 38, stft1: 7.8, ltft1: 18.8, stft2: 7.0, ltft2: 18.0, map: 52, maf: 27.0, throttle: 21, iat: 29 } },
  misfire_cyl3: { stored: ["P0303", "P0300"], pending: [], freeze: { rpm: 768, speed: 0, coolant: 90, load: 24, stft1: 4.7, ltft1: 3.1, stft2: 2.3, ltft2: 1.6, map: 38, maf: 2.8, throttle: 12, iat: 30 } },
  cat_efficiency: { stored: ["P0420"], pending: [], freeze: { rpm: 2050, speed: 72, coolant: 92, load: 33, stft1: 0.8, ltft1: 2.3, stft2: 0.8, ltft2: 1.6, map: 45, maf: 13.3, throttle: 18, iat: 27 } },
  thermostat_stuck_open: { stored: ["P0128"], pending: [], freeze: { rpm: 1980, speed: 88, coolant: 63, load: 30, stft1: 1.6, ltft1: 3.9, stft2: 1.6, ltft2: 3.1, map: 44, maf: 11.7, throttle: 17, iat: 22 } },
};

/** The simulated car for each scenario: real-format VINs (valid check digits) and engine size. */
export const SIM_VEHICLES: Record<ScenarioId, { vin: string; liters: number }> = {
  vacuum_leak: { vin: "1FTFW1ET9DFC10312", liters: 3.5 }, // 2013 Ford F-150 EcoBoost V6
  dirty_maf: { vin: "1GCVKREC7EZ163402", liters: 5.3 }, // 2014 Chevrolet Silverado V8
  misfire_cyl3: { vin: "19XFC2F52GE228471", liters: 2.0 }, // 2016 Honda Civic
  cat_efficiency: { vin: "4T1BF1FKXCU514873", liters: 2.5 }, // 2012 Toyota Camry
  thermostat_stuck_open: { vin: "4S4BSANCXF3301129", liters: 2.5 }, // 2015 Subaru Outback
  healthy: { vin: "1HGCM82633A004352", liters: 2.4 }, // 2003 Honda Accord
};

/** Physically-plausible engine model whose outputs depend on the injected fault. */
export class VehicleModel {
  mode: DriveMode = "idle";
  private start = Date.now();
  private last = Date.now();
  private rpm = 750;
  private speed = 0;
  private coolant = 52;
  private ltft = 0;
  private stored: string[];
  private pending: string[];
  private clearedAt: number | null = null;
  private snapUntil = 0;

  constructor(public scenario: ScenarioId) {
    this.stored = [...FAULTS[scenario].stored];
    this.pending = [...FAULTS[scenario].pending];
    this.ltft = this.targetLtft();
  }

  setMode(mode: DriveMode) {
    this.mode = mode;
    if (mode === "snap_throttle") this.snapUntil = Date.now() + 1800;
  }

  get faults() {
    // Cleared codes come back as pending, then stored, while the fault persists.
    if (this.clearedAt && this.scenario !== "healthy") {
      const since = (Date.now() - this.clearedAt) / 1000;
      if (since > 25) return { stored: FAULTS[this.scenario].stored, pending: FAULTS[this.scenario].pending };
      if (since > 10) return { stored: [], pending: FAULTS[this.scenario].stored };
    }
    return { stored: this.stored, pending: this.pending };
  }

  clear() {
    this.stored = [];
    this.pending = [];
    this.clearedAt = Date.now();
  }

  freezeFrame(): Record<string, number> | null {
    return this.clearedAt ? null : FAULTS[this.scenario].freeze;
  }

  private targetRpm() {
    if (this.mode === "snap_throttle" && Date.now() < this.snapUntil) return 4200;
    if (this.mode === "hold_2500") return 2500;
    if (this.mode === "cruise") return 2100;
    return 750;
  }

  /** Airflow-dependent long-term trim: the key discriminator between faults. */
  private targetLtft(rpm = this.rpm) {
    const hi = Math.min(1, Math.max(0, (rpm - 750) / 1750)); // 0 at idle, 1 at 2500
    switch (this.scenario) {
      case "vacuum_leak":
        return 17 - 12 * hi; // unmetered air matters most at low airflow
      case "dirty_maf":
        return 15 + 4 * hi; // under-reported airflow, worse with load
      case "misfire_cyl3":
        return 3;
      case "thermostat_stuck_open":
        return 4;
      default:
        return 2;
    }
  }

  private step() {
    const now = Date.now();
    const dt = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    const tr = this.targetRpm();
    this.rpm += (tr - this.rpm) * Math.min(1, dt * 2.5);
    const ts = this.mode === "cruise" ? 72 : 0;
    this.speed += (ts - this.speed) * Math.min(1, dt * 0.6);
    const warmCap = this.scenario === "thermostat_stuck_open" ? (this.mode === "cruise" ? 61 : 68) : 90;
    this.coolant += (warmCap - this.coolant) * Math.min(1, dt * 0.05);
    this.ltft += (this.targetLtft() - this.ltft) * Math.min(1, dt * 0.35);
  }

  read(): Record<string, number> {
    this.step();
    const t = (Date.now() - this.start) / 1000;
    const n = (a: number) => (Math.random() * 2 - 1) * a;
    const misfire = this.scenario === "misfire_cyl3";
    const rpm = this.rpm + n(misfire && this.rpm < 1200 ? 55 : 8);
    const air = rpm / 750;
    const load = Math.min(100, 18 + (rpm - 750) * 0.008 + (this.mode === "cruise" ? 12 : 0) + n(1.5));
    let maf = 1.3 * SIM_VEHICLES[this.scenario].liters * air * (load / 22);
    if (this.scenario === "dirty_maf") maf *= 0.72;
    if (this.scenario === "vacuum_leak" && this.rpm < 1200) maf *= 0.85;
    const stftBias = misfire ? 4 : this.scenario === "vacuum_leak" ? 5 - 3 * Math.min(1, (rpm - 750) / 1750) : this.scenario === "dirty_maf" ? 6 : 0;
    const osc = Math.sin(t * Math.PI * 2 * (0.8 + air * 0.4));
    const o2up = 0.45 + 0.4 * osc + n(0.04) - (stftBias > 3 ? 0.05 : 0);
    const o2down = this.scenario === "cat_efficiency" ? 0.45 + 0.33 * Math.sin(t * Math.PI * 2 * (0.8 + air * 0.4) - 0.4) + n(0.04) : 0.68 + n(0.02);
    return {
      rpm,
      speed: Math.max(0, this.speed + n(0.4)),
      coolant: this.coolant + n(0.3),
      load,
      stft1: stftBias + n(3),
      ltft1: this.ltft + n(0.4),
      stft2: stftBias * 0.9 + n(3),
      ltft2: this.ltft * 0.95 + n(0.4),
      map: Math.min(100, 30 + (load - 18) * 0.9 + n(1)),
      maf: Math.max(0.5, maf + n(0.15)),
      throttle: Math.min(100, 11.5 + (rpm - 750) * 0.006 + n(0.3)),
      timing: 12 + (rpm - 750) * 0.006 - (misfire ? 3 : 0) + n(1),
      iat: 30 + n(0.5),
      o2b1s1: Math.max(0.05, Math.min(0.95, o2up)),
      o2b1s2: Math.max(0.05, Math.min(0.95, o2down)),
      runtime: t,
      fuel: 62,
      voltage: (this.rpm > 500 ? 14.2 : 12.5) + n(0.05),
      ambient: 24,
      oiltemp: this.coolant + 6,
    };
  }
}

/**
 * Emulates an ELM327 v1.5 on ISO 15765-4 CAN (11 bit, 500 kbaud), including
 * prompt framing, headers-off formatting and ISO-TP multi-frame responses.
 */
export class SimulatorTransport implements ObdTransport {
  readonly kind = "simulator" as const;
  label: string;
  readonly vehicle: VehicleModel;
  private cb: (chunk: string) => void = () => {};
  private spaces = true;
  private echo = true;

  constructor(scenario: ScenarioId) {
    this.vehicle = new VehicleModel(scenario);
    this.label = "Simulator (ELM327 v1.5 emulation)";
  }

  onData(cb: (chunk: string) => void) {
    this.cb = cb;
  }

  async open() {}
  async close() {}

  async write(text: string) {
    const cmd = text.replace(/\s+/g, "").toUpperCase();
    const latency = cmd.startsWith("AT") ? 15 : 35 + Math.random() * 30;
    setTimeout(() => {
      const body = this.respond(cmd);
      const out = (this.echo ? cmd + "\r" : "") + body + "\r\r>";
      // Deliver in two chunks to exercise the prompt framing like a real UART.
      const cut = Math.floor(out.length / 2);
      this.cb(out.slice(0, cut));
      setTimeout(() => this.cb(out.slice(cut)), 3);
    }, latency);
  }

  private fmt(bytes: number[]): string {
    const sep = this.spaces ? " " : "";
    const h = (b: number[]) => b.map(hex2).join(sep);
    if (bytes.length <= 7) return h(bytes);
    const lines = [bytes.length.toString(16).toUpperCase().padStart(3, "0")];
    lines.push(`0:${sep}${h(bytes.slice(0, 6))}`);
    for (let i = 6, f = 1; i < bytes.length; i += 7, f++) lines.push(`${(f % 16).toString(16).toUpperCase()}:${sep}${h(bytes.slice(i, i + 7))}`);
    return lines.join("\r");
  }

  private respond(cmd: string): string {
    if (cmd.startsWith("AT")) {
      const at = cmd.slice(2);
      if (at === "Z") {
        this.echo = true;
        this.spaces = true;
        return "\r\rELM327 v1.5";
      }
      if (at === "I") return "ELM327 v1.5";
      if (at === "E0") return (this.echo = false), "OK";
      if (at === "S0") return (this.spaces = false), "OK";
      if (at === "S1") return (this.spaces = true), "OK";
      if (at === "DPN") return "A6";
      if (at === "DP") return "AUTO, ISO 15765-4 (CAN 11/500)";
      if (at === "RV") return `${this.vehicle.read().voltage.toFixed(1)}V`;
      return "OK";
    }
    const mode = parseInt(cmd.slice(0, 2), 16);
    const pid = cmd.length >= 4 ? parseInt(cmd.slice(2, 4), 16) : undefined;
    const v = this.vehicle;
    switch (mode) {
      case 0x01: {
        if (pid === undefined) return "?";
        if (pid === 0x00 || pid === 0x20 || pid === 0x40) return this.fmt([0x41, pid, ...this.supportMask(pid)]);
        const def = PID_BY_NUM.get(pid);
        if (!def) return "NO DATA";
        return this.fmt([0x41, pid, ...def.encode(v.read()[def.key])]);
      }
      case 0x02: {
        const ff = v.freezeFrame();
        if (!ff || pid === undefined) return "NO DATA";
        if (pid === 0x02) return this.fmt([0x42, 0x02, 0x00, ...encodeDtc(FAULTS[v.scenario].stored[0])]);
        const def = PID_BY_NUM.get(pid);
        if (!def || ff[def.key] === undefined) return "NO DATA";
        return this.fmt([0x42, pid, 0x00, ...def.encode(ff[def.key])]);
      }
      case 0x03:
      case 0x07:
      case 0x0a: {
        const f = v.faults;
        const codes = mode === 0x03 ? f.stored : mode === 0x07 ? f.pending : [];
        return this.fmt([mode + 0x40, codes.length, ...codes.flatMap(encodeDtc)]);
      }
      case 0x04:
        v.clear();
        return "44";
      case 0x09:
        if (pid === 0x02) return this.fmt([0x49, 0x02, 0x01, ...[...SIM_VEHICLES[v.scenario].vin].map((c) => c.charCodeAt(0))]);
        return "NO DATA";
      default:
        return "NO DATA";
    }
  }

  private supportMask(base: number): number[] {
    const mask = [0, 0, 0, 0];
    const pids = PIDS.map((p) => p.pid).concat([0x20, 0x40]);
    for (const p of pids) {
      const i = p - base - 1;
      if (i >= 0 && i < 32) mask[i >> 3] |= 0x80 >> (i & 7);
    }
    return mask;
  }
}
