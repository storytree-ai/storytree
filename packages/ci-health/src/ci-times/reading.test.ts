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
      for (const table of ["ci_runs", "ci_pulls", "ci_unit_times", "ci_readings"]) await db.query(`DELETE FROM ${table} WHERE project = $1`, [project]);
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
