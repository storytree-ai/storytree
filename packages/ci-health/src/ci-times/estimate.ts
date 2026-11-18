// Capability 6 · CI times.
import { median } from "./reading.js";
import type { CiTimesDb } from "./store.js";

export interface CiEstimate {
  readonly pull: number;
  readonly checks: number;
  readonly system?: string;
  readonly full: boolean;
  readonly packages: readonly string[];
  readonly setup: { readonly minutes: number; readonly runs: number };
}

export const SETUP_MINUTES = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function ciEstimates(db: CiTimesDb, project: string, now: Date): Promise<CiEstimate[]> {
  const { rows: scopes } = await db.query<{ pull: number; full: boolean; dirs: string[] }>(
    "SELECT pull, every AS full, dirs FROM ci_pull_scopes WHERE project = $1 ORDER BY pull", [project]);
  if (scopes.length === 0) return [];
  const { rows: times } = await db.query<{ run_id: string; platform: string; unit: string; ms: number; jobs: number; artifact: string | null; at: Date }>(
    "SELECT run_id, platform, unit, ms, jobs, artifact, at FROM ci_unit_times WHERE project = $1 AND result = 'pass' AND at >= $2 AND at <= $3",
    [project, new Date(now.getTime() - WEEK_MS), now]);
  const newest = times.reduce<(typeof times)[number] | undefined>((best, one) => (best === undefined || one.at > best.at ? one : best), undefined);
  const systems = [...new Set(times.filter(({ run_id }) => run_id === newest?.run_id).map(({ platform }) => platform))].map((platform) => {
    const ran = times.filter((one) => one.run_id === newest!.run_id && one.platform === platform);
    const byUnit = new Map<string, number[]>();
    for (const { unit, ms } of times.filter((one) => one.platform === platform)) byUnit.set(unit, [...(byUnit.get(unit) ?? []), ms / 60_000]);
    return { platform, at: atOnce(ran), units: [...byUnit].map(([unit, minutes]) => ({ unit, minutes: median(minutes)! })) };
  });
  const setup = await learnedSetup(db, project, times);
  return scopes.map(({ pull, full, dirs }) => {
    const tests = (unit: string) => full || dirs.some((dir) => unit === dir || unit.startsWith(`${dir}/`));
    const bound = slowest(systems.map(({ platform, at, units }) => ({ platform, minutes: spread(units.filter(({ unit }) => tests(unit)).map(({ minutes: one }) => one), at) })));
    return { pull, checks: (bound?.minutes ?? 0) + setup.minutes, ...(bound === undefined ? {} : { system: bound.platform }), full, packages: full ? [] : dirs, setup };
  });
}

type TimeRow = { run_id: string; platform: string; ms: number; jobs: number; artifact: string | null };

const atOnce = (ran: readonly TimeRow[]) => new Set(ran.map(({ artifact }) => artifact)).size * Math.max(...ran.map(({ jobs }) => jobs));
const spread = (minutes: readonly number[], at: number) => (minutes.length === 0 ? 0 : Math.max(minutes.reduce((sum, one) => sum + one, 0) / at, ...minutes));
const slowest = (bounds: readonly { platform: string; minutes: number }[]) =>
  bounds.reduce<{ platform: string; minutes: number } | undefined>((best, one) => (one.minutes > 0 && (best === undefined || one.minutes > best.minutes) ? one : best), undefined);

async function learnedSetup(db: CiTimesDb, project: string, times: readonly TimeRow[]): Promise<CiEstimate["setup"]> {
  const byRun = new Map<string, TimeRow[]>();
  for (const one of times) byRun.set(String(one.run_id), [...(byRun.get(String(one.run_id)) ?? []), one]);
  if (byRun.size === 0) return { minutes: SETUP_MINUTES, runs: 0 };
  const { rows: runs } = await db.query<{ run_id: string; started_at: Date | null; created_at: Date; ended_at: Date }>(
    "SELECT run_id, started_at, created_at, ended_at FROM ci_runs WHERE project = $1 AND run_id = ANY($2::bigint[]) AND conclusion = 'success' AND ended_at IS NOT NULL",
    [project, [...byRun.keys()]]);
  const beyond = runs.map(({ run_id, started_at, created_at, ended_at }) => {
    const ran = byRun.get(String(run_id))!;
    const tests = slowest([...new Set(ran.map(({ platform }) => platform))].map((platform) => {
      const on = ran.filter((one) => one.platform === platform);
      return { platform, minutes: spread(on.map(({ ms }) => ms / 60_000), atOnce(on)) };
    }))?.minutes ?? 0;
    return Math.max(0, (ended_at.getTime() - (started_at ?? created_at).getTime()) / 60_000 - tests);
  });
  const minutes = median(beyond);
  return minutes === undefined ? { minutes: SETUP_MINUTES, runs: 0 } : { minutes, runs: beyond.length };
}
