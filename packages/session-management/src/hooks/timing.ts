// Capability 3 · Hooks
import { appendFileSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NewLine } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";

export { HANDED } from "./at-once.js";
export const HOOK_TIMES_FILE = "hook-times.jsonl";
const MOST_BYTES = 1_000_000;
const PER_LINE = 500;

export type HookPart = "startup" | "connect" | "write" | "handoff";

export type HookReading = Extract<NewLine, { kind: "hook-times" }>["readings"][number];

export class HookClock {
  readonly #parts = new Map<HookPart, number>();
  event: string | undefined;

  add(part: HookPart, ms: number): void {
    this.#parts.set(part, (this.#parts.get(part) ?? 0) + ms);
  }

  spent(part: HookPart): number {
    return this.#parts.get(part) ?? 0;
  }

  async time<T>(part: HookPart, work: () => Promise<T>): Promise<T> {
    const from = performance.now();
    try {
      return await work();
    } finally {
      this.add(part, performance.now() - from);
    }
  }

  reading(harness: string, flags: readonly string[]): HookReading {
    const total = performance.now();
    const event = [this.event ?? "unknown", ...flags.filter((flag) => !flag.startsWith("--event="))].join(" ");
    return { at: new Date(performance.timeOrigin).toISOString(), harness: harness || "unknown", event, total: tenths(total), parts: Object.fromEntries([...this.#parts].map(([part, ms]) => [part, tenths(ms)])) };
  }
}

function tenths(ms: number): number {
  return Math.round(ms * 10) / 10;
}

export function recordHookTime(home: string, reading: HookReading): void {
  const file = path.join(home, HOOK_TIMES_FILE);
  try {
    if (statSync(file).size > MOST_BYTES) return;
  } catch {
  }
  try {
    appendFileSync(file, `${JSON.stringify(reading)}\n`);
  } catch {
  }
}

const ABANDONED_MS = 10 * 60_000;

export async function uploadHookTimes(home: string, log: Pick<ActivityLog, "append">, project: string, by: { session: string; harness?: string }, now = Date.now()): Promise<void> {
  const taken = (n: number) => path.join(home, `hook-times.${process.pid}.${now}.${n}.taking`);
  const mine: string[] = [];
  const take = (from: string) => {
    try {
      renameSync(from, taken(mine.length));
      mine.push(taken(mine.length));
    } catch {
    }
  };
  take(path.join(home, HOOK_TIMES_FILE));
  try {
    for (const name of readdirSync(home)) {
      const left = /^hook-times\.\d+\.(\d+)\.\d+\.taking$/.exec(name);
      if (left !== null && Number(left[1]) < now - ABANDONED_MS) take(path.join(home, name));
    }
  } catch {
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
        writeFileSync(file, readings.slice(from + PER_LINE).map((reading) => `${JSON.stringify(reading)}\n`).join(""));
      }
      unlinkSync(file);
    } catch {
    }
  }
}
