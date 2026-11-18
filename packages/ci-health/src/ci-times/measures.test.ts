// Capability 6 · CI times
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { connect, type Storytree } from "@storytree/library";
import { removeTemp } from "@storytree/test-waits";

import { CI_TIME_MEASURE_READERS } from "./measures.js";
import { ciTimesPool } from "./store.js";

const COMMITTED = new Date("2025-03-10T12:00:00Z");
const before = (minutes: number) => new Date(COMMITTED.getTime() - minutes * 60_000);
const DAY = 24 * 60;

interface Sampler {
  readonly measure: string;
  readonly version: number;
  sample(at: { folder: string; commit: string; tree: unknown; project: string; server: Storytree }): Promise<{ value: number; runs: number; spread: number } | undefined>;
}

function committedAt(t: TestContext, when: string): { folder: string; commit: string } {
  const folder = mkdtempSync(path.join(tmpdir(), "ci-time-measure-"));
  t.after(() => removeTemp(folder));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(folder, "README.md"), "fixture\n");
  git("add", "-A");
  git("-c", "user.name=CI time test", "-c", "user.email=ci-time@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "one commit");
  return { folder, commit: git("rev-parse", "HEAD") };
}

test("6.11 · CI_TIME_MEASURE_READERS is one reader at a positive whole version, declared under storytree.measures, whose sample reads the project's CI times through the server and answers the median minutes of the passing pull-request and merge-queue heads created in the 7 days before the commit's committed time, each timed by its longest run, with runs their count and spread the longest less the shortest; a project with none there, or none kept, answers undefined", async (t) => {
  assert.equal(CI_TIME_MEASURE_READERS.length, 1, "one reader");
  const [reader] = CI_TIME_MEASURE_READERS as unknown as readonly Sampler[];
  assert.ok(reader !== undefined);
  assert.equal(typeof reader.measure, "string");
  assert.ok(reader.measure.length > 0, "the reader names its measure");
  assert.ok(Number.isInteger(reader.version) && reader.version > 0, `version ${reader.version} is a positive whole number`);
  assert.equal(typeof reader.sample, "function");

  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { exports: Record<string, string>; storytree: { measures?: { from: string; export: string }[] } };
  assert.deepEqual(manifest.storytree.measures, [{ from: "./measures", export: "CI_TIME_MEASURE_READERS" }]);
  assert.equal(manifest.exports["./measures"], "./src/ci-times/measures.ts");

  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const server = await connect({ url });
  const db = await ciTimesPool(server);
  const project = `t-${randomBytes(4).toString("hex")}`;
  const neighbour = `t-${randomBytes(4).toString("hex")}`;
  const empty = `t-${randomBytes(4).toString("hex")}`;
  const outside = `t-${randomBytes(4).toString("hex")}`;
  t.after(async () => {
    try {
      for (const one of [project, neighbour, outside]) await db.query("DELETE FROM ci_runs WHERE project = $1", [one]);
    } finally {
      await server.close();
    }
  });

  let id = 0;
  const run = async (fields: { project?: string; event: string; sha: string; createdBefore: number; minutes: number; status?: string; conclusion?: string; workflow?: string }) => {
    const ended = (fields.status ?? "completed") === "completed";
    await db.query(
      `INSERT INTO ci_runs (project, repository, run_id, attempt, workflow, event, pull, head_sha, created_at, started_at, ended_at, status, conclusion)
        VALUES ($1, 'acme/shop', $2, 1, $3, $4, NULL, $5, $6, $6, $7, $8, $9)`,
      [fields.project ?? project, ++id, fields.workflow ?? "CI", fields.event, fields.sha, before(fields.createdBefore),
        ended ? before(fields.createdBefore - fields.minutes) : null, fields.status ?? "completed", ended ? fields.conclusion ?? "success" : null],
    );
  };
  await run({ event: "pull_request", sha: "a", createdBefore: DAY, minutes: 10 });
  await run({ event: "pull_request", sha: "b", createdBefore: 2 * DAY, minutes: 12 });
  await run({ event: "pull_request", sha: "b", createdBefore: 2 * DAY, minutes: 3, workflow: "Capability list", conclusion: "skipped" });
  await run({ event: "merge_group", sha: "q1", createdBefore: 3 * DAY, minutes: 20 });
  await run({ event: "merge_group", sha: "q2", createdBefore: 4 * DAY, minutes: 15 });
  await run({ event: "pull_request", sha: "edge", createdBefore: 7 * DAY - 60, minutes: 30 });
  await run({ event: "merge_group", sha: "red", createdBefore: DAY, minutes: 9, conclusion: "failure" });
  await run({ event: "pull_request", sha: "half", createdBefore: DAY, minutes: 5 });
  await run({ event: "pull_request", sha: "half", createdBefore: DAY, minutes: 2, workflow: "Capability list", conclusion: "failure" });
  await run({ event: "pull_request", sha: "going", createdBefore: DAY, minutes: 40 });
  await run({ event: "pull_request", sha: "going", createdBefore: DAY, minutes: 0, workflow: "Capability list", status: "in_progress" });
  await run({ event: "pull_request", sha: "after", createdBefore: -60, minutes: 2 });
  await run({ event: "pull_request", sha: "old", createdBefore: 7 * DAY + 60, minutes: 1 });
  await run({ project: outside, event: "pull_request", sha: "early", createdBefore: 8 * DAY, minutes: 6 });
  await run({ project: outside, event: "merge_group", sha: "late", createdBefore: -DAY, minutes: 7 });
  await run({ project: neighbour, event: "pull_request", sha: "theirs", createdBefore: DAY, minutes: 1 });

  const { folder, commit } = committedAt(t, COMMITTED.toISOString());
  const tree = { arcs: [], stories: [] };
  assert.deepEqual(await reader.sample({ folder, commit, tree, project, server }), { value: 15, runs: 5, spread: 20 },
    "passing heads of 10, 12 (its longest run), 20, 15 and 30 minutes: not the red, the half-red, the unfinished, the one after the commit, the one over 7 days before, nor another project's");
  assert.equal(await reader.sample({ folder, commit, tree, project: empty, server }), undefined, "no CI times kept for the project: no reading");
  assert.equal(await reader.sample({ folder, commit, tree, project: outside, server }), undefined, "runs only outside the 7 days before the commit: no reading");
});
