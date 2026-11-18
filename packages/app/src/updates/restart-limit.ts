// Capability 4 · Updates
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RESTARTS_IN_A_ROW = 5;
export const STABLE_AFTER_MS = 30 * 60_000;

export interface RestartLimit {
  mayRestart(): boolean;
}

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
  }
}
