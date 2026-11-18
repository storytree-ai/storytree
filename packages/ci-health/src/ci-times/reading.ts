// Capability 6 · CI times.
import { ciEstimates, type CiEstimate } from "./estimate.js";
import type { CiTimesDb } from "./store.js";

export interface CiTimesReading {
  readonly repository: string;
  readonly readAt: string;
  readonly toMerge: {
    readonly median?: number;
    readonly was?: number;
    readonly merged: number;
    readonly days: readonly (number | null)[];
  };
  readonly run: { readonly median?: number; readonly bound?: string; readonly runs: number };
  readonly legs: { readonly checks?: number; readonly queue?: number; readonly pulls: readonly CiEstimate[] };
  readonly queue: { readonly reds: number; readonly runs: number };
  readonly now: { readonly inCi: number; readonly inQueue: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const STALE_MS = 6 * 60 * 60 * 1000;
const PASSED = new Set(["success", "skipped", "neutral"]);
const RED = new Set(["failure", "timed_out", "startup_failure"]);

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export const minutes = (ms: number) => ms / 60_000;

export type RunRow = { event: string; pull: number | null; head_sha: string; created_at: Date; started_at: Date | null; ended_at: Date | null; status: string; conclusion: string | null; bound: string | null };

export async function ciTimesReading(db: CiTimesDb, project: string, now = new Date()): Promise<CiTimesReading | undefined> {
  const { rows: [reading] } = await db.query<{ repository: string; read_at: Date }>("SELECT repository, read_at FROM ci_readings WHERE project = $1", [project]);
  if (reading === undefined) return undefined;
  const weekAgo = now.getTime() - WEEK_MS;
  const twoWeeksAgo = now.getTime() - 2 * WEEK_MS;

  const { rows: pulls } = await db.query<{ ready_at: Date; merged_at: Date }>(
    "SELECT ready_at, merged_at FROM ci_pulls WHERE project = $1 AND merged_at >= $2 AND merged_at < $3", [project, new Date(twoWeeksAgo), now]);
  const took = pulls.map(({ ready_at, merged_at }) => ({ at: merged_at.getTime(), minutes: minutes(merged_at.getTime() - ready_at.getTime()) }));
  const between = (from: number, to: number) => took.filter(({ at }) => at >= from && at < to).map(({ minutes: one }) => one);
  const thisWeek = between(weekAgo, now.getTime());
  const days = Array.from({ length: 14 }, (_, day) => median(between(twoWeeksAgo + day * DAY_MS, twoWeeksAgo + (day + 1) * DAY_MS)) ?? null);

  const { rows: runs } = await db.query<RunRow>(
    `SELECT event, pull, head_sha, created_at, started_at, ended_at, status, conclusion, bound FROM ci_runs
      WHERE project = $1 AND (created_at >= $2 OR (status <> 'completed' AND created_at >= $3))`,
    [project, new Date(weekAgo), new Date(reading.read_at.getTime() - STALE_MS)]);
  const passing: { event: string; minutes: number; bound: string | null }[] = [];
  let reds = 0;
  let verdicts = 0;
  for (const group of headsOf(runs.filter(({ created_at }) => created_at.getTime() >= weekAgo))) {
    if (group.some(({ status }) => status !== "completed")) continue;
    const conclusions = group.map(({ conclusion }) => conclusion ?? "");
    if (group[0]!.event === "merge_group" && !conclusions.includes("cancelled")) {
      verdicts++;
      if (conclusions.some((one) => RED.has(one))) reds++;
    }
    const longest = passedLongest(group);
    if (longest === undefined) continue;
    passing.push({ event: group[0]!.event, minutes: minutes(span(longest)), bound: longest.bound });
  }
  const bounds = new Map<string, number>();
  for (const { bound } of passing) if (bound !== null && bound !== "unknown") bounds.set(bound, (bounds.get(bound) ?? 0) + 1);
  const bound = [...bounds].sort((a, b) => b[1] - a[1])[0]?.[0];

  const legMedian = (event: string) => median(passing.filter((one) => one.event === event).map(({ minutes: one }) => one));
  const going = (event: string) => new Set(runs.filter((run) => run.event === event && run.status !== "completed" && run.created_at.getTime() >= reading.read_at.getTime() - STALE_MS)
    .map((run) => run.pull ?? run.head_sha)).size;

  return {
    repository: reading.repository,
    readAt: reading.read_at.toISOString(),
    toMerge: { ...defined("median", median(thisWeek)), ...defined("was", median(between(twoWeeksAgo, weekAgo))), merged: thisWeek.length, days },
    run: { ...defined("median", median(passing.map(({ minutes: one }) => one))), ...defined("bound", bound), runs: passing.length },
    legs: { ...defined("checks", legMedian("pull_request")), ...defined("queue", legMedian("merge_group")), pulls: await ciEstimates(db, project, now) },
    queue: { reds, runs: verdicts },
    now: { inCi: going("pull_request"), inQueue: going("merge_group") },
  };
}

export function headsOf(runs: readonly RunRow[]): RunRow[][] {
  const groups = new Map<string, RunRow[]>();
  for (const run of runs) {
    const key = `${run.event}\0${run.head_sha}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()];
}

export function passedLongest(group: readonly RunRow[]): RunRow | undefined {
  if (!group.every(({ status, conclusion }) => status === "completed" && PASSED.has(conclusion ?? ""))) return undefined;
  return group.reduce((best, one) => (span(one) > span(best) ? one : best));
}

export function span(run: RunRow): number {
  return run.ended_at === null ? 0 : run.ended_at.getTime() - (run.started_at ?? run.created_at).getTime();
}

function defined<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
