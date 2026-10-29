"use client";
import { useEffect, useState } from "react";
import type { DtcLookup } from "./dtc-db";

export type { DtcLookup };

const cache = new Map<string, DtcLookup>();

/** Looks codes up in the trouble-code database through /api/dtc, using the VIN to pick the brand's table. */
export async function fetchDtcs(codes: string[], vin?: string | null): Promise<DtcLookup[]> {
  const k = (c: string) => `${vin ?? ""}:${c.toUpperCase()}`;
  const missing = [...new Set(codes.map((c) => c.toUpperCase()))].filter((c) => !cache.has(k(c)));
  if (missing.length) {
    const qs = new URLSearchParams({ codes: missing.join(",") });
    if (vin) qs.set("vin", vin);
    const res = await fetch(`/api/dtc?${qs}`);
    if (!res.ok) throw new Error(`Trouble-code lookup failed (${res.status})`);
    const { results } = (await res.json()) as { results: DtcLookup[] };
    for (const r of results) cache.set(k(r.code), r);
  }
  return codes.map((c) => cache.get(k(c))).filter((r): r is DtcLookup => !!r);
}

/** Lookup results keyed by code; empty until the request returns. */
export function useDtcLookups(codes: string[], vin?: string | null): Record<string, DtcLookup> {
  const [found, setFound] = useState<Record<string, DtcLookup>>({});
  const key = codes.join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetchDtcs(key.split(","), vin)
      .then((rs) => alive && setFound(Object.fromEntries(rs.map((r) => [r.code, r]))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, vin]);
  return found;
}
