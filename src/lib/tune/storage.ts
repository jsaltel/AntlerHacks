import type { TunePackage } from "./workbench";

const KEY = "torque.tunes.v1";

/** Saved tune packages live in this browser so the simulator page can load them. */
export function loadTunes(): TunePackage[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TunePackage[]) : [];
  } catch {
    return [];
  }
}

export function saveTune(pkg: TunePackage): boolean {
  try {
    const rest = loadTunes().filter((t) => t.checksum !== pkg.checksum);
    localStorage.setItem(KEY, JSON.stringify([pkg, ...rest].slice(0, 20)));
    return true;
  } catch {
    return false;
  }
}

export function deleteTune(checksum: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadTunes().filter((t) => t.checksum !== checksum)));
  } catch {}
}

export function downloadTune(pkg: TunePackage) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${pkg.engine_id}-${pkg.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${pkg.checksum}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
