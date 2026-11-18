// Capability 6 · CI times.
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ghApi, platformOfJob } from "../read-ci/read-ci.js";
import type { CiTimesDb } from "./store.js";

export interface ActionsReader {
  json(route: string): Promise<any>;
  graphql(query: string, variables: Record<string, string>): Promise<any>;
  download(repository: string, run: number, pattern: string, into: string): Promise<void>;
}

export interface CiTimesRecorded {
  readonly runs: number;
  readonly pulls: number;
  readonly units: number;
  readonly scopes: number;
}

export type ScopeRule = (files: readonly string[]) => { readonly full: boolean; readonly dirs: readonly string[] };

const EVENTS = ["pull_request", "merge_group"] as const;
const BACKFILL_DAYS = 15;
const JOBS_PER_PASS = 150;
const TIMINGS = "test-timings-*";
const AT_ONCE = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_SLACK_MS = 60 * 1000;
const FILES_LISTED = 3000;

export function ghActions(command = "gh"): ActionsReader {
  const api = ghApi(command);
  const run = promisify(execFile);
  return {
    json: api.json,
    async graphql(query, variables) {
      const fields = Object.entries(variables).flatMap(([name, value]) => ["-f", `${name}=${value}`]);
      return JSON.parse((await run(command, ["api", "graphql", "-f", `query=${query}`, ...fields], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true })).stdout);
    },
    async download(repository, id, pattern, into) {
      await run(command, ["run", "download", String(id), "-R", repository, "-p", pattern, "-D", into], { encoding: "utf8", windowsHide: true });
    },
  };
}

export async function recordCiTimes({ db, project, repository, actions, now = new Date(), backfillDays = BACKFILL_DAYS, jobsPerPass = JOBS_PER_PASS, scopeOf }: {
  db: CiTimesDb; project: string; repository: string; actions: ActionsReader; now?: Date; backfillDays?: number; jobsPerPass?: number; scopeOf?: ScopeRule;
}): Promise<CiTimesRecorded> {
  const since = await recordFrom(db, project, now, backfillDays);
  let runs = 0;
  for (let day = startOfDay(since); day.getTime() <= now.getTime(); day = new Date(day.getTime() + DAY_MS)) {
    for (const event of EVENTS) {
      for (const listed of await runsOf(actions, repository, event, day.toISOString().slice(0, 10))) {
        await saveRun(db, project, repository, listed);
        runs++;
      }
    }
  }
  await readBounds(db, project, repository, actions, jobsPerPass);
  const units = await readTimings(db, project, repository, actions);
  const pulls = await recordPulls(db, project, repository, actions, since);
  const scopes = scopeOf === undefined ? 0 : await recordScopes(db, project, repository, actions, scopeOf, now);
  await db.query(
    `INSERT INTO ci_readings (project, repository, read_at) VALUES ($1, $2, $3)
      ON CONFLICT (project) DO UPDATE SET repository = EXCLUDED.repository, read_at = EXCLUDED.read_at`,
    [project, repository, now],
  );
  return { runs, pulls, units, scopes };
}

async function recordFrom(db: CiTimesDb, project: string, now: Date, backfillDays: number): Promise<Date> {
  const floor = new Date(now.getTime() - backfillDays * DAY_MS);
  const { rows: [last] } = await db.query<{ read_at: Date }>("SELECT read_at FROM ci_readings WHERE project = $1", [project]);
  if (last === undefined) return floor;
  const { rows: [going] } = await db.query<{ oldest: Date | null }>("SELECT min(created_at) AS oldest FROM ci_runs WHERE project = $1 AND status <> 'completed' AND created_at >= $2", [project, floor]);
  const from = Math.min(last.read_at.getTime() - 60 * 60 * 1000, going?.oldest?.getTime() ?? Infinity);
  return new Date(Math.max(from, floor.getTime()));
}

function startOfDay(at: Date): Date {
  return new Date(`${at.toISOString().slice(0, 10)}T00:00:00Z`);
}

type ListedRun = {
  id: number; name?: string; event: string; status: string; conclusion: string | null; head_sha: string; head_branch?: string | null;
  run_attempt?: number; created_at: string; run_started_at?: string | null; updated_at: string; pull_requests?: { number: number }[];
};

async function runsOf(actions: ActionsReader, repository: string, event: string, day: string): Promise<ListedRun[]> {
  const all: ListedRun[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ event, created: day, per_page: "100", page: String(page) });
    const listed: ListedRun[] = (await actions.json(`repos/${repository}/actions/runs?${query}`)).workflow_runs ?? [];
    all.push(...listed);
    if (listed.length < 100) return all;
  }
}

function pullOf(listed: ListedRun): number | null {
  const named = listed.pull_requests?.[0]?.number;
  if (named !== undefined) return named;
  const queued = /\/pr-(\d+)-/.exec(listed.head_branch ?? "");
  return queued === null ? null : Number(queued[1]);
}

async function saveRun(db: CiTimesDb, project: string, repository: string, listed: ListedRun): Promise<void> {
  const completed = listed.status === "completed";
  await db.query(
    `INSERT INTO ci_runs (project, repository, run_id, attempt, workflow, event, pull, head_sha, created_at, started_at, ended_at, status, conclusion)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (project, run_id) DO UPDATE SET
        repository = EXCLUDED.repository, workflow = EXCLUDED.workflow, pull = EXCLUDED.pull, head_sha = EXCLUDED.head_sha,
        created_at = EXCLUDED.created_at, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
        status = EXCLUDED.status, conclusion = EXCLUDED.conclusion, attempt = EXCLUDED.attempt,
        bound = CASE WHEN ci_runs.attempt = EXCLUDED.attempt THEN ci_runs.bound END,
        timed = ci_runs.timed AND ci_runs.attempt = EXCLUDED.attempt`,
    [project, repository, listed.id, listed.run_attempt ?? 1, listed.name ?? "", listed.event, pullOf(listed), listed.head_sha,
      listed.created_at, listed.run_started_at ?? null, completed ? listed.updated_at : null, listed.status, completed ? listed.conclusion : null],
  );
}

type Job = { name?: string; labels?: string[]; started_at?: string | null; completed_at?: string | null; conclusion?: string | null };

async function readBounds(db: CiTimesDb, project: string, repository: string, actions: ActionsReader, limit: number): Promise<void> {
  const { rows } = await db.query<{ run_id: string; attempt: number }>(
    `SELECT run_id, attempt FROM ci_runs WHERE project = $1 AND repository = $2 AND conclusion = 'success' AND bound IS NULL
      ORDER BY created_at DESC LIMIT $3`, [project, repository, limit]);
  await eachAtMost(rows, AT_ONCE, async ({ run_id, attempt }) => {
    const jobs: Job[] = (await actions.json(`repos/${repository}/actions/runs/${run_id}/attempts/${attempt}/jobs?per_page=100`)).jobs ?? [];
    const timed = jobs.filter((job) => job.conclusion !== "skipped" && job.started_at && job.completed_at)
      .map((job) => ({ job, ms: Date.parse(job.completed_at!) - Date.parse(job.started_at!) }));
    const longest = timed.reduce<{ job: Job; ms: number } | undefined>((best, one) => (best === undefined || one.ms > best.ms ? one : best), undefined);
    const bound = (longest && platformOfJob(longest.job)) ?? "unknown";
    await db.query("UPDATE ci_runs SET bound = $3 WHERE project = $1 AND run_id = $2", [project, run_id, bound]);
  });
}

async function eachAtMost<T>(items: readonly T[], limit: number, act: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await act(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

type TimingRow = { at?: string; platform?: string; arch?: string; unit?: string; result?: string; ms?: number; timedOut?: boolean; jobs?: number; artifact?: string };

async function readTimings(db: CiTimesDb, project: string, repository: string, actions: ActionsReader): Promise<number> {
  const { rows } = await db.query<{ run_id: string; head_sha: string; started_at: Date | null; created_at: Date; ended_at: Date }>(
    `SELECT run_id, head_sha, started_at, created_at, ended_at FROM ci_runs
      WHERE project = $1 AND repository = $2 AND event = 'merge_group' AND conclusion = 'success' AND NOT timed ORDER BY created_at`,
    [project, repository]);
  let units = 0;
  await eachAtMost(rows, AT_ONCE, async (run) => {
    const artifacts: { name: string; expired: boolean }[] = (await actions.json(`repos/${repository}/actions/runs/${run.run_id}/artifacts?per_page=100`)).artifacts ?? [];
    if (artifacts.some(({ name, expired }) => name.startsWith("test-timings-") && !expired)) {
      const into = mkdtempSync(path.join(tmpdir(), "ci-times-"));
      try {
        await actions.download(repository, Number(run.run_id), TIMINGS, into);
        const from = (run.started_at ?? run.created_at).getTime() - RUN_SLACK_MS;
        const to = run.ended_at.getTime() + RUN_SLACK_MS;
        for (const row of timingRows(into)) {
          const at = Date.parse(row.at ?? "");
          if (row.unit === undefined || !(at >= from && at <= to) || row.platform === undefined || typeof row.ms !== "number") continue;
          await db.query(
            `INSERT INTO ci_unit_times (project, run_id, head_sha, platform, arch, unit, jobs, result, ms, timed_out, at, artifact)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
            [project, run.run_id, run.head_sha, row.platform, row.arch ?? "", row.unit, row.jobs ?? 1, row.result ?? "", Math.round(row.ms), row.timedOut === true, row.at, row.artifact ?? null]);
          units++;
        }
      } finally {
        rmSync(into, { recursive: true, force: true });
      }
    }
    await db.query("UPDATE ci_runs SET timed = true WHERE project = $1 AND run_id = $2", [project, run.run_id]);
  });
  return units;
}

function timingRows(folder: string): TimingRow[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".jsonl")).flatMap((file) => {
    const [first, ...rest] = file.split(/[\\/]/);
    const artifact = rest.length > 0 ? { artifact: first! } : {};
    return readFileSync(path.join(folder, file), "utf8").split("\n").flatMap((line) => {
      try {
        return line.trim() === "" ? [] : [{ ...(JSON.parse(line) as TimingRow), ...artifact }];
      } catch {
        return [];
      }
    });
  });
}

const MERGED = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number createdAt mergedAt timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) { nodes { ... on ReadyForReviewEvent { createdAt } } } } }
  }
}`;

type MergedPull = { number?: number; createdAt?: string; mergedAt?: string | null; timelineItems?: { nodes?: { createdAt?: string }[] } };

async function recordPulls(db: CiTimesDb, project: string, repository: string, actions: ActionsReader, since: Date): Promise<number> {
  let pulls = 0;
  let after: string | undefined;
  do {
    const answer = await actions.graphql(MERGED, { q: `repo:${repository} is:pr is:merged merged:>=${since.toISOString().slice(0, 10)}`, ...(after === undefined ? {} : { after }) });
    const search = answer?.data?.search;
    for (const pull of (search?.nodes ?? []) as MergedPull[]) {
      if (pull.number === undefined || !pull.mergedAt || !pull.createdAt) continue;
      const ready = pull.timelineItems?.nodes?.at(-1)?.createdAt ?? pull.createdAt;
      await db.query(
        `INSERT INTO ci_pulls (project, repository, pull, ready_at, merged_at) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (project, pull) DO UPDATE SET repository = EXCLUDED.repository, ready_at = EXCLUDED.ready_at, merged_at = EXCLUDED.merged_at`,
        [project, repository, pull.number, ready, pull.mergedAt]);
      pulls++;
    }
    after = search?.pageInfo?.hasNextPage ? search.pageInfo.endCursor : undefined;
  } while (after !== undefined);
  return pulls;
}

async function recordScopes(db: CiTimesDb, project: string, repository: string, actions: ActionsReader, scopeOf: ScopeRule, now: Date): Promise<number> {
  const open: { number: number; head: { sha: string } }[] = [];
  for (let page = 1; ; page++) {
    const listed = (await actions.json(`repos/${repository}/pulls?state=open&per_page=100&page=${page}`)) ?? [];
    open.push(...listed);
    if (listed.length < 100) break;
  }
  await db.query("DELETE FROM ci_pull_scopes WHERE project = $1 AND NOT (pull = ANY($2::int[]))", [project, open.map(({ number }) => number)]);
  const { rows } = await db.query<{ pull: number; head_sha: string }>("SELECT pull, head_sha FROM ci_pull_scopes WHERE project = $1", [project]);
  const read = new Map(rows.map(({ pull, head_sha }) => [pull, head_sha]));
  const moved = open.filter(({ number, head }) => read.get(number) !== head.sha);
  await eachAtMost(moved, AT_ONCE, async ({ number, head }) => {
    const files: string[] = [];
    for (let page = 1; ; page++) {
      const listed: { filename: string }[] = (await actions.json(`repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`)) ?? [];
      files.push(...listed.map(({ filename }) => filename));
      if (listed.length < 100 || files.length >= FILES_LISTED) break;
    }
    const scope = files.length >= FILES_LISTED ? { full: true, dirs: [] } : scopeOf(files);
    await db.query(
      `INSERT INTO ci_pull_scopes (project, pull, head_sha, every, dirs, read_at) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (project, pull) DO UPDATE SET head_sha = EXCLUDED.head_sha, every = EXCLUDED.every, dirs = EXCLUDED.dirs, read_at = EXCLUDED.read_at`,
      [project, number, head.sha, scope.full, scope.full ? [] : [...scope.dirs], now]);
  });
  return moved.length;
}
