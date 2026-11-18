// Capability 3 · Hooks
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Step {
  readonly name: string;
  readonly floorMs: number;
  readonly ceilingMs: number;
}

export const LEARNED_FILE = "learned-limits.json";
const KEPT = 10;
const LEAST = 3;
const MULTIPLE = 3;

export function limitOf(home: string, step: Step): number {
  const times = read(home)[step.name] ?? [];
  if (times.length < LEAST) return step.floorMs;
  return Math.min(step.ceilingMs, Math.max(step.floorMs, Math.ceil(MULTIPLE * Math.max(...times))));
}

export function learn(home: string, step: Step, tookMs: number): void {
  if (!Number.isFinite(tookMs) || tookMs < 0) return;
  try {
    const learned = read(home);
    learned[step.name] = [...(learned[step.name] ?? []), Math.round(tookMs)].slice(-KEPT);
    const file = path.join(home, LEARNED_FILE);
    mkdirSync(home, { recursive: true });
    writeFileSync(`${file}.${process.pid}.part`, JSON.stringify(learned));
    renameSync(`${file}.${process.pid}.part`, file);
  } catch {
  }
}

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
