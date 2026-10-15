/**
 * Capability 3 · Hooks: how long each hook took (ADR-1056 D1), measured before the seam it runs through is changed.
 * Each hook process keeps a clock: its total from the process's start to its exit, and its main parts (start-up, to
 * the end of its stdin; connect, reaching the library and opening the log; write, everything it writes there; hand-off,
 * starting a copy of itself). At exit, whichever way it exits, it appends one reading to a file in the storytree home:
 * one synchronous append and nothing read but its own clock, so the hook it measures is not slowed. The look around the
 * machine uploads what waited there to the log as hook-times lines, in batches. Readings are a machine's cost, so they
 * go to the log of whichever project's look takes them, with no folder or project of their own. A reading, never a gate
 * (decision_fbe2cec9f404).
 */
import { appendFileSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NewLine } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";

/** The flag a hook's copy is started with, so a handed-on hook is read apart from the one the harness waits for. */
export const HANDED = "--handed";
/** Where a machine's readings wait, in its storytree home. */
export const HOOK_TIMES_FILE = "hook-times.jsonl";
/** Past this size the file takes no more readings until the next upload empties it. */
const MOST_BYTES = 1_000_000;
/** The most readings one line carries. */
const PER_LINE = 500;

/** A hook's main parts. */
export type HookPart = "startup" | "connect" | "write" | "handoff";

/** One hook's reading: when it started, its harness and event (with its flags), its total and parts, in ms. */
export type HookReading = Extract<NewLine, { kind: "hook-times" }>["readings"][number];

/** One hook process's clock. performance.now() counts from the process's start. */
export class HookClock {
  readonly #parts = new Map<HookPart, number>();
  /** The event the hook's input names, once it is read. */
  event: string | undefined;

  /** Add `ms` to `part`. */
  add(part: HookPart, ms: number): void {
    this.#parts.set(part, (this.#parts.get(part) ?? 0) + ms);
  }

  /** The time added to `part` so far. */
  spent(part: HookPart): number {
    return this.#parts.get(part) ?? 0;
  }

  /** `work`, with the time it takes added to `part`. */
  async time<T>(part: HookPart, work: () => Promise<T>): Promise<T> {
    const from = performance.now();
    try {
      return await work();
    } finally {
      this.add(part, performance.now() - from);
    }
  }

  /** The reading as of now, for a hook run for `harness` with `flags`. */
  reading(harness: string, flags: readonly string[]): HookReading {
    const total = performance.now();
    const event = [this.event ?? "unknown", ...flags.filter((flag) => !flag.startsWith("--event="))].join(" ");
    return { at: new Date(performance.timeOrigin).toISOString(), harness: harness || "unknown", event, total: tenths(total), parts: Object.fromEntries([...this.#parts].map(([part, ms]) => [part, tenths(ms)])) };
  }
}

function tenths(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** Append `reading` to the readings waiting in `home`, unless the file is past its size. Never throws. */
export function recordHookTime(home: string, reading: HookReading): void {
  const file = path.join(home, HOOK_TIMES_FILE);
  try {
    if (statSync(file).size > MOST_BYTES) return;
  } catch {
    // No readings wait yet.
  }
  try {
    appendFileSync(file, `${JSON.stringify(reading)}\n`);
  } catch {
    // A reading is never worth a hook's failure.
  }
}

/** How long an upload may hold readings it moved aside before another takes them over: longer than the look may run. */
const ABANDONED_MS = 10 * 60_000;

/**
 * Upload the readings waiting in `home` to `project`'s log, on `by`'s session: the file is moved aside first, so a hook
 * that exits meanwhile starts a new one, and two uploads never take the same readings. Readings an upload moved aside
 * and left (it failed, or was cut off) are taken over once it cannot still be running. Never throws.
 */
export async function uploadHookTimes(home: string, log: Pick<ActivityLog, "append">, project: string, by: { session: string; harness?: string }, now = Date.now()): Promise<void> {
  const taken = (n: number) => path.join(home, `hook-times.${process.pid}.${now}.${n}.taking`);
  const mine: string[] = [];
  const take = (from: string) => {
    try {
      renameSync(from, taken(mine.length));
      mine.push(taken(mine.length));
    } catch {
      // None wait there, or another upload took them first.
    }
  };
  take(path.join(home, HOOK_TIMES_FILE));
  try {
    for (const name of readdirSync(home)) {
      const left = /^hook-times\.\d+\.(\d+)\.\d+\.taking$/.exec(name);
      if (left !== null && Number(left[1]) < now - ABANDONED_MS) take(path.join(home, name));
    }
  } catch {
    // The home cannot be read: what this upload took still goes.
  }
  for (const file of mine) {
    try {
      const readings = readFileSync(file, "utf8").split("\n").flatMap((line) => {
        try {
          return line === "" ? [] : [JSON.parse(line) as HookReading];
        } catch {
          return [];
        }
      });
      for (let from = 0; from < readings.length; from += PER_LINE) {
        await log.append(project, { session: by.session, ...(by.harness === undefined ? {} : { harness: by.harness }), source: "hook", kind: "hook-times", readings: readings.slice(from, from + PER_LINE) });
        // What is uploaded leaves the file, so a failure later uploads only what it did not take.
        writeFileSync(file, readings.slice(from + PER_LINE).map((reading) => `${JSON.stringify(reading)}\n`).join(""));
      }
      unlinkSync(file);
    } catch {
      // Left for a later upload to take over.
    }
  }
}
