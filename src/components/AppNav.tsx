"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/diagnostics", label: "Diagnostics" },
  { href: "/technician", label: "AI Technician" },
  { href: "/tune", label: "Tuning" },
  { href: "/sim", label: "Simulator" },
  { href: "/adapters", label: "Adapters" },
];

export function AppNav() {
  const path = usePathname();
  return (
    <nav className="border-b border-line bg-surface-1/60">
      <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-2.5">
        <Link href="/" className="text-base font-semibold tracking-tight text-ink">
          Torque
        </Link>
        <div className="flex gap-1 text-sm">
          {TABS.map((t) => {
            const active = path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1 ${active ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
