"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDiagnostics } from "@/components/DiagnosticsProvider";

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Get an OBD-II adapter",
    body: (
      <>
        Any ELM327-compatible adapter works: a USB cable adapter or a Bluetooth LE one (for example OBDLink EX or CX). They cost about $20–80. Classic Bluetooth adapters that pair in system settings are not supported by browsers; use USB or Bluetooth LE.{" "}
        <Link href="/adapters" className="text-accent hover:underline">
          Compatible adapters
        </Link>
      </>
    ),
  },
  {
    title: "Plug it into the car",
    body: (
      <>
        Find the OBD-II port under the dashboard on the driver&apos;s side, usually near the steering column (every car sold in the US since 1996 has one). Plug the adapter in and turn the ignition on. Start the engine if you want the AI to run live tests.
      </>
    ),
  },
  {
    title: "Connect it to your laptop",
    body: (
      <>
        Plug the USB adapter into your laptop, or switch the Bluetooth adapter on and keep the laptop within a few feet. Use <span className="text-ink">Chrome or Edge</span>: they are the browsers that can talk to USB and Bluetooth devices.
      </>
    ),
  },
  {
    title: "Press Connect",
    body: (
      <>
        Open Diagnostics, choose <span className="text-ink">USB adapter</span> or <span className="text-ink">Bluetooth LE</span>, press Connect and pick your adapter from the browser&apos;s list. You&apos;ll see the VIN, live gauges and any trouble codes.
      </>
    ),
  },
  {
    title: "Ask the AI technician",
    body: (
      <>
        Describe the problem in plain words (&quot;rough idle when cold&quot;, &quot;check engine light came on&quot;) or press Run full diagnosis. It reads the codes, asks you to rev the engine while it watches the sensors, and writes a repair plan with parts and costs.
      </>
    ),
  },
  {
    title: "Tune and test (optional)",
    body: (
      <>
        Let the AI tuning team build a performance calibration for your engine in the Tuning lab, then drive it in the Simulator under heat, bad fuel and altitude before trusting it.
      </>
    ),
  },
];

const FEATURES = [
  { href: "/diagnostics", title: "Diagnostics", body: "Live gauges, fuel trims, O2 sensors, trouble codes and the raw adapter log." },
  { href: "/technician", title: "AI Technician", body: "Chat with an AI mechanic that reads your car and runs real tests before it answers." },
  { href: "/tune", title: "Tuning lab", body: "Four AI agents plan, calibrate, stress-test and safety-check an ECU tune." },
  { href: "/sim", title: "Simulator", body: "Drive the car in real time with stock or tuned maps, faults and weather." },
];

export default function Home() {
  const router = useRouter();
  const { mode, status, connected, vehicle, support, connect } = useDiagnostics();

  const trySimulator = async () => {
    if (mode === "simulator" && status === "disconnected") await connect();
    router.push(mode === "simulator" ? "/technician" : "/diagnostics");
  };

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-10">
      <section className="mb-10">
        <p className="mb-2 text-xs font-medium tracking-wide text-accent uppercase">Get started</p>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-ink md:text-4xl">Your car&apos;s AI mechanic, tuner and test track, in a browser tab.</h1>
        <p className="mb-6 max-w-[680px] text-base leading-relaxed text-ink-2">
          Plug a cheap OBD-II adapter into your car, connect it to your laptop, and Torque reads the engine, diagnoses problems like a master technician, and lets you build and test performance tunes in a simulator.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/diagnostics" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">
            Connect my car
          </Link>
          <button onClick={trySimulator} disabled={status === "connecting"} className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-surface-2 disabled:opacity-60">
            {status === "connecting" ? "Starting…" : "No car? Try the simulator"}
          </button>
          <span className="flex items-center gap-2 text-xs text-ink-2">
            <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-good" : "bg-muted"}`} />
            {connected && vehicle ? `Connected · VIN ${vehicle.vin ?? "n/a"}` : "Not connected"}
          </span>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-sm font-medium text-ink">Set up in six steps</h2>
        <ol className="grid gap-3 md:grid-cols-2">
          {STEPS.map((s, i) => {
            const done = connected && i < 4;
            return (
              <li key={s.title} className="panel flex gap-4 p-4">
                <span
                  className={`tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-good/20 text-good" : "bg-accent/15 text-accent"}`}
                  aria-label={done ? `Step ${i + 1} done` : `Step ${i + 1}`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <div>
                  <h3 className="mb-1 text-sm font-medium text-ink">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-ink-2">{s.body}</p>
                  {i === 2 && (
                    <p className="mt-2 text-xs text-muted">
                      This browser: USB {support.serial ? <span className="text-good">supported</span> : <span className="text-serious">not supported</span>} · Bluetooth LE{" "}
                      {support.ble ? <span className="text-good">supported</span> : <span className="text-serious">not supported</span>}
                    </p>
                  )}
                  {i === 3 && (
                    <Link href="/diagnostics" className="mt-2 inline-block text-xs text-accent hover:underline">
                      Open Diagnostics →
                    </Link>
                  )}
                  {i === 4 && (
                    <Link href="/technician" className="mt-2 inline-block text-xs text-accent hover:underline">
                      Open AI Technician →
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-sm font-medium text-ink">What&apos;s inside</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <Link key={f.href} href={f.href} className="panel block p-4 hover:border-accent/50">
              <h3 className="mb-1 text-sm font-medium text-ink">{f.title} →</h3>
              <p className="text-xs leading-relaxed text-ink-2">{f.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <p className="text-xs leading-relaxed text-muted">
        Safety: only run live tests while parked, or with a second person driving. Tunes are built and tested in simulation; Torque never changes emissions equipment, and an OBD adapter can read your car but cannot flash ECU maps.
      </p>
    </div>
  );
}
