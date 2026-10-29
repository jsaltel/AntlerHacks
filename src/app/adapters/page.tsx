import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Compatible adapters · Torque",
  description: "ELM327 USB and Bluetooth LE adapters that work with Torque in Chrome or Edge.",
};

type Row = { name: string; notes: string };

const BLE: Row[] = [
  { name: "OBDLink CX", notes: "Best wireless pick. Bluetooth 5.1 LE, STN chip." },
  { name: "Veepeak OBDCheck BLE / BLE+", notes: "Inexpensive ELM327 over BLE." },
  { name: "Vgate iCar Pro BLE (or 2S in BLE/iOS mode)", notes: "Dual-radio units: pick the LE name in Chrome." },
  { name: "vLinker MC+, MS, FD+, BM+ (BLE models)", notes: "Plain MC / FD / BM are Classic Bluetooth and will fail." },
  { name: "LELink", notes: "Small BLE ELM327. Weaker on older Ford/GM J1850 vehicles." },
  { name: "Generic “iOS / BLE 4.0 ELM327” clones", notes: "Often work; quality varies. Must say BLE or iOS, not just Bluetooth." },
];

const USB: Row[] = [
  { name: "OBDLink EX", notes: "USB, STN chip. Best wired option." },
  { name: "OBDLink SX / ScanTool.net USB", notes: "USB ELM/STN." },
  { name: "vLinker FS (USB)", notes: "Wired ELM327." },
  { name: "Generic USB ELM327 cable", notes: "" },
];

const INCOMPATIBLE: Row[] = [
  { name: "OBDLink MX+, LX, MX", notes: "Bluetooth 3.0 Classic. Chrome cannot open Classic SPP." },
  { name: "BlueDriver", notes: "Proprietary protocol. Works only in the BlueDriver app." },
  { name: "FIXD", notes: "App-locked, not ELM327." },
  { name: "Cheap Amazon “Bluetooth OBDII” (BAFX and similar)", notes: "Almost always Classic SPP." },
  { name: "Wi-Fi ELM327", notes: "Torque has no Wi-Fi transport." },
  { name: "Autel / Innova / Bosch standalone scanners", notes: "Not ELM327 serial devices." },
];

export default function Adapters() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <PageHeader title="Compatible adapters" description="Any ELM327 adapter over USB or Bluetooth LE, in Chrome or Edge." />

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-1 text-sm font-medium text-ink">If you want wireless</h2>
          <p className="text-sm text-ink-2">
            Buy an <span className="text-ink">OBDLink CX</span>.
          </p>
        </div>
        <div className="panel p-4">
          <h2 className="mb-1 text-sm font-medium text-ink">If you want a cable</h2>
          <p className="text-sm text-ink-2">
            Buy an <span className="text-ink">OBDLink EX</span>.
          </p>
        </div>
      </div>

      <Section title="Bluetooth LE" >
        <AdapterTable rows={BLE} />
      </Section>
      <Section title="USB" >
        <AdapterTable rows={USB} />
      </Section>
      <Section title="Will not work">
        <AdapterTable rows={INCOMPATIBLE} incompatible />
      </Section>

      <p className="text-xs text-muted">
        No adapter?{" "}
        <Link href="/" className="text-accent hover:underline">
          Use the demo car
        </Link>
        .
      </p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function AdapterTable({ rows, incompatible }: { rows: Row[]; incompatible?: boolean }) {
  return (
    <div className="panel overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="px-4 py-2.5 font-medium">Adapter</th>
            <th className="px-4 py-2.5 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-line last:border-0">
              <th scope="row" className={`px-4 py-3 font-medium ${incompatible ? "text-serious" : "text-ink"}`}>
                {r.name}
              </th>
              <td className="px-4 py-3 text-ink-2">{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
