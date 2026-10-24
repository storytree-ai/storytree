/**
 * Capability 3 · Hooks: how long a hook's Git or storytree step may take on this machine, learned from how long it
 * took here lately (ADR-1163 D2, the idea of ADR-1152's learned per-test limits). A fixed limit tripped falsely on slow
 * Windows machines, and a hook that gives up says nothing: the edit gate then lets an edit through unchecked.
 *
 * Each step keeps its last few times in one small file in the home it is given. Its limit is three times its slowest
 * recent time, never below the floor (the fixed limit it had before) and never above its ceiling, which keeps the hook
 * inside the harness's own limit on it. Too few times, as on a new machine, give the floor. A step that gave up is kept
 * as having taken its whole limit, so a machine that always gives up still widens its limit, up to the ceiling. Reading
 * and writing never throw: a file that cannot be read gives the floor, one that cannot be written learns nothing.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One step's name, its floor and its ceiling, in ms. */
export interface Step {
  readonly name: string;
  readonly floorMs: number;
  readonly ceilingMs: number;
}

/** The file in a home that keeps each step's recent times. */
export const LEARNED_FILE = "learned-limits.json";
/** How many recent times a step keeps. */
const KEPT = 10;
/** The fewest times a step's limit is learned from; fewer give its floor. */
const LEAST = 3;
/** The limit, as a multiple of the slowest recent time. */
const MULTIPLE = 3;

/** How long `step` may take on this machine, as learned in `home`. */
export function limitOf(home: string, step: Step): number {
  const times = read(home)[step.name] ?? [];
  if (times.length < LEAST) return step.floorMs;
  return Math.min(step.ceilingMs, Math.max(step.floorMs, Math.ceil(MULTIPLE * Math.max(...times))));
}

/** Keep in `home` that `step` took `tookMs`; one that gave up at its limit is given that limit. */
export function learn(home: string, step: Step, tookMs: number): void {
  if (!Number.isFinite(tookMs) || tookMs < 0) return;
  try {
    const learned = read(home);
    learned[step.name] = [...(learned[step.name] ?? []), Math.round(tookMs)].slice(-KEPT);
    const file = path.join(home, LEARNED_FILE);
    mkdirSync(home, { recursive: true });
    // Hooks run side by side: each writes whole, so a reader never sees half a file; one may lose another's time.
    writeFileSync(`${file}.${process.pid}.part`, JSON.stringify(learned));
    renameSync(`${file}.${process.pid}.part`, file);
  } catch {
    // Nothing learned this time.
  }
}

/**
 * `work`, given `limitMs`, raced against it: its answer, or late once the limit passes. When `learnIn` names a home,
 * the step learns there how long the work took, or its whole limit when it ran out. A throw from `work` learns nothing.
 */
export async function withinLimit<T>(step: Step, limitMs: number, learnIn: string | undefined, work: (limitMs: number) => Promise<T>): Promise<{ late: false; answer: T } | { late: true }> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<{ late: true }>((resolve) => (timer = setTimeout(() => resolve({ late: true }), limitMs)));
  const from = performance.now();
  try {
    const result = await Promise.race([work(limitMs).then((answer) => ({ late: false as const, answer })), late]);
    if (learnIn !== undefined) learn(learnIn, step, result.late ? limitMs : performance.now() - from);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function read(home: string): Record<string, number[]> {
  try {
    const stored: unknown = JSON.parse(readFileSync(path.join(home, LEARNED_FILE), "utf8"));
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, number[]] => Array.isArray(entry[1]) && entry[1].every((time) => typeof time === "number" && Number.isFinite(time) && time >= 0)));
  } catch {
    return {};
  }
}
