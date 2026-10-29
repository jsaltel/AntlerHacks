"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ConnectMode } from "@/lib/obd/connect";
import { useDiagnostics } from "./DiagnosticsProvider";
import { Icon, type IconName } from "./Icons";

type NavItem = { href: string; label: string; icon: IconName };

const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ href: "/", label: "Diagnose", icon: "wrench" }] },
  {
    group: "Vehicle",
    items: [
      { href: "/technician", label: "AI technician", icon: "chat" },
      { href: "/diagnostics", label: "Live data", icon: "activity" },
    ],
  },
];

export const MODE_LABEL: Record<ConnectMode, string> = { simulator: "Demo car", serial: "USB adapter", ble: "Bluetooth LE" };

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

function Logo() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
      <Icon name="gauge" size={18} />
    </span>
  );
}

function StatusDot() {
  const { status, connected } = useDiagnostics();
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${connected ? "bg-good" : status === "connecting" ? "pulse bg-warning" : "bg-muted"}`} />;
}

/**
 * Sidebar content. `expanded` is the phone drawer, which always shows labels;
 * otherwise the sidebar is an icon rail on tablets and full width on desktops.
 */
function Sidebar({ expanded }: { expanded?: boolean }) {
  const path = usePathname();
  const { running, dtcs } = useDiagnostics();
  const codes = dtcs ? dtcs.stored.length + dtcs.pending.length + dtcs.permanent.length : 0;
  const label = expanded ? "" : "hidden lg:block";
  const center = expanded ? "" : "md:justify-center lg:justify-start";
  const badgePos = expanded ? "" : "md:absolute md:top-1 md:right-1.5 lg:static";

  return (
    <>
      <Link href="/" className={`flex h-14 shrink-0 items-center gap-2.5 px-4 ${center}`}>
        <Logo />
        <span className={`${label} text-base font-semibold tracking-tight text-ink`}>Torque</span>
      </Link>
      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Main">
        {NAV.map((g) => (
          <div key={g.group ?? "top"} className="mb-4">
            {g.group && <div className={`${label} px-3 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase`}>{g.group}</div>}
            {g.group && !expanded && <div className="mx-3 mb-2 hidden border-t border-line md:block lg:hidden" />}
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = isActive(path, it.href);
                const badge =
                  it.href === "/technician" && running ? (
                    <span className={`pulse h-2 w-2 rounded-full bg-accent ${badgePos}`} aria-label="working" />
                  ) : it.href === "/diagnostics" && codes > 0 ? (
                    <span className={`tabular rounded-full bg-warning/20 px-1.5 text-[11px] leading-4 text-warning ${badgePos}`} aria-label={`${codes} trouble codes`}>
                      {codes}
                    </span>
                  ) : null;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      title={it.label}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${center} ${active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink"}`}
                    >
                      <Icon name={it.icon} className={active ? "text-accent" : ""} />
                      <span className={`${label} flex-1`}>{it.label}</span>
                      {badge}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <VehicleCard expanded={expanded} />
    </>
  );
}

/** Connection status and connect button, always visible at the bottom of the sidebar. */
function VehicleCard({ expanded }: { expanded?: boolean }) {
  const { status, connected, vehicle, isSim, mode, connError, connect, disconnect } = useDiagnostics();
  const toggle = () => (connected ? disconnect() : connect());
  return (
    <div className="shrink-0 border-t border-line p-3">
      <div className={expanded ? "" : "hidden lg:block"}>
        <div className="flex items-center gap-2 text-sm text-ink">
          <StatusDot />
          {connected ? "Connected" : status === "connecting" ? "Connecting…" : "No vehicle"}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted" title={vehicle?.vin ?? undefined}>
          {connected && vehicle ? `${isSim ? "Demo car" : `VIN ${vehicle.vin ?? "n/a"}`} · ${vehicle.transport}` : `Using: ${MODE_LABEL[mode]}`}
        </div>
        {connError && !connected && <div className="mt-1 line-clamp-2 text-xs text-critical">{connError}</div>}
        <button
          onClick={toggle}
          disabled={status === "connecting"}
          className={`mt-2 w-full rounded-lg px-3 py-1.5 text-sm disabled:opacity-60 ${connected ? "border border-line text-ink-2 hover:bg-surface-2" : "bg-accent font-medium text-white"}`}
        >
          {connected ? "Disconnect" : status === "connecting" ? "Connecting…" : `Connect ${MODE_LABEL[mode].toLowerCase()}`}
        </button>
      </div>
      {!expanded && (
        <button
          onClick={toggle}
          disabled={status === "connecting"}
          title={connected ? "Connected. Click to disconnect." : `Connect ${MODE_LABEL[mode].toLowerCase()}`}
          aria-label={connected ? "Disconnect" : "Connect"}
          className="hidden w-full items-center justify-center rounded-lg py-2 hover:bg-surface-2 md:flex lg:hidden"
        >
          <StatusDot />
        </button>
      )}
    </div>
  );
}

/** App frame: sidebar on tablet and desktop, top bar with a slide-out drawer on phones. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const current = NAV.flatMap((g) => g.items).find((i) => isActive(path, i.href));

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-page/90 px-4 py-2 backdrop-blur md:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open navigation" className="-ml-1 rounded-md p-1.5 text-ink-2 hover:bg-surface-2">
          <Icon name="menu" />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-semibold text-ink">Torque</span>
        </Link>
        {current && current.href !== "/" && <span className="truncate text-sm text-ink-2">/ {current.label}</span>}
        <span className="ml-auto">
          <StatusDot />
        </span>
      </header>

      <aside className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface-1 md:flex md:w-16 lg:w-60">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-surface-1">
            <button onClick={() => setOpen(false)} aria-label="Close navigation" className="absolute top-3 right-3 rounded-md p-1.5 text-ink-2 hover:bg-surface-2">
              <Icon name="close" />
            </button>
            <Sidebar expanded />
          </aside>
        </div>
      )}

      <div className="md:pl-16 lg:pl-60">{children}</div>
    </>
  );
}
