"use client";
import { useEffect, useState } from "react";
import type { DtcLookup } from "./dtc-db";
import type { DtcExplanation } from "./explain";

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

const explained = new Map<string, Promise<DtcExplanation>>();
const STORE = "torque.dtc-explain.v2:";

/** The AI technician's explanation of one code for this car's make, cached in memory and in the browser. */
export function fetchDtcExplanation(code: string, vin?: string | null): Promise<DtcExplanation> {
  const k = `${vin?.slice(0, 8) ?? ""}:${code.toUpperCase()}`;
  let p = explained.get(k);
  if (!p) {
    p = (async () => {
      try {
        const saved = localStorage.getItem(STORE + k);
        if (saved) return JSON.parse(saved) as DtcExplanation;
      } catch {}
      const res = await fetch("/api/dtc/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, vin }) });
      const body = (await res.json()) as { explanation?: DtcExplanation; error?: string };
      if (!res.ok || !body.explanation) throw new Error(body.error ?? `Explanation failed (${res.status})`);
      try {
        localStorage.setItem(STORE + k, JSON.stringify(body.explanation));
      } catch {}
      return body.explanation;
    })();
    explained.set(k, p);
    // A failed request can be retried later.
    p.catch(() => explained.delete(k));
  }
  return p;
}

export function useDtcExplanation(code: string, vin?: string | null) {
  const [state, setState] = useState<{ data?: DtcExplanation; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fetchDtcExplanation(code, vin)
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e: Error) => alive && setState({ error: e.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [code, vin]);
  return state;
}
