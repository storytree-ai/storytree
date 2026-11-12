/**
 * Capability 6 · CI times. Each open pull request's checks estimate (stage 3 of question_177bdb4c1e2a's display,
 * research_5ab97b11f915), from the packages its checks test (its scope, record.ts) rather than the factory median:
 *
 * - On each system the newest timed run tested (so a system that stopped running on a pull request, macOS since ADR-1303,
 *   drops out), its in-scope units' median passing times over the last 7 days, summed and spread over the system's shards
 *   (the timing artifacts that run left for it) and the units each runs at once (`jobs`), but never under its longest unit.
 * - The slower system's, plus the setup: what a run does before and after its tests (install, typecheck, the jobs after),
 *   learned from the same week's timed runs, each one's whole time less its own tests' bound by the same sum, the median of
 *   those (ADR-1329 D1); SETUP_MINUTES only while no timed run is recorded, which the estimate says.
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
  /** The setup minutes it includes, and how many of the week's timed runs they were learned from: none for SETUP_MINUTES. */
  readonly setup: { readonly minutes: number; readonly runs: number };
}

/** The setup while no timed run is recorded: the residual fitted once over a week of runs, about 3.9 to 4.8 min a day. */
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

/** How many units a system's run tested at once: its shards (the timing artifacts it left) times the units each runs at once. */
const atOnce = (ran: readonly TimeRow[]) => new Set(ran.map(({ artifact }) => artifact)).size * Math.max(...ran.map(({ jobs }) => jobs));
/** Units' minutes spread over `at` at once, never under the longest; none tested is 0. */
const spread = (minutes: readonly number[], at: number) => (minutes.length === 0 ? 0 : Math.max(minutes.reduce((sum, one) => sum + one, 0) / at, ...minutes));
/** The slowest system with something to test. */
const slowest = (bounds: readonly { platform: string; minutes: number }[]) =>
  bounds.reduce<{ platform: string; minutes: number } | undefined>((best, one) => (one.minutes > 0 && (best === undefined || one.minutes > best.minutes) ? one : best), undefined);

/** The setup minutes: the median, over `times`' passing runs, of each one's whole time less its own tests' bound; SETUP_MINUTES with none. */
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
