/**
 * Capability 6 · CI times. Each open pull request's checks estimate (stage 3 of question_177bdb4c1e2a's display,
 * research_5ab97b11f915), from the packages its checks test (its scope, record.ts) rather than the factory median:
 *
 * - On each system the newest timed run tested (so a system that stopped running on a pull request, macOS since ADR-1303,
 *   drops out), its in-scope units' median passing times over the last 7 days, summed and spread over the system's shards
 *   (the timing artifacts that run left for it) and the units each runs at once (`jobs`), but never under its longest unit.
 * - The slower system's, plus SETUP_MINUTES for what a run does before and after its tests.
 *
 * A unit is in scope when it is one of the scope's package dirs or a test file under one. Rough by design: against 186 real
 * passing pull-request runs of 2026-11-06 to 11-10 (run start to its last Linux or Windows job's end), its median error was
 * 1.3 min and 91% fell within 4 min, against the factory median's 2.2 min and 81% (increment_bdfd1085cf67).
 */
import { median } from "./reading.js";
import type { CiTimesDb } from "./store.js";

/** One open pull request's checks estimate, in minutes. */
export interface CiEstimate {
  readonly pull: number;
  readonly checks: number;
  /** The system whose tests bound it; none when its scope reaches no timed unit. */
  readonly system?: string;
  /** Whether its checks test every package; else the package dirs they test. */
  readonly full: boolean;
  readonly packages: readonly string[];
}

/** What a run does besides its tests (install, typecheck, the jobs after): the fitted residual over a week of runs, about 3.9 to 4.8 min a day. */
export const SETUP_MINUTES = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Each open pull request's checks estimate, by pull request, as of `now`. */
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
    return {
      platform,
      at: new Set(ran.map(({ artifact }) => artifact)).size * Math.max(...ran.map(({ jobs }) => jobs)),
      units: [...byUnit].map(([unit, minutes]) => ({ unit, minutes: median(minutes)! })),
    };
  });
  return scopes.map(({ pull, full, dirs }) => {
    const tests = (unit: string) => full || dirs.some((dir) => unit === dir || unit.startsWith(`${dir}/`));
    const bound = systems.map(({ platform, at, units }) => {
      const minutes = units.filter(({ unit }) => tests(unit)).map(({ minutes: one }) => one);
      return { platform, minutes: minutes.length === 0 ? 0 : Math.max(minutes.reduce((sum, one) => sum + one, 0) / at, ...minutes) };
    }).reduce<{ platform: string; minutes: number } | undefined>((best, one) => (one.minutes > 0 && (best === undefined || one.minutes > best.minutes) ? one : best), undefined);
    return { pull, checks: (bound?.minutes ?? 0) + SETUP_MINUTES, ...(bound === undefined ? {} : { system: bound.platform }), full, packages: full ? [] : dirs };
  });
}
