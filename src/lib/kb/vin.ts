/**
 * Brand from a VIN's World Manufacturer Identifier (its first three characters).
 * Brand ids match the manufacturer tables in data/dtc-codes.json; brands with no
 * manufacturer table (Hyundai, Volvo…) still resolve so the name can be shown.
 */

const WMI: Record<string, string> = {};
const add = (brand: string, codes: string) => codes.split(" ").forEach((c) => (WMI[c] = brand));

add("FORD", "1FA 1FB 1FC 1FD 1FM 1FT 2FA 2FM 2FT 3FA 3FE 3FM 3FT NM0 WF0 MAJ 6FP");
add("LINCOLN", "1LN 1LJ 2LM 3LN 5LM 5LT");
add("MERCURY", "1ME 2ME 3ME 2MR 4M2");
add("CHEVY", "1G1 1GA 1GB 1GC 1GN 2G1 2GC 2GN 3G1 3GC 3GN KL1 KL8");
add("GMC", "1GT 1GK 1GD 2GT 2GK 3GT 3GK");
add("BUICK", "1G4 2G4 3G4 5GA KL4 LRB");
add("CADILLAC", "1G6 1GY 2G6 3GY");
add("PONTIAC", "1G2 2G2 3G2 5Y2 6G2");
add("OLDSMOBILE", "1G3 2G3 1GH");
add("SATURN", "1G8 5GZ");
add("GEO", "1Y1 2C1 JG1");
add("CHRYSLER", "1C3 2C3 3C3 2C4 1C8 2A4 2A8 3A4 3A8");
add("DODGE", "1B3 1B4 1B7 2B3 2B4 2B7 3B3 3B7 1D3 1D4 1D7 1D8 2D3 2D4 2D8 3D3 3D4 3D7 1C6 1C7 3C6 3C7");
add("JEEP", "1J4 1J7 1J8 1C4");
add("PLYMOUTH", "1P3 1P4 2P3 2P4");
add("TOYOTA", "2T1 2T3 4T1 4T3 4T4 5TB 5TD 5TE 5TF 5YF 3TM 3TY JTD JTE JTK JTL JTM JTN");
add("LEXUS", "JTH JTJ 2T2 58A");
add("HONDA", "JHM JHL JH2 1HG 2HG 3HG 5FN 5J6 7FA 19X SHH SHS");
add("ACURA", "JH4 19U 19V 5J8");
add("NISSAN", "JN1 JN6 JN8 1N4 1N6 3N1 3N6 5N1 5BZ");
add("NISSAN", "JNK JNR JNX 5N3 3PC"); // Infiniti uses Nissan's codes
add("VOLKSWAGEN", "WVW WVG WV1 WV2 3VW 1VW 9BW");
add("AUDI", "WAU WA1 WUA TRU");
add("BMW", "WBA WBS WBX WBY 5UX 5UM 4US 5YM X4X");
add("MERCEDES", "WDB WDC WDD WDF WD3 WD4 W1K W1N W1V W1X 4JG 55S");
add("MAZDA", "JM1 JM3 JM7 4F2 4F4 1YV 3MZ 3MV");
add("SUBARU", "JF1 JF2 4S3 4S4 4S6");
add("MITSUBISHI", "JA3 JA4 JA7 4A3 4A4 6MM ML3");
add("KIA", "KNA KND KNM 5XY 5XX 3KP U5Y");
add("HYUNDAI", "KMH KM8 KMF 5NP 5NM 3KM");
add("JAGUAR", "SAJ SAD");
add("LAND ROVER", "SAL");
add("SUZUKI", "JS2 JS3 JS4 2S3 KL5");
add("VOLVO", "YV1 YV4 7JR");
add("PORSCHE", "WP0 WP1");
add("MINI", "WMW");
add("TESLA", "5YJ 7SA LRW");

const LABELS: Record<string, string> = {
  GM: "GM",
  CHEVY: "Chevrolet",
  GMC: "GMC",
  BMW: "BMW",
  MERCEDES: "Mercedes-Benz",
  "LAND ROVER": "Land Rover",
  MINI: "MINI",
};

export const brandLabel = (brand: string) => LABELS[brand] ?? brand.charAt(0) + brand.slice(1).toLowerCase();

/** Brand id for a VIN, or null when the WMI isn't recognised. */
export function brandFromVin(vin: string | null | undefined): string | null {
  if (!vin || vin.length < 3) return null;
  return WMI[vin.slice(0, 3).toUpperCase()] ?? null;
}
