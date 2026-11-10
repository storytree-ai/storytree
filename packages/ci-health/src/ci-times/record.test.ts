import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { recordCiTimes, type ActionsReader } from "./record.js";
import { ciScopeRule } from "./scope.js";
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
function actions(world: { runs: Run[]; jobs?: Record<number, Job[]>; artifacts?: Record<number, Artifact[]>; files?: Record<string, string>; pulls?: object[]; open?: { number: number; sha: string; files: number | string[] }[] }): ActionsReader & { asked: string[]; downloads: number[] } {
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
      const page = <T>(all: T[]) => {
        const size = Number(params.get("per_page") ?? "30");
        const from = (Number(params.get("page") ?? "1") - 1) * size;
        return all.slice(from, from + size);
      };
      if (where === `repos/${REPO}/pulls` && params.get("state") === "open") return page((world.open ?? []).map(({ number, sha }) => ({ number, head: { sha } })));
      const files = /^repos\/acme\/shop\/pulls\/(\d+)\/files$/.exec(where);
      if (files) {
        const named = world.open?.find(({ number }) => number === Number(files[1]))?.files ?? [];
        const all = typeof named === "number" ? Array.from({ length: named }, (_, i) => `packages/p${i}/x.ts`) : named;
        return page(all.map((filename) => ({ filename })));
      }
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
      for (const table of ["ci_runs", "ci_pulls", "ci_unit_times", "ci_readings", "ci_pull_scopes"]) await db.query(`DELETE FROM ${table} WHERE project = $1`, [project]);
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

test("6.2 A passing merge-queue run's per-package test times are kept per unit and system from its timing artifacts, each with the artifact (a system's shard) it came in; older runs' rows in the same file are not, and a run whose artifacts expired keeps none and is not asked again", async (t) => {
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
  const { rows } = await db.query<Record<string, unknown>>("SELECT run_id::int AS run, head_sha, platform, unit, ms, jobs, result, timed_out, artifact FROM ci_unit_times WHERE project = $1 ORDER BY platform", [project]);
  assert.deepEqual(rows, [
    { run: 7, head_sha: "def", platform: "linux", unit: "packages/forest", ms: 61000, jobs: 2, result: "pass", timed_out: false, artifact: "test-timings-Linux-1" },
    { run: 7, head_sha: "def", platform: "win32", unit: "packages/cli", ms: 240000, jobs: 2, result: "pass", timed_out: false, artifact: "test-timings-Windows-shard-1-1" },
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

test("6.9 Recording CI times keeps each open pull request's scope, the packages its checks test, from its changed files: read again only when its head moves, all of them when it changes more files than GitHub lists, and dropped once it closes", async (t) => {
  const { db, project } = await store(t);
  const world = {
    runs: [] as Run[],
    open: [
      { number: 12, sha: "a1", files: ["packages/forest/src/a.ts", "docs/x.md"] },
      { number: 13, sha: "b1", files: ["package.json"] },
      { number: 14, sha: "c1", files: 3000 },
    ],
  };
  const github = actions(world);
  /** What CI's own scope rule would decide: a package.json runs everything, else each file's package. */
  const scopeOf = (files: readonly string[]) => files.includes("package.json") ? { full: true as const, dirs: [] } : { full: false as const, dirs: [...new Set(files.filter((file) => file.startsWith("packages/")).map((file) => file.split("/").slice(0, 2).join("/")))].sort() };
  const scopes = async () => (await db.query<Record<string, unknown>>("SELECT pull, head_sha, every AS full, dirs FROM ci_pull_scopes WHERE project = $1 ORDER BY pull", [project])).rows;

  const recorded = await recordCiTimes({ db, project, repository: REPO, actions: github, now: NOW, backfillDays: 2, scopeOf });
  assert.equal(recorded.scopes, 3);
  assert.deepEqual(await scopes(), [
    { pull: 12, head_sha: "a1", full: false, dirs: ["packages/forest"] },
    { pull: 13, head_sha: "b1", full: true, dirs: [] },
    { pull: 14, head_sha: "c1", full: true, dirs: [] },
  ]);
  const filesAsked = () => github.asked.filter((route) => route.includes("/files")).map((route) => route.split("?")[0]!);
  assert.equal(filesAsked().filter((route) => route.endsWith("/12/files")).length, 1);

  world.open = [{ number: 12, sha: "a2", files: ["packages/cli/src/b.ts"] }, { number: 13, sha: "b1", files: ["package.json"] }];
  await recordCiTimes({ db, project, repository: REPO, actions: github, now: new Date("2026-11-10T12:20:00Z"), backfillDays: 2, scopeOf });
  assert.deepEqual(await scopes(), [
    { pull: 12, head_sha: "a2", full: false, dirs: ["packages/cli"] },
    { pull: 13, head_sha: "b1", full: true, dirs: [] },
  ], "a moved head is read again; a closed pull request is dropped");
  assert.equal(filesAsked().filter((route) => route.endsWith("/13/files")).length, 1, "an unmoved head is not read again");

  await recordCiTimes({ db, project, repository: REPO, actions: github, now: new Date("2026-11-10T12:40:00Z"), backfillDays: 2 });
  assert.equal((await scopes()).length, 2, "a recording with no scope rule leaves the scopes as they were");
});

test("6.9 An open pull request's scope is read by CI's own rule over the recording's checkout: its changed packages and every package depending on them, or every package for a change no package holds", (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "ci-scope-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const pkg = (dir: string, name: string, deps: Record<string, string> = {}) => {
    mkdirSync(path.join(folder, dir, "src"), { recursive: true });
    writeFileSync(path.join(folder, dir, "package.json"), JSON.stringify({ name, dependencies: deps }));
  };
  pkg("packages/forest", "@acme/forest");
  pkg("packages/map", "@acme/map", { "@acme/forest": "workspace:*" });
  pkg("packages/cli", "@acme/cli");
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "acme" }));
  const scopeOf = ciScopeRule(folder);
  assert.deepEqual(scopeOf(["packages/forest/src/a.ts"]), { full: false, dirs: ["packages/forest", "packages/map"] }, "its dependent too");
  assert.deepEqual(scopeOf(["packages/cli/src/b.ts"]), { full: false, dirs: ["packages/cli"] });
  assert.deepEqual(scopeOf(["README.md", "packages/cli/src/b.ts"]), { full: true, dirs: [] }, "a root file runs everything");
});
