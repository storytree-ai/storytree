// Capability 1 · Lifecycle
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export interface SmokePhases {
  phase(name: string): void;
  gaveUp(afterMs: number): string;
}

export function smokePhases({ log, now = Date.now }: { log: (line: string) => void; now?: () => number }): SmokePhases {
  const started = now();
  let current: string | undefined;
  return {
    phase(name) {
      current = name;
      log(`smoke: ${name} (${((now() - started) / 1000).toFixed(1)} s)`);
    },
    gaveUp(afterMs) {
      return `smoke: gave up after ${Math.round(afterMs / 1000)} s, ${current === undefined ? "before its first phase" : `stuck ${current}`}`;
    },
  };
}

export interface SmokeElectronFiles {
  readonly dir: string;
  readonly line: string;
  remove(): void;
}

const PREFIX = "storytree-smoke-";
const LEFTOVER_MS = 10 * 60_000;

export function smokeElectronFiles({ shared, tmp, now = Date.now }: { shared: string; tmp: string; now?: () => number }): SmokeElectronFiles {
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith(PREFIX)) continue;
    const old = path.join(tmp, name);
    try {
      if (now() - statSync(old).mtimeMs > LEFTOVER_MS) rmSync(old, { recursive: true, force: true });
    } catch {
    }
  }
  const dir = mkdtempSync(path.join(tmp, PREFIX));
  return {
    dir,
    line: `smoke: Electron's files in ${dir}, apart from ${shared}, which an open app may hold`,
    remove() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
      }
    },
  };
}
