"use client";
import { useEffect, useState } from "react";
import type { Diagnosis } from "../agent/executor";
import type { PartsRequest, PartsResult } from "./parts";

export type { PartsResult };

const inflight = new Map<string, Promise<PartsResult>>();
const STORE = "torque.parts.v1:";

/** Real parts listings for a repair (web search on the server), cached in memory and in the browser. */
export function fetchParts(req: PartsRequest): Promise<PartsResult> {
  const k = `${req.vin ?? ""}:${req.cause}`;
  let p = inflight.get(k);
  if (!p) {
    p = (async () => {
      try {
        const saved = localStorage.getItem(STORE + k);
        if (saved) return JSON.parse(saved) as PartsResult;
      } catch {}
      const res = await fetch("/api/parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
      const body = (await res.json()) as { result?: PartsResult; error?: string };
      if (!res.ok || !body.result) throw new Error(body.error ?? `Parts search failed (${res.status})`);
      try {
        localStorage.setItem(STORE + k, JSON.stringify(body.result));
      } catch {}
      return body.result;
    })();
    inflight.set(k, p);
    p.catch(() => inflight.delete(k));
  }
  return p;
}

/** Real parts for the diagnosis's most likely repair; starts searching as soon as the report exists. */
export function useRealParts(d: Diagnosis | null, vin?: string | null) {
  const top = d?.root_causes[0];
  const [state, setState] = useState<{ data?: PartsResult; error?: string; loading: boolean }>({ loading: !!top });
  const key = top ? `${vin ?? ""}:${top.cause}` : "";
  useEffect(() => {
    if (!top) return;
    let alive = true;
    setState({ loading: true });
    fetchParts({ vin, cause: top.cause, fix: top.fix, parts: (top.parts ?? []).map((p) => ({ name: p.name, qty: p.qty })) })
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e: Error) => alive && setState({ error: e.message, loading: false }));
    return () => {
      alive = false;
    };
    // The search depends only on the repair and the car.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
