"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Embedded 3D car from Sketchfab, driven through the Viewer API. The models are
 * the creators' work (one view-only, one a paid store asset), so they are
 * embedded from Sketchfab rather than copied into this repository.
 */

export interface CarModel {
  uid: string;
  title: string;
  author: string;
  url: string;
  /** Matches the body paint material's name, or null when paint is baked into a shared texture atlas and can't be recolored. */
  paint: RegExp | null;
  colors: { name: string; hex: string }[];
}

export const CAR_MODELS: Record<string, CarModel> = {
  giulia_qv: {
    uid: "373b333a938e49c7ba596919817e844c",
    title: "Alfa Romeo Giulia Quadrifoglio",
    author: "MaximePages",
    url: "https://sketchfab.com/3d-models/alfa-romeo-giulia-quadrifoglio-373b333a938e49c7ba596919817e844c",
    paint: /^Car_Paint$/,
    colors: [
      { name: "Rosso Competizione", hex: "#8f0d12" },
      { name: "Trofeo White", hex: "#e8e6e1" },
      { name: "Vulcano Black", hex: "#141518" },
      { name: "Misano Blue", hex: "#1d3f8f" },
      { name: "Verde Montreal", hex: "#2e4a2c" },
      { name: "Vesuvio Grey", hex: "#5a5d61" },
    ],
  },
  wrangler_jk: {
    uid: "da1d4e15cfa14781963216523f497fd0",
    title: "Jeep Wrangler Rubicon JK 2017",
    author: "ROH3D",
    url: "https://sketchfab.com/3d-models/jeep-wrangler-rubicon-jk-2017-white-da1d4e15cfa14781963216523f497fd0",
    // One texture atlas covers paint, tires and trim, so recoloring would paint the whole truck.
    paint: null,
    colors: [],
  },
};

const API_SRC = "https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js";

/* Minimal typing for the parts of the Viewer API used here. */
interface SfMaterial {
  name: string;
  channels: Record<string, { color?: number[]; enable?: boolean; factor?: number; texture?: unknown }>;
}
interface SfApi {
  start(): void;
  addEventListener(ev: string, cb: () => void): void;
  getMaterialList(cb: (err: unknown, mats: SfMaterial[]) => void): void;
  setMaterial(m: SfMaterial, cb?: () => void): void;
  getCameraLookAt(cb: (err: unknown, cam: { position: number[]; target: number[] }) => void): void;
  setCameraLookAt(position: number[], target: number[], duration?: number, cb?: () => void): void;
  recenterCamera(cb?: () => void): void;
}
declare global {
  interface Window {
    Sketchfab?: new (version: string, iframe: HTMLIFrameElement) => { init(uid: string, opts: Record<string, unknown>): void };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.Sketchfab) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = API_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the Sketchfab viewer"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToLinear = (hex: string) => [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));

// Angles are relative to each model's opening shot, which is a front three-quarter view.
const VIEWS = [
  { label: "Front ¾", angle: 0 },
  { label: "Side", angle: Math.PI / 4 },
  { label: "Rear ¾", angle: Math.PI / 2 },
  { label: "Front", angle: -Math.PI / 4 },
];

export function SketchfabCar({ model }: { model: CarModel }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const api = useRef<SfApi | null>(null);
  const home = useRef<{ position: number[]; target: number[] } | null>(null);
  const paintMats = useRef<SfMaterial[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [paintFound, setPaintFound] = useState(false);
  const [color, setColor] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setPaintFound(false);
    setColor(null);
    api.current = null;
    loadApi()
      .then(() => {
        if (cancelled || !iframe.current || !window.Sketchfab) return;
        const client = new window.Sketchfab("1.12.1", iframe.current);
        client.init(model.uid, {
          autostart: 1,
          preload: 1,
          ui_infos: 0,
          ui_controls: 1,
          ui_stop: 0,
          ui_inspector: 0,
          ui_settings: 0,
          ui_help: 0,
          ui_vr: 0,
          ui_ar: 0,
          ui_annotations: 0,
          success: (a: SfApi) => {
            if (cancelled) return;
            a.start();
            a.addEventListener("viewerready", () => {
              if (cancelled) return;
              api.current = a;
              setState("ready");
              a.getMaterialList((err, mats) => {
                if (err) return;
                const paintName = model.paint;
                paintMats.current = paintName ? mats.filter((m) => paintName.test(m.name)) : [];
                setPaintFound(paintMats.current.length > 0);
              });
            });
          },
          error: () => !cancelled && setState("error"),
        });
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [model]);

  const paint = (i: number) => {
    const a = api.current;
    if (!a) return;
    setColor(i);
    const rgb = hexToLinear(model.colors[i].hex);
    for (const m of paintMats.current) {
      for (const ch of ["AlbedoPBR", "DiffusePBR", "DiffuseColor"]) {
        const c = m.channels[ch];
        if (!c) continue;
        // Paint baked into a color texture would override the tint, so drop it.
        delete c.texture;
        c.color = rgb;
        c.factor = 1;
      }
      a.setMaterial(m);
    }
  };

  /** Orbits the camera around the model's own target, keeping the starting distance and height (Sketchfab is Z-up). */
  const view = (angle: number) => {
    const a = api.current;
    if (!a) return;
    // Capture the framing on first use, after Sketchfab's intro camera move has finished.
    if (!home.current) {
      a.getCameraLookAt((err, cam) => {
        if (err) return;
        home.current = cam;
        view(angle);
      });
      return;
    }
    const h = home.current;
    const [tx, ty] = h.target;
    const dx = h.position[0] - tx;
    const dy = h.position[1] - ty;
    const r = Math.hypot(dx, dy);
    const base = Math.atan2(dy, dx);
    a.setCameraLookAt([tx + r * Math.cos(base + angle), ty + r * Math.sin(base + angle), h.position[2]], h.target, 1.2);
  };

  return (
    <div className="panel overflow-hidden">
      <div className="relative h-[340px] bg-page md:h-[420px]">
        <iframe
          ref={iframe}
          key={model.uid}
          title={`${model.title} 3D model`}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; xr-spatial-tracking"
          allowFullScreen
        />
        {state === "error" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-2">The 3D model could not load. Check your connection and that WebGL is enabled.</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button key={v.label} disabled={state !== "ready"} onClick={() => view(v.angle)} className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40">
              {v.label}
            </button>
          ))}
          <button
            disabled={state !== "ready"}
            onClick={() => {
              home.current = null;
              api.current?.recenterCamera();
            }} className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40">
            Reset view
          </button>
        </div>
        {paintFound && (
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[11px] tracking-wide text-muted uppercase">Paint{color !== null ? ` · ${model.colors[color].name}` : ""}</span>
            {model.colors.map((c, i) => (
              <button
                key={c.name}
                onClick={() => paint(i)}
                title={c.name}
                aria-label={c.name}
                aria-pressed={color === i}
                className={`h-6 w-6 rounded-full border-2 ${color === i ? "border-accent" : "border-line"}`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        )}
        <a href={model.url} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-muted hover:text-ink">
          3D model by {model.author} on Sketchfab
        </a>
      </div>
    </div>
  );
}
