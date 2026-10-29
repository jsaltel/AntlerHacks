/** Offline VIN decoding: validation, manufacturer (WMI), model year, and a few known model patterns. */

export interface DecodedVehicle {
  vin: string;
  valid: boolean;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  bodyClass: string | null;
  plant: string | null;
  source: "nhtsa" | "offline";
}

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

export function vinCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /\d/.test(c) ? Number(c) : TRANSLIT[c] ?? 0;
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

export function isValidVin(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) && vinCheckDigit(vin) === vin[8];
}

/** Position 10 year code; position 7 being a letter means the 2010-2039 cycle (North American passenger vehicles). */
export function modelYear(vin: string): number | null {
  const idx = YEAR_CODES.indexOf(vin[9]);
  if (idx < 0) return null;
  const base = 1980 + idx;
  return /[A-Z]/.test(vin[6]) ? base + 30 : base;
}

const WMI: Record<string, string> = {
  "1HG": "Honda", "2HG": "Honda", "JHM": "Honda", "19X": "Honda", "5FN": "Honda", "5J6": "Honda", "SHH": "Honda",
  "19U": "Acura", "JH4": "Acura",
  "1FT": "Ford", "1FA": "Ford", "1FM": "Ford", "1FD": "Ford", "2FM": "Ford", "3FA": "Ford", "3FT": "Ford", "1ZV": "Ford", "WF0": "Ford",
  "1LN": "Lincoln", "5LM": "Lincoln",
  "1G1": "Chevrolet", "1GC": "Chevrolet", "1GN": "Chevrolet", "2G1": "Chevrolet", "3GN": "Chevrolet", "3GC": "Chevrolet", "KL7": "Chevrolet",
  "1GT": "GMC", "3GT": "GMC", "1GK": "GMC", "1G6": "Cadillac", "1GY": "Cadillac", "2G4": "Buick", "1G4": "Buick",
  "1C4": "Chrysler / Jeep / Dodge", "1C3": "Chrysler", "1C6": "Ram", "3C6": "Ram", "2C3": "Chrysler", "1J4": "Jeep", "1J8": "Jeep", "1B3": "Dodge", "2B3": "Dodge", "1D7": "Dodge",
  "4T1": "Toyota", "4T3": "Toyota", "5TD": "Toyota", "5TF": "Toyota", "2T1": "Toyota", "2T3": "Toyota", "JTD": "Toyota", "JTE": "Toyota", "JTM": "Toyota", "JTN": "Toyota", "JTK": "Toyota",
  "JTH": "Lexus", "2T2": "Lexus", "58A": "Lexus",
  "1N4": "Nissan", "1N6": "Nissan", "3N1": "Nissan", "5N1": "Nissan", "JN1": "Nissan", "JN8": "Nissan",
  "4S3": "Subaru", "4S4": "Subaru", "JF1": "Subaru", "JF2": "Subaru",
  "KMH": "Hyundai", "5NP": "Hyundai", "5NM": "Hyundai", "KNA": "Kia", "KND": "Kia", "5XY": "Kia", "3KP": "Kia",
  "JM1": "Mazda", "JM3": "Mazda", "3MZ": "Mazda",
  "WVW": "Volkswagen", "3VW": "Volkswagen", "1VW": "Volkswagen", "WVG": "Volkswagen",
  "WAU": "Audi", "WA1": "Audi", "WBA": "BMW", "WBS": "BMW", "5UX": "BMW", "WDD": "Mercedes-Benz", "WDB": "Mercedes-Benz", "4JG": "Mercedes-Benz", "W1K": "Mercedes-Benz",
  "5YJ": "Tesla", "7SA": "Tesla", "YV1": "Volvo", "JA3": "Mitsubishi", "JA4": "Mitsubishi", "ML3": "Mitsubishi",
};

/** Model patterns (WMI + VDS positions 4-8, without check digit) for the simulator fleet and common cars. */
const VDS: Record<string, { model: string; trim?: string; engine?: string; body?: string }> = {
  "1HGCM826": { model: "Accord", trim: "EX", engine: "2.4L I4", body: "Sedan" },
  "1FTFW1ET": { model: "F-150", trim: "SuperCrew", engine: "3.5L V6 EcoBoost", body: "Pickup" },
  "4T1BF1FK": { model: "Camry", trim: "LE", engine: "2.5L I4", body: "Sedan" },
  "19XFC2F5": { model: "Civic", trim: "LX", engine: "2.0L I4", body: "Sedan" },
  "4S4BSANC": { model: "Outback", trim: "2.5i Premium", engine: "2.5L H4", body: "Wagon" },
  "1GCVKREC": { model: "Silverado 1500", trim: "LT", engine: "5.3L V8", body: "Pickup" },
};

export function decodeVinOffline(raw: string): DecodedVehicle {
  const vin = raw.trim().toUpperCase();
  const vds = VDS[vin.slice(0, 8)];
  return {
    vin,
    valid: isValidVin(vin),
    year: vin.length === 17 ? modelYear(vin) : null,
    make: WMI[vin.slice(0, 3)] ?? null,
    model: vds?.model ?? null,
    trim: vds?.trim ?? null,
    engine: vds?.engine ?? null,
    bodyClass: vds?.body ?? null,
    plant: null,
    source: "offline",
  };
}

export function describeVehicle(v: Pick<DecodedVehicle, "year" | "make" | "model" | "trim"> | null): string | null {
  if (!v || !v.make) return null;
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}
