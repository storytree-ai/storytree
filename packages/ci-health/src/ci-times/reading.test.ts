import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { ciTimesReading } from "./reading.js";
import { ciTimesPool, type CiTimesDb } from "./store.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const DAY = 24 * 60;

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

test("6.4 The CI times reading gives the last 7 days against the 7 before: median time to merge and each day's, the median passing run and the system bounding most runs, the queue's red share, and pull requests in CI and in the queue as of the last recording", async (t) => {
  const { db, project } = await store(t);
  assert.equal(await ciTimesReading(db, project, NOW), undefined, "nothing recorded reads nothing");

  // Merged this week in 30, 40 and 50 minutes, last week in 60 and 80.
  const pulls: [number, number, number][] = [[1, 1 * DAY, 30], [2, 2 * DAY, 40], [3, 3 * DAY, 50], [4, 8 * DAY, 60], [5, 9 * DAY, 80]];
  for (const [pull, mergedAgo, took] of pulls) {
    await db.query("INSERT INTO ci_pulls (project, repository, pull, ready_at, merged_at) VALUES ($1, 'acme/shop', $2, $3, $4)", [project, pull, ago(mergedAgo + took), ago(mergedAgo)]);
  }
  let id = 0;
  const run = async (fields: { event: string; sha: string; pull?: number; createdAgo: number; minutes?: number; status?: string; conclusion?: string | null; bound?: string; workflow?: string }) => {
    const ended = fields.status === undefined || fields.status === "completed";
    await db.query(
      `INSERT INTO ci_runs (project, repository, run_id, attempt, workflow, event, pull, head_sha, created_at, started_at, ended_at, status, conclusion, bound)
        VALUES ($1, 'acme/shop', $2, 1, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11)`,
      [project, ++id, fields.workflow ?? "CI", fields.event, fields.pull ?? null, fields.sha, ago(fields.createdAgo),
        ended ? ago(fields.createdAgo - (fields.minutes ?? 0)) : null, fields.status ?? "completed", ended ? fields.conclusion ?? "success" : null, fields.bound ?? null]);
  };
  // Three passing pull-request runs of 10, 12 and 20 minutes (the last a commit two workflows ran, the longer bounding it), Windows longest in two.
  await run({ event: "pull_request", sha: "a", pull: 1, createdAgo: DAY, minutes: 10, bound: "win32" });
  await run({ event: "pull_request", sha: "b", pull: 2, createdAgo: 2 * DAY, minutes: 12, bound: "linux" });
  await run({ event: "pull_request", sha: "c", pull: 3, createdAgo: 3 * DAY, minutes: 20, bound: "win32" });
  await run({ event: "pull_request", sha: "c", pull: 3, createdAgo: 3 * DAY, minutes: 1, workflow: "Capability list", bound: "linux" });
  // A commit whose 12-minute CI a label's workflow followed an hour later: its run time is still 12 minutes.
  await run({ event: "pull_request", sha: "d", pull: 4, createdAgo: 4 * DAY, minutes: 12, bound: "linux" });
  await run({ event: "pull_request", sha: "d", pull: 4, createdAgo: 4 * DAY - 60, minutes: 1, workflow: "Hold release" });
  // The queue: three passed, one red, one cancelled (not counted); and one red from last week (not counted).
  await run({ event: "merge_group", sha: "q1", createdAgo: DAY, minutes: 14, bound: "win32" });
  await run({ event: "merge_group", sha: "q2", createdAgo: DAY, minutes: 15, bound: "win32" });
  await run({ event: "merge_group", sha: "q3", createdAgo: DAY, minutes: 16, bound: "win32" });
  await run({ event: "merge_group", sha: "q4", createdAgo: DAY, minutes: 9, conclusion: "failure" });
  await run({ event: "merge_group", sha: "q5", createdAgo: DAY, minutes: 3, conclusion: "cancelled" });
  await run({ event: "merge_group", sha: "q6", createdAgo: 9 * DAY, minutes: 9, conclusion: "failure" });
  // Going now: two pull requests in CI (one with two workflows running), one in the queue; one left going a day ago is stale.
  await run({ event: "pull_request", sha: "n1", pull: 7, createdAgo: 5, status: "in_progress" });
  await run({ event: "pull_request", sha: "n1", pull: 7, createdAgo: 5, status: "queued", workflow: "Capability list" });
  await run({ event: "pull_request", sha: "n2", pull: 8, createdAgo: 3, status: "in_progress" });
  await run({ event: "merge_group", sha: "n3", pull: 6, createdAgo: 4, status: "in_progress" });
  await run({ event: "pull_request", sha: "old", pull: 9, createdAgo: DAY, status: "in_progress" });
  await db.query("INSERT INTO ci_readings (project, repository, read_at) VALUES ($1, 'acme/shop', $2)", [project, ago(2)]);

  const reading = await ciTimesReading(db, project, NOW);
  assert.ok(reading);
  assert.equal(reading.repository, "acme/shop");
  assert.equal(reading.readAt, ago(2).toISOString());
  assert.deepEqual({ median: reading.toMerge.median, was: reading.toMerge.was, merged: reading.toMerge.merged }, { median: 40, was: 70, merged: 3 });
  assert.equal(reading.toMerge.days.length, 14, "a day each over two weeks, oldest first");
  assert.deepEqual(reading.toMerge.days.slice(-4), [null, 50, 40, 30]);
  assert.deepEqual(reading.toMerge.days.slice(5, 7), [80, 60]);
  assert.deepEqual(reading.run, { median: 14, bound: "win32", runs: 7 }, "runs of 10, 12, 20, 12, 14, 15 and 16 minutes");
  assert.deepEqual(reading.queue, { reds: 1, runs: 4 });
  assert.deepEqual(reading.now, { inCi: 2, inQueue: 1 });
});

test("6.7 The CI times reading gives each CI leg's factory median apart: a pull request's own checks and the merge queue, each its passing runs' median; a leg with no passing run has none", async (t) => {
  const { db, project } = await store(t);
  let id = 0;
  const run = async (event: string, sha: string, minutes: number, conclusion = "success") => db.query(
    `INSERT INTO ci_runs (project, repository, run_id, attempt, workflow, event, pull, head_sha, created_at, started_at, ended_at, status, conclusion, bound)
      VALUES ($1, 'acme/shop', $2, 1, 'CI', $3, NULL, $4, $5, $5, $6, 'completed', $7, NULL)`, [project, ++id, event, sha, ago(DAY), ago(DAY - minutes), conclusion]);
  for (const [sha, minutes] of [["a", 10], ["b", 12], ["c", 20]] as const) await run("pull_request", sha, minutes);
  await run("pull_request", "red", 2, "failure");
  await db.query("INSERT INTO ci_readings (project, repository, read_at) VALUES ($1, 'acme/shop', $2)", [project, ago(2)]);
  assert.deepEqual((await ciTimesReading(db, project, NOW))?.legs, { checks: 12, pulls: [] }, "no passing queue run: no queue median");

  for (const [sha, minutes] of [["q1", 14], ["q2", 15], ["q3", 16]] as const) await run("merge_group", sha, minutes);
  await run("merge_group", "q4", 40, "failure");
  assert.deepEqual((await ciTimesReading(db, project, NOW))?.legs, { checks: 12, queue: 15, pulls: [] });
});

test("6.10 The CI times reading gives each open pull request's checks estimate from its own packages: per system, its units' median times summed over the system's shards and jobs at once (never under its longest unit), on the slower system, plus setup", async (t) => {
  const { db, project } = await store(t);
  await db.query("INSERT INTO ci_readings (project, repository, read_at) VALUES ($1, 'acme/shop', $2)", [project, ago(2)]);
  const unit = (run: number, at: number, platform: string, artifact: string, name: string, minutes: number, result = "pass") => db.query(
    `INSERT INTO ci_unit_times (project, run_id, head_sha, platform, arch, unit, jobs, result, ms, timed_out, at, artifact)
      VALUES ($1, $2, 'sha', $3, 'x64', $4, 2, $5, $6, false, $7, $8)`, [project, run, platform, name, result, minutes * 60_000, ago(at), artifact]);
  // Three runs; each unit's median is the middle one's time. Linux runs in one job set, Windows in two shards.
  for (const [run, at, scale] of [[1, DAY, 1], [2, 2 * DAY, 2], [3, 3 * DAY, 0.5]] as const) {
    await unit(run, at, "linux", "test-timings-Linux-1", "packages/a", 4 * scale);
    await unit(run, at, "linux", "test-timings-Linux-1", "packages/a/src/slow.test.ts", 2 * scale);
    await unit(run, at, "linux", "test-timings-Linux-1", "packages/b", 2 * scale);
    await unit(run, at, "linux", "test-timings-Linux-1", "packages/c", 16 * scale);
    await unit(run, at, "win32", "test-timings-Windows-shard-1-1", "packages/a", 6 * scale);
    await unit(run, at, "win32", "test-timings-Windows-shard-2-1", "packages/a/src/slow.test.ts", 3 * scale);
    await unit(run, at, "win32", "test-timings-Windows-shard-1-1", "packages/b", 4 * scale);
    await unit(run, at, "win32", "test-timings-Windows-shard-2-1", "packages/c", 12 * scale);
    for (const n of [1, 2, 3, 4, 5, 6]) await unit(run, at, "win32", `test-timings-Windows-shard-${1 + (n % 2)}-1`, `packages/w${n}`, 4 * scale);
  }
  await unit(3, 3 * DAY, "linux", "test-timings-Linux-1", "packages/ab", 50, "fail");
  // An older run tested Windows unsharded: the shards are the newest run's, not every artifact the week saw.
  await unit(4, 4 * DAY, "win32", "test-timings-Windows-1", "packages/b", 4);
  // macOS no longer runs on a pull request: its old times are not the slowest system's.
  await unit(9, 6 * DAY, "darwin", "test-timings-macOS-1", "packages/a", 90);
  // Older than a week: not counted.
  await unit(8, 9 * DAY, "linux", "test-timings-Linux-1", "packages/b", 600);
  const scope = (pull: number, full: boolean, dirs: string[]) => db.query(
    "INSERT INTO ci_pull_scopes (project, pull, head_sha, every, dirs, read_at) VALUES ($1, $2, 'h', $3, $4, $5)", [project, pull, full, dirs, ago(2)]);
  await scope(11, false, ["packages/a"]);
  await scope(12, true, []);
  await scope(13, false, []);
  await scope(14, false, ["packages/w1", "packages/w2", "packages/w3", "packages/w4", "packages/w5", "packages/w6"]);

  const reading = await ciTimesReading(db, project, NOW);
  assert.deepEqual(reading?.legs.pulls, [
    // Linux: (4 + 2) / 2 jobs = 3, under its longest unit, 4. Windows: (6 + 3) / (2 shards x 2 jobs) = 2.25, under 6. Windows is slower: 6, plus 4 of setup.
    { pull: 11, checks: 10, system: "win32", full: false, packages: ["packages/a"] },
    // Linux: (4 + 2 + 2 + 16) / 2 = 12, under 16. Windows: (6 + 3 + 4 + 12 + 6 x 4) / 4 = 12.25. Linux is slower: 16, plus 4.
    { pull: 12, checks: 20, system: "linux", full: true, packages: [] },
    // Nothing to test (docs only): setup alone.
    { pull: 13, checks: 4, full: false, packages: [] },
    // Six 4-minute units on Windows alone: 24 / (2 shards x 2 jobs) = 6, over its longest unit, plus 4.
    { pull: 14, checks: 10, system: "win32", full: false, packages: ["packages/w1", "packages/w2", "packages/w3", "packages/w4", "packages/w5", "packages/w6"] },
  ].map((one) => ({ ...one, setup: { minutes: 4, runs: 0 } })));
});

test("6.10 Each estimate's setup is learned from the week's timed runs: each run's whole time less its own tests' bound, the median of those; the fixed 4 minutes only while no run is recorded, which it says", async (t) => {
  const { db, project } = await store(t);
  await db.query("INSERT INTO ci_readings (project, repository, read_at) VALUES ($1, 'acme/shop', $2)", [project, ago(2)]);
  await db.query("INSERT INTO ci_pull_scopes (project, pull, head_sha, every, dirs, read_at) VALUES ($1, 13, 'h', false, '{}', $2)", [project, ago(2)]);
  // Three passing merge-queue runs; each tests packages/a for 10 minutes on Linux in one job, and takes 10 more beyond it.
  for (const [run, at, beyond] of [[1, DAY, 7], [2, 2 * DAY, 6], [3, 3 * DAY, 9]] as const) {
    await db.query(
      `INSERT INTO ci_runs (project, repository, run_id, attempt, workflow, event, head_sha, created_at, started_at, ended_at, status, conclusion, timed)
        VALUES ($1, 'acme/shop', $2, 1, 'CI', 'merge_group', $3, $4, $4, $5, 'completed', 'success', true)`,
      [project, run, `q${run}`, ago(at + 10 + beyond), ago(at)]);
    await db.query(
      `INSERT INTO ci_unit_times (project, run_id, head_sha, platform, arch, unit, jobs, result, ms, timed_out, at, artifact)
        VALUES ($1, $2, $3, 'linux', 'x64', 'packages/a', 1, 'pass', $4, false, $5, 'test-timings-Linux-1')`, [project, run, `q${run}`, 10 * 60_000, ago(at + 1)]);
  }
  // A docs-only pull request is drawn against the learned setup alone: the median of 7, 6 and 9.
  assert.deepEqual((await ciTimesReading(db, project, NOW))?.legs.pulls, [{ pull: 13, checks: 7, full: false, packages: [], setup: { minutes: 7, runs: 3 } }]);
});
