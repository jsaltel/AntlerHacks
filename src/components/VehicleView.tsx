"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { describeVehicle, type DecodedVehicle } from "@/lib/vehicle/vin";
import type { MonitorSample } from "@/lib/agent/executor";
import { useDiagnostics } from "./DiagnosticsProvider";
import { faultZones, ZONE_LABELS, type Zone, type ZoneFault } from "@/lib/vehicle/zones";
import { lookupDtc } from "@/lib/kb/dtcs";

type Body = "sedan" | "coupe" | "pickup" | "suv" | "hatchback";

const PAINTS = ["#b3261e", "#1f4e9c", "#c9ccd1", "#2b2d31", "#f2f2ee", "#5a6b4e", "#7a1f2b", "#3d6f8f"];
const PORSCHE_URL = "/models/porsche-911-gt3-rs.glb";
const STORED_COLOR = "#ff3b30";
const PENDING_COLOR = "#fab219";

type Anchors = Record<Zone, [number, number, number]>;

/** Zone positions on the GT3 RS (rear engine, front radiators and tank), in metres on the fitted 4.6 m model. */
const PORSCHE_ANCHORS: Anchors = {
  engine: [0, 0.75, -1.55],
  intake: [0, 1.0, -1.3],
  exhaust: [0, 0.35, -2.1],
  cooling: [0, 0.45, 2.05],
  fuel_tank: [0, 0.5, 1.35],
  transmission: [0, 0.45, -0.75],
  battery: [0.35, 0.6, 1.65],
  electronics: [0, 0.9, 0.45],
  chassis: [0.75, 0.35, 1.25],
};

const PICKUP_MODELS = ["f-150", "silverado", "ram", "tacoma", "tundra", "sierra", "ranger", "colorado"];

function bodyFor(d: DecodedVehicle | null): Body {
  const bc = (d?.bodyClass ?? "").toLowerCase();
  const model = (d?.model ?? "").toLowerCase();
  if (bc.includes("pickup") || PICKUP_MODELS.some((m) => model.includes(m))) return "pickup";
  if (bc.includes("sport utility") || bc.includes("suv") || bc.includes("wagon") || bc.includes("van")) return "suv";
  if (bc.includes("hatchback")) return "hatchback";
  if (bc.includes("coupe") || bc.includes("convertible")) return "coupe";
  return "sedan";
}

/** Same VIN, same paint. */
const paintFor = (vin: string | null) => PAINTS[[...(vin ?? "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0x7fffffff, 7) % PAINTS.length];

/** Real model for the vehicle, if we have one: the GT3 RS for Porsches and as the showroom car. */
const modelUrlFor = (d: DecodedVehicle | null) => (!d || d.make?.toLowerCase() === "porsche" ? PORSCHE_URL : null);

let gltfCache: Promise<THREE.Group> | null = null;
function loadPorsche(): Promise<THREE.Group> {
  if (!gltfCache) {
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    const loader = new GLTFLoader().setDRACOLoader(draco);
    gltfCache = loader.loadAsync(PORSCHE_URL).then((g) => g.scene);
    gltfCache.catch(() => (gltfCache = null));
  }
  return gltfCache;
}

/** Standard deviation of RPM over the last few seconds: how rough the engine is running. */
function rpmSpread(history: MonitorSample[], windowMs = 3000): number {
  if (!history.length) return 0;
  const cutoff = history[history.length - 1].t - windowMs;
  const xs: number[] = [];
  for (let i = history.length - 1; i >= 0 && history[i].t >= cutoff; i--) {
    const v = history[i].values.rpm;
    if (v != null) xs.push(v);
  }
  if (xs.length < 4) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length);
}

interface Props {
  decoded: DecodedVehicle | null;
  vin: string | null;
  connected: boolean;
  live: Record<string, number | null>;
  history: MonitorSample[];
  checkEngine: boolean;
  /** Trouble codes to highlight on the car, by area. */
  dtcs: { stored: string[]; pending: string[]; permanent: string[] } | null;
}

/**
 * 3D view of the connected car. Builds a stylized low-poly body (sedan, coupe,
 * pickup, SUV or hatchback, from the VIN decode's body class) and animates it
 * from live data: the wheels turn with road speed and the body shakes with
 * engine roughness, so a misfire is visible at idle. Porsches, and the
 * showroom view before anything is connected, use a real GT3 RS model.
 */
export function VehicleView({ decoded, vin, connected, live, history, checkEngine, dtcs }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef({ speed: 0, rpm: 0, roughness: 0 });
  const stageRef = useRef<{ show: (d: DecodedVehicle | null, vin: string | null) => void; setFaults: (f: ZoneFault[]) => void } | null>(null);
  const [loading, setLoading] = useState(false);

  liveRef.current = connected
    ? { speed: live.speed ?? 0, rpm: live.rpm ?? 0, roughness: rpmSpread(history) }
    : { speed: 0, rpm: 0, roughness: 0 };

  // One renderer and scene for the component's lifetime; the car inside is rebuilt per vehicle.
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.6;

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
    camera.position.set(0, 2.1, 8.6);
    camera.lookAt(0, 0.62, 0);

    scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x202020, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cc3ff, 1.1);
    rim.position.set(4, 3, -6);
    scene.add(rim);

    // Floor disc so the car sits on something.
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.02, 64), new THREE.MeshStandardMaterial({ color: 0x262624, roughness: 0.9 }));
    floor.position.y = -0.01;
    scene.add(floor);

    const car = new THREE.Group();
    scene.add(car);
    let chassis = new THREE.Group();
    let wheels: THREE.Object3D[] = [];
    let wheelAngle = 0;
    let anchors: Anchors | null = null;
    let faults: ZoneFault[] = [];
    const markers = new THREE.Group();
    const halos: THREE.Mesh[] = [];
    let yaw = -0.55;
    let dragYaw = 0;
    let idle = 0;
    let dragging = false;
    let lastX = 0;
    let token = 0;
    const disposables: { dispose(): void }[] = [];

    const clearCar = () => {
      car.clear();
      for (const d of disposables.splice(0)) d.dispose();
      chassis = new THREE.Group();
      car.add(chassis);
      wheels = [];
      anchors = null;
      car.scale.setScalar(1);
    };

    const mat = (color: string, roughness: number, metalness = 0, emissive?: string) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: emissive ?? 0x000000, emissiveIntensity: emissive ? 1.4 : 0 });
      disposables.push(m);
      return m;
    };
    const box = (parent: THREE.Object3D, pos: [number, number, number], size: [number, number, number], m: THREE.Material, rotX = 0) => {
      const g = new THREE.BoxGeometry(...size);
      disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(...pos);
      mesh.rotation.x = rotX;
      parent.add(mesh);
      return mesh;
    };
    const disc = (parent: THREE.Object3D, x: number, radius: number, width: number, m: THREE.Material) => {
      const g = new THREE.CylinderGeometry(radius, radius, width, 28);
      g.rotateZ(Math.PI / 2);
      disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.x = x;
      parent.add(mesh);
    };

    const build = (body: Body, paintColor: string) => {
      const paint = mat(paintColor, 0.28, 0.35);
      const glass = mat("#141a22", 0.08, 0.2);
      const trim = mat("#151515", 0.7);
      const tire = mat("#111111", 0.85);
      const rimM = mat("#b9bcc2", 0.25, 0.8);
      const head = mat("#ffffff", 0.3, 0, "#fff3d6");
      const tail = mat("#c3191f", 0.4, 0, "#ff2a2a");

      // Dimensions in metres: length, width, ride height, body height, wheel size.
      let [len, wid, ride, bodyH, wheelD] = [4.7, 1.82, 0.32, 0.62, 0.68];
      if (body === "pickup") [len, wid, ride, bodyH, wheelD] = [5.8, 2.0, 0.5, 0.78, 0.82];
      if (body === "suv") [len, wid, ride, bodyH, wheelD] = [4.8, 1.85, 0.42, 0.66, 0.74];
      if (body === "coupe") [len, ride, bodyH] = [4.75, 0.3, 0.58];
      if (body === "hatchback") [len, wid] = [4.3, 1.78];
      const t = chassis;
      const top = ride + bodyH;

      // Lower body with slightly narrower bumpers for a less boxy silhouette.
      box(t, [0, ride + bodyH / 2, 0], [wid, bodyH, len * 0.86], paint);
      for (const s of [1, -1]) {
        box(t, [0, ride + bodyH * 0.42, s * len * 0.455], [wid * 0.96, bodyH * 0.8, len * 0.07], paint);
        box(t, [0, ride + 0.08, s * len * 0.49], [wid * 0.9, 0.16, 0.06], trim);
      }

      // Cabin: z centre, length, height.
      const [cz, cl, ch] =
        body === "pickup" ? [-len * 0.08, len * 0.36, 0.72]
        : body === "suv" ? [len * 0.06, len * 0.66, 0.74]
        : body === "coupe" ? [len * 0.06, len * 0.4, 0.5]
        : body === "hatchback" ? [len * 0.1, len * 0.56, 0.62]
        : [len * 0.04, len * 0.46, 0.58];
      box(t, [0, top + ch / 2, cz], [wid * 0.86, ch, cl], paint);
      // Glass band around the cabin, roof on top.
      box(t, [0, top + ch * 0.48, cz], [wid * 0.87, ch * 0.62, cl * 0.94], glass);
      box(t, [0, top + ch * 0.48, cz], [wid * 0.8, ch * 0.62, cl * 1.01], glass);
      box(t, [0, top + ch - 0.03, cz], [wid * 0.84, 0.06, cl * 0.96], paint);
      // Sloped windscreen and rear screen for sedans and coupes.
      if (body === "sedan" || body === "coupe") {
        const slope = Math.atan2(ch, cl * 0.35);
        const plate = ch / Math.sin(slope);
        box(t, [0, top + ch * 0.45, cz + cl / 2 + cl * 0.12], [wid * 0.84, 0.04, plate], glass, slope);
        box(t, [0, top + ch * 0.45, cz - cl / 2 - cl * 0.12], [wid * 0.84, 0.04, plate], glass, -slope);
      }
      if (body === "pickup") {
        // Open bed: floor plus three walls behind the cab.
        const bedZ = len * 0.25;
        const bedL = len * 0.4;
        box(t, [0, top + 0.01, -bedZ], [wid * 0.9, 0.02, bedL], trim);
        box(t, [wid * 0.47, top + 0.2, -bedZ], [0.06, 0.4, bedL], paint);
        box(t, [-wid * 0.47, top + 0.2, -bedZ], [0.06, 0.4, bedL], paint);
        box(t, [0, top + 0.2, -bedZ - bedL / 2], [wid * 0.94, 0.4, 0.06], paint);
      }
      if (body === "suv") for (const s of [-1, 1]) box(t, [s * wid * 0.32, top + ch + 0.04, cz], [0.05, 0.05, cl * 0.8], trim);

      // Lights and grille.
      for (const s of [-1, 1]) {
        box(t, [s * wid * 0.36, ride + bodyH * 0.68, len * 0.492], [wid * 0.2, 0.1, 0.04], head);
        box(t, [s * wid * 0.38, ride + bodyH * 0.7, -len * 0.492], [wid * 0.18, 0.1, 0.04], tail);
      }
      box(t, [0, ride + bodyH * 0.55, len * 0.492], [wid * 0.4, bodyH * 0.3, 0.03], trim);

      // Wheels sit outside the chassis so the body can shake on its suspension.
      const axle = len * (body === "pickup" ? 0.33 : 0.31);
      for (const z of [axle, -axle])
        for (const s of [-1, 1]) {
          const hub = new THREE.Group();
          hub.position.set(s * wid * 0.47, wheelD / 2, z);
          disc(hub, 0, wheelD / 2, 0.24, tire);
          disc(hub, s * 0.07, wheelD * 0.3, 0.04, rimM);
          // Spoke so rotation is visible.
          box(hub, [s * 0.1, 0, 0], [0.02, wheelD * 0.55, 0.07], trim);
          car.add(hub);
          wheels.push(hub);
          // Wheel arch shadow.
          box(t, [s * wid * 0.5, wheelD * 0.62, z], [0.02, wheelD * 0.5, wheelD * 1.15], trim);
        }

      anchors = {
        engine: [0, ride + bodyH * 0.6, len * 0.34],
        intake: [-wid * 0.18, top - 0.02, len * 0.27],
        exhaust: [0, Math.max(0.16, ride * 0.55), len * 0.06],
        cooling: [0, ride + bodyH * 0.5, len * 0.46],
        fuel_tank: [wid * 0.22, ride + 0.12, -len * 0.28],
        transmission: [0, ride + 0.12, len * 0.17],
        battery: [wid * 0.3, top - 0.08, len * 0.39],
        electronics: [0, top + 0.12, cz + cl * 0.42],
        chassis: [wid * 0.47, wheelD / 2, axle],
      };

      // Fit long vehicles in frame.
      car.scale.setScalar(4.7 / Math.max(4.7, len));
    };

    /** Scales an imported model to ~4.6 m long, centres it on the floor and pivots its wheels about their axles. */
    const fitImported = (model: THREE.Object3D) => {
      // Measure with the car unrotated; the animation loop restores yaw and shake next frame.
      car.rotation.y = 0;
      chassis.position.set(0, 0, 0);
      chassis.rotation.set(0, 0, 0);
      chassis.add(model);
      car.updateMatrixWorld(true);
      let bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      model.scale.multiplyScalar(4.6 / Math.max(0.01, size.x, size.z));
      bounds = new THREE.Box3().setFromObject(model);
      const c = bounds.getCenter(new THREE.Vector3());
      model.position.sub(new THREE.Vector3(c.x, bounds.min.y, c.z));
      car.updateMatrixWorld(true);
      const nodes: THREE.Object3D[] = [];
      model.traverse((o) => {
        if (/^wheel/i.test(o.name)) nodes.push(o);
        // Swap physical glass transmission (an extra render pass every frame) for plain transparency.
        const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
        if (m?.transmission) {
          m.transmission = 0;
          m.transparent = true;
          m.opacity = 0.35;
        }
      });
      for (const node of nodes) {
        const centre = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
        const pivot = new THREE.Group();
        pivot.position.copy(car.worldToLocal(centre.clone()));
        car.add(pivot);
        pivot.attach(node);
        wheels.push(pivot);
      }
    };

    const show = (d: DecodedVehicle | null, v: string | null) => {
      const my = ++token;
      clearCar();
      const url = modelUrlFor(d);
      if (!url) {
        build(bodyFor(d), paintFor(v));
        drawFaults();
        setLoading(false);
        return;
      }
      setLoading(true);
      loadPorsche()
        .then((scene) => {
          if (my !== token) return;
          fitImported(scene.clone(true));
          anchors = PORSCHE_ANCHORS;
          drawFaults();
        })
        .catch(() => {
          if (my !== token) return;
          build("coupe", paintFor(v));
          drawFaults();
        })
        .finally(() => my === token && setLoading(false));
    };
    /**
     * A glowing marker per faulty area, drawn on top of the body so it reads
     * like an x-ray: red for stored codes, amber for pending only.
     */
    const drawFaults = () => {
      for (const m of markers.children) {
        const mesh = m as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      markers.clear();
      halos.length = 0;
      car.add(markers);
      if (!anchors) return;
      for (const f of faults) {
        const [x, y, z] = anchors[f.zone];
        const color = f.stored ? STORED_COLOR : PENDING_COLOR;
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
        const halo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.3, depthWrite: false }));
        for (const m of [core, halo]) {
          m.position.set(x, y, z);
          m.renderOrder = 10;
          markers.add(m);
        }
        halo.userData.phase = halos.length * 1.3;
        halos.push(halo);
      }
    };
    const setFaults = (f: ZoneFault[]) => {
      faults = f;
      drawFaults();
    };
    stageRef.current = { show, setFaults };

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    const el = renderer.domElement;
    el.style.touchAction = "pan-y";
    el.style.cursor = "grab";
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      dragYaw += (e.clientX - lastX) * 0.01;
      lastX = e.clientX;
      idle = 0;
    };
    const up = () => (dragging = false);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      const time = clock.elapsedTime;
      const { speed, rpm, roughness } = liveRef.current;
      idle += dt;
      if (!dragging && idle > 2.5) yaw += dt * 0.21;
      car.rotation.y = yaw + dragYaw;

      // Wheel radius ~0.34 m: angular speed = v / r.
      wheelAngle += (speed / 3.6 / 0.34) * dt;
      for (const w of wheels) w.rotation.x = wheelAngle;

      // Engine vibration: a faint hum with rpm, plus a jolt proportional to rough running.
      const hum = rpm > 300 ? 0.0025 + (rpm / 7000) * 0.004 : 0;
      const rough = Math.min(1, Math.max(0, roughness / 60)) * 0.03;
      const noise = (a: number) => Math.sin(a) * 0.6 + Math.sin(a * 2.3 + 1.7) * 0.4;
      chassis.position.y = Math.sin(time * (rpm / 60) * 0.5) * hum + noise(time * 29) * rough;
      chassis.rotation.z = noise(time * 25 + 4) * rough * 0.5;

      for (const h of halos) {
        const p = 0.5 + 0.5 * Math.sin(time * 4 + h.userData.phase);
        h.scale.setScalar(0.8 + 0.5 * p);
        (h.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.3 * (1 - p);
      }

      renderer.render(scene, camera);
    });

    return () => {
      token++;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      clearCar();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.remove();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    stageRef.current?.show(connected ? decoded : null, connected ? vin : null);
  }, [connected, decoded, vin]);

  const zones = useMemo(() => (connected ? faultZones(dtcs) : []), [connected, dtcs]);
  useEffect(() => {
    stageRef.current?.setFaults(zones);
  }, [zones]);

  const name = describeVehicle(decoded);
  const caption = !connected
    ? "Showroom: Porsche 911 GT3 RS. Connect to see your car."
    : [name, decoded?.engine, decoded?.bodyClass].filter(Boolean).join(" · ") || (vin ? `VIN ${vin}` : "Vehicle did not report a VIN.");

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-ink">Vehicle</h2>
        {loading && <span className="text-[11px] text-muted">Loading model…</span>}
        {connected && checkEngine && (
          <span className="ml-auto rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-warning">CHECK ENGINE</span>
        )}
      </div>
      <div ref={mountRef} className="mt-2 h-[220px] w-full overflow-hidden rounded-lg" aria-label={caption} role="img" />
      <p className="mt-1.5 text-xs text-muted">{caption}</p>
      {zones.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {zones.map((z) => (
            <li key={z.zone} className="flex items-start gap-2 text-xs">
              <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: z.stored ? STORED_COLOR : PENDING_COLOR }} />
              <span className="text-ink">{ZONE_LABELS[z.zone]}</span>
              <span className="text-muted">
                {z.codes.map((c) => `${c} ${lookupDtc(c).title}`).join(", ")}
                {!z.stored && " (pending)"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The vehicle panel wired to the shared adapter connection. */
export function ConnectedVehicleView() {
  const { decoded, vehicle, connected, live, history, dtcs } = useDiagnostics();
  return <VehicleView decoded={decoded} vin={vehicle?.vin ?? null} connected={connected} live={live} history={history} checkEngine={!!dtcs?.stored.length} dtcs={dtcs} />;
}
