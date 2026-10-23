/**
 * Capability 1 · Lifecycle: the app stops restarting itself after five restarts in a row, on every channel, so a user is
 * never stuck in a restart loop (contract 1.32; the owner's voice note of 2026-10-23, after 1,135 unnoticed restarts).
 * Each restart is a new process, so the count is kept in a file in the app's home. A start that stays up for
 * STABLE_AFTER_MS is a stable one: the restarts before it are no longer in a row, so the count goes back to nought.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** How many restarts in a row the app makes before it stops restarting itself. */
export const RESTARTS_IN_A_ROW = 5;
/** How long a start stays up before it counts as stable: three times an update's ten-minute settle after launch. */
export const STABLE_AFTER_MS = 30 * 60_000;

export interface RestartLimit {
  /** One more restart: counted and true while fewer than the limit have run in a row; false, uncounted, after that. */
  mayRestart(): boolean;
}

/**
 * The restarts in a row kept in `file`, gone back to nought once this start has stayed up `stableAfterMs`. Each refused
 * restart is told to `stopped`, with what to record.
 */
export function restartLimit({ file, limit = RESTARTS_IN_A_ROW, stableAfterMs = STABLE_AFTER_MS, stopped }: {
  file: string;
  limit?: number;
  stableAfterMs?: number;
  stopped?: (message: string) => void;
}): RestartLimit {
  setTimeout(() => write(file, 0), stableAfterMs).unref();
  return {
    mayRestart() {
      const count = read(file);
      if (count >= limit) {
        stopped?.(new RestartsStopped(limit).message);
        return false;
      }
      write(file, count + 1);
      return true;
    },
  };
}

/** What a refused restart rejects with: the app keeps running the build it has. */
export class RestartsStopped extends Error {
  constructor(limit = RESTARTS_IN_A_ROW) {
    super(`storytree stopped restarting itself after ${limit} restarts in a row; it keeps running this build, and restarts again once it has stayed up for ${STABLE_AFTER_MS / 60_000} minutes`);
    this.name = "RestartsStopped";
  }
}

function read(file: string): number {
  try {
    const { inARow } = JSON.parse(readFileSync(file, "utf8")) as { inARow?: unknown };
    return typeof inARow === "number" && Number.isInteger(inARow) && inARow >= 0 ? inARow : 0;
  } catch {
    return 0;
  }
}

function write(file: string, inARow: number): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ inARow })}\n`);
  } catch {
    // A count that cannot be kept never holds a restart back.
  }
}
