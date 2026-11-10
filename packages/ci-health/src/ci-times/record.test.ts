import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { recordCiTimes, type ActionsReader } from "./record.js";
import { ciTimesPool, type CiTimesDb } from "./store.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const REPO = "acme/shop";

type Run = { id: number; name: string; event: string; status: string; conclusion: string | null; head_sha: string; head_branch: string; run_attempt: number; created_at: string; run_started_at: string; updated_at: string; pull_requests: { number: number }[] };
type Job = { name: string; labels: string[]; started_at: string; completed_at: string; conclusion: string };
type Artifact = { name: string; expired: boolean };

/** A run as the Actions API lists it. */
function run(id: number, fields: Partial<Run> & Pick<Run, "event" | "created_at">): Run {
  return { id, name: "CI", status: "completed", conclusion: "success", head_sha: `sha${id}`, head_branch: "feature", run_attempt: 1, run_started_at: fields.created_at, updated_at: fields.created_at, pull_requests: [], ...fields };
}

/** The Actions API as GitHub answers it, over `runs`, each run's jobs and artifacts, a downloadable timing file per artifact, and the merged pull requests; every route asked is kept. */
function actions(world: { runs: Run[]; jobs?: Record<number, Job[]>; artifacts?: Record<number, Artifact[]>; files?: Record<string, string>; pulls?: object[] }): ActionsReader & { asked: string[]; downloads: number[] } {
  const asked: string[] = [];
  const downloads: number[] = [];
  return {
    asked,
    downloads,
    async json(route) {
      asked.push(route);
      const [where = "", query = ""] = route.split("?");
      const params = new URLSearchParams(query);
      if (where === `repos/${REPO}/actions/runs`) {
        const page = Number(params.get("page") ?? "1");
        const listed = world.runs.filter((one) => one.event === params.get("event") && one.created_at.startsWith(params.get("created")!));
        return { total_count: listed.length, workflow_runs: page === 1 ? listed : [] };
      }
      const jobs = /actions\/runs\/(\d+)\/attempts\/\d+\/jobs$/.exec(where);
      if (jobs) return { jobs: world.jobs?.[Number(jobs[1])] ?? [] };
      const artifacts = /actions\/runs\/(\d+)\/artifacts$/.exec(where);
      if (artifacts) return { artifacts: world.artifacts?.[Number(artifacts[1])] ?? [] };
      throw new Error(`HTTP 404: ${route}`);
    },
    async graphql() {
      return { data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: world.pulls ?? [] } } };
    },
    async download(repository, id, pattern, into) {
      assert.equal(repository, REPO);
      assert.equal(pattern, "test-timings-*");
      downloads.push(id);
      for (const artifact of world.artifacts?.[id] ?? []) {
        mkdirSync(path.join(into, artifact.name), { recursive: true });
        writeFileSync(path.join(into, artifact.name, "test-timings.jsonl"), world.files?.[artifact.name] ?? "");
      }
    },
  };
}

/** The CI times' database in the test Postgres `pnpm test` starts, and a project name of the test's own, its rows removed afterwards. */
async function store(t: { after(fn: () => Promise<void>): void }): Promise<{ db: CiTimesDb; project: string }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const db = await ciTimesPool(storytree);
  const project = `t-${randomBytes(4).toString("hex")}`;
  t.after(async () => {
    try {
      for (const table of ["ci_runs", "ci_pulls", "ci_unit_times", "ci_readings"]) await db.query(`DELETE FROM ${table} WHERE project = $1`, [project]);
    } finally {
      await storytree.close();
    }
  });
  return { db, project };
}

test("6.1 Recording CI times keeps one row per pull-request and merge-queue run with its pull request, times, outcome and the system of its longest job; recording again writes nothing twice and completes a run that has finished since", async (t) => {
  const { db, project } = await store(t);
  const world = {
    runs: [
      run(1, { event: "pull_request", created_at: "2026-11-10T10:00:00Z", run_started_at: "2026-11-10T10:00:05Z", updated_at: "2026-11-10T10:12:00Z", pull_requests: [{ number: 5 }] }),
      run(2, { event: "pull_request", created_at: "2026-11-10T11:50:00Z", status: "in_progress", conclusion: null, pull_requests: [{ number: 6 }] }),
      run(3, { event: "merge_group", created_at: "2026-11-09T10:20:00Z", updated_at: "2026-11-09T10:35:00Z", conclusion: "failure", head_branch: "gh-readonly-queue/main/pr-5-abc" }),
      // Another workflow's push run is not CI a pull request waits on.
      run(4, { event: "push", created_at: "2026-11-10T10:40:00Z" }),
    ],
    jobs: {
      1: [
        { name: "verify on Linux", labels: ["ubuntu-latest"], started_at: "2026-11-10T10:00:10Z", completed_at: "2026-11-10T10:08:00Z", conclusion: "success" },
        { name: "verify on Windows 1/2", labels: ["windows-latest"], started_at: "2026-11-10T10:00:10Z", completed_at: "2026-11-10T10:11:40Z", conclusion: "success" },
        { name: "verify", labels: ["ubuntu-latest"], started_at: "2026-11-10T10:11:45Z", completed_at: "2026-11-10T10:11:55Z", conclusion: "success" },
      ],
    },
  };
  const github = actions(world);
  const first = await recordCiTimes({ db, project, repository: REPO, actions: github, now: NOW, backfillDays: 2 });
  assert.equal(first.runs, 3);

  const rows = async () => (await db.query<Record<string, unknown>>(
    "SELECT run_id::int AS id, event, pull, status, conclusion, bound, created_at, started_at, ended_at FROM ci_runs WHERE project = $1 ORDER BY run_id", [project])).rows;
  const stored = await rows();
  assert.deepEqual(stored.map(({ id, event, pull, status, conclusion }) => ({ id, event, pull, status, conclusion })), [
    { id: 1, event: "pull_request", pull: 5, status: "completed", conclusion: "success" },
    { id: 2, event: "pull_request", pull: 6, status: "in_progress", conclusion: null },
    { id: 3, event: "merge_group", pull: 5, status: "completed", conclusion: "failure" },
  ]);
  assert.equal(stored[0]!.bound, "win32", "Windows ran its longest job");
  assert.deepEqual([stored[0]!.created_at, stored[0]!.started_at, stored[0]!.ended_at], [new Date("2026-11-10T10:00:00Z"), new Date("2026-11-10T10:00:05Z"), new Date("2026-11-10T10:12:00Z")]);
  assert.equal(stored[1]!.ended_at, null, "a run still going has not ended");

  world.runs[1] = { ...world.runs[1]!, status: "completed", conclusion: "success", updated_at: "2026-11-10T12:05:00Z" };
  await recordCiTimes({ db, project, repository: REPO, actions: github, now: new Date("2026-11-10T12:10:00Z"), backfillDays: 2 });
  const again = await rows();
  assert.equal(again.length, 3, "nothing is recorded twice");
  assert.equal(again[1]!.status, "completed");
  assert.deepEqual(again[1]!.ended_at, new Date("2026-11-10T12:05:00Z"));
  assert.equal(github.asked.filter((route) => route.includes("/runs/1/attempts/")).length, 1, "a run's jobs are read once");
});

test("6.2 A passing merge-queue run's per-package test times are kept per unit and system from its timing artifacts; older runs' rows in the same file are not, and a run whose artifacts expired keeps none and is not asked again", async (t) => {
  const { db, project } = await store(t);
  const line = (row: object) => JSON.stringify(row);
  const world = {
    runs: [
      run(7, { event: "merge_group", created_at: "2026-11-10T09:00:00Z", run_started_at: "2026-11-10T09:00:02Z", updated_at: "2026-11-10T09:14:00Z", head_branch: "gh-readonly-queue/main/pr-8-def", head_sha: "def" }),
      run(9, { event: "merge_group", created_at: "2026-11-09T01:00:00Z", updated_at: "2026-11-09T01:12:00Z", head_branch: "gh-readonly-queue/main/pr-9-aaa" }),
    ],
    artifacts: {
      7: [{ name: "test-timings-Linux-1", expired: false }, { name: "test-timings-Windows-shard-1-1", expired: false }, { name: "windows-test-evidence-1-shard-1", expired: false }],
      9: [{ name: "test-timings-Linux-1", expired: true }],
    },
    files: {
      "test-timings-Linux-1": [
        line({ at: "2026-11-08T09:10:00.000Z", platform: "linux", arch: "x64", unit: "packages/forest", result: "pass", ms: 99000, timedOut: false, jobs: 2 }),
        line({ at: "2026-11-10T09:12:30.000Z", platform: "linux", arch: "x64", unit: "packages/forest", result: "pass", ms: 61000, timedOut: false, jobs: 2 }),
        line({ at: "2026-11-10T09:12:30.000Z", platform: "linux", arch: "x64", file: "packages/forest/src/a.test.ts", test: "3.1 x", result: "pass", ms: 9000, timedOut: false }),
      ].join("\n"),
      "test-timings-Windows-shard-1-1": line({ at: "2026-11-10T09:13:00.000Z", platform: "win32", arch: "x64", unit: "packages/cli", result: "pass", ms: 240000, timedOut: false, jobs: 2 }),
    },
  };
  const github = actions(world);
  await recordCiTimes({ db, project, repository: REPO, actions: github, now: NOW, backfillDays: 2 });
  const { rows } = await db.query<Record<string, unknown>>("SELECT run_id::int AS run, head_sha, platform, unit, ms, jobs, result, timed_out FROM ci_unit_times WHERE project = $1 ORDER BY platform", [project]);
  assert.deepEqual(rows, [
    { run: 7, head_sha: "def", platform: "linux", unit: "packages/forest", ms: 61000, jobs: 2, result: "pass", timed_out: false },
    { run: 7, head_sha: "def", platform: "win32", unit: "packages/cli", ms: 240000, jobs: 2, result: "pass", timed_out: false },
  ]);
  assert.deepEqual(github.downloads, [7], "an expired artifact is not downloaded");

  await recordCiTimes({ db, project, repository: REPO, actions: github, now: new Date("2026-11-10T12:30:00Z"), backfillDays: 2 });
  assert.deepEqual(github.downloads, [7], "a run's timings are read once");
  assert.equal(github.asked.filter((route) => route.includes("/runs/9/artifacts")).length, 1, "a run whose artifacts expired is not asked again");
});

test("6.3 Each merged pull request's ready and merged times are kept: ready is its last ready-for-review, else when it was opened", async (t) => {
  const { db, project } = await store(t);
  const github = actions({
    runs: [],
    pulls: [
      { number: 5, createdAt: "2026-11-09T08:00:00Z", mergedAt: "2026-11-09T10:00:00Z", timelineItems: { nodes: [{ createdAt: "2026-11-09T09:00:00Z" }] } },
      { number: 6, createdAt: "2026-11-10T08:00:00Z", mergedAt: "2026-11-10T08:40:00Z", timelineItems: { nodes: [] } },
    ],
  });
  const recorded = await recordCiTimes({ db, project, repository: REPO, actions: github, now: NOW, backfillDays: 2 });
  assert.equal(recorded.pulls, 2);
  await recordCiTimes({ db, project, repository: REPO, actions: github, now: NOW, backfillDays: 2 });
  const { rows } = await db.query<Record<string, unknown>>("SELECT pull, ready_at, merged_at FROM ci_pulls WHERE project = $1 ORDER BY pull", [project]);
  assert.deepEqual(rows, [
    { pull: 5, ready_at: new Date("2026-11-09T09:00:00Z"), merged_at: new Date("2026-11-09T10:00:00Z") },
    { pull: 6, ready_at: new Date("2026-11-10T08:00:00Z"), merged_at: new Date("2026-11-10T08:40:00Z") },
  ]);
});
