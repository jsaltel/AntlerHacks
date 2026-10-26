const SYSTEM = ["P", "C", "B", "U"];

/** Decodes a two-byte J1979 trouble code, e.g. [0x01, 0x71] -> "P0171". */
export function decodeDtc(a: number, b: number): string | null {
  if (a === 0 && b === 0) return null;
  const sys = SYSTEM[(a >> 6) & 0x3];
  const d1 = (a >> 4) & 0x3;
  const rest = ((a & 0x0f) << 8) | b;
  return `${sys}${d1}${rest.toString(16).toUpperCase().padStart(3, "0")}`;
}

export function encodeDtc(code: string): [number, number] {
  const sys = SYSTEM.indexOf(code[0].toUpperCase());
  const d1 = parseInt(code[1], 16);
  const rest = parseInt(code.slice(2), 16);
  return [(sys << 6) | (d1 << 4) | (rest >> 8), rest & 0xff];
}
