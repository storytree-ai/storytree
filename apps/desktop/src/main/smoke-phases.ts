/**
 * Capability 1 · Lifecycle. The smoke check says where it is (contract 1.36): a `--smoke` run prints a `smoke:` line as each
 * phase starts, with the seconds since launch, so a run that never reaches its page shows the last phase it began, and its
 * give-up line names that phase. It keeps Electron's own files in a scratch folder of its own, removed when it exits: an
 * app already open on this computer holds the app's Electron folder, and a smoke run sharing it stalled with no word.
 * Chromium's network process can still write its cache after the app exits, so each run also sweeps the scratch folders of
 * runs that ended long ago: older than any run lasts, which gives up after three minutes.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export interface SmokePhases {
  /** Print that `name` has begun. */
  phase(name: string): void;
  /** The line to print on giving up after `afterMs`, naming the phase it was stuck in. */
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
  /** The scratch folder Electron's files go in for this run. */
  readonly dir: string;
  /** The line saying where they are, and which folder they are kept apart from. */
  readonly line: string;
  /** Remove the scratch folder; harmless when already gone or still held. */
  remove(): void;
}

const PREFIX = "storytree-smoke-";
/** How old a scratch folder is before a later run takes it for a finished run's leftovers. */
const LEFTOVER_MS = 10 * 60_000;

/** A scratch folder in `tmp` for a smoke run's Electron files, apart from the app's own `shared` folder. */
export function smokeElectronFiles({ shared, tmp, now = Date.now }: { shared: string; tmp: string; now?: () => number }): SmokeElectronFiles {
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith(PREFIX)) continue;
    const old = path.join(tmp, name);
    try {
      if (now() - statSync(old).mtimeMs > LEFTOVER_MS) rmSync(old, { recursive: true, force: true });
    } catch {
      // Gone already, or not ours to remove.
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
        // A file Chromium still holds as the process ends is left for the system's temp cleanup.
      }
    },
  };
}
