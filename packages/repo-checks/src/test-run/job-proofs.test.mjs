// Contracts proved by a named workflow job rather than a numbered test (job-proofs.mjs): what own health reads from
// the Actions API, against a fake one, and how that reading changes a story's verdicts.
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyJobProofs, jobProofsFrom, readJobProofs } from "./job-proofs.mjs";

const repo = { owner: "storytree-ai", repo: "storytree" };
const url = (id) => `https://github.com/storytree-ai/storytree/actions/runs/${id}`;

/** A fake Octokit: `runs` per workflow file, newest first, and `jobs` per run id (the latest attempt's), or per `id/attempt`. */
function github({ runs = {}, jobs = {} } = {}) {
  const calls = [];
  const answer = (key) => ({ data: { jobs: jobs[key] ?? [] } });
  return {
    calls,
    rest: {
      actions: {
        listWorkflowRuns: async ({ workflow_id, branch, status }) => {
          calls.push({ workflow_id, branch, status });
          return { data: { workflow_runs: runs[workflow_id] ?? [] } };
        },
        listJobsForWorkflowRun: async ({ run_id }) => answer(String(run_id)),
        listJobsForWorkflowRunAttempt: async ({ run_id, attempt_number }) => answer(`${run_id}/${attempt_number}`),
      },
    },
  };
}

const job = (name, conclusion) => ({ name, conclusion });
const release = (id, sha) => ({ id, head_sha: sha, html_url: url(id) });
const legs = (conclusions) => conclusions.map((conclusion, i) => job(`package / windows-update (${i < 2 ? "windows-latest" : "windows-11-arm"}, ${i % 2 ? "closed" : "open"})`, conclusion));

test("7.16 · CI's installer job in the run own health credits proves 4.43: passing when it succeeded, nothing when it was skipped or there is no run", async () => {
  const run = { id: 10, run_attempt: 2, html_url: url(10) };
  const passed = await readJobProofs({ github: github({ jobs: { "10/2": [job("installer on Windows", "success"), job("verify", "success")] } }), repo, run });
  const proof = passed.proofs.find((p) => p.contract === "4.43");
  assert.equal(proof?.package, "app");
  assert.equal(proof?.state, "passing");
  assert.match(proof.note, /installer on Windows/);
  assert.match(proof.note, /runs\/10/);

  const skipped = await readJobProofs({ github: github({ jobs: { "10/2": [job("installer on Windows", "skipped")] } }), repo, run });
  assert.equal(skipped.proofs.find((p) => p.contract === "4.43"), undefined);
  const none = await readJobProofs({ github: github(), repo, run: undefined });
  assert.equal(none.proofs.find((p) => p.contract === "4.43"), undefined);
});

test("7.16 · the newest release run on main that ran the windows-update legs proves 4.45: passing when every leg that ran succeeded, failing when any failed or timed out", async () => {
  const runs = { "release.yml": [release(3, "c".repeat(40)), release(2, "b".repeat(40)), release(1, "a".repeat(40))] };
  // The newest release ran no legs (its source was skipped), so the one before it is read.
  const passing = await readJobProofs({ github: github({ runs, jobs: { 3: [job("source", "success")], 2: legs(["success", "success", "success", "skipped"]), 1: legs(["failure"]) } }), repo });
  const proof = passing.proofs.find((p) => p.contract === "4.45");
  assert.equal(proof?.package, "app");
  assert.equal(proof?.state, "passing");
  assert.match(proof.note, /windows-update/);
  assert.match(proof.note, /runs\/2/);

  const failing = await readJobProofs({ github: github({ runs, jobs: { 3: legs(["success", "timed_out", "success", "success"]) } }), repo });
  const failed = failing.proofs.find((p) => p.contract === "4.45");
  assert.equal(failed?.state, "failing");
  assert.match(failed.note, /windows-11-arm|windows-latest/);
  assert.match(failed.note, /runs\/3/);

  const cancelled = await readJobProofs({ github: github({ runs: { "release.yml": [release(3, "c".repeat(40))] }, jobs: { 3: legs(["cancelled", "cancelled"]) } }), repo });
  assert.equal(cancelled.proofs.find((p) => p.contract === "4.45"), undefined, "a cancelled leg is no verdict");
});

test("7.16 · an Actions API that cannot be read gives no proof and says why, instead of failing the recording", async () => {
  const broken = { rest: { actions: { listWorkflowRuns: async () => { throw new Error("rate limited"); }, listJobsForWorkflowRun: async () => { throw new Error("rate limited"); }, listJobsForWorkflowRunAttempt: async () => { throw new Error("rate limited"); } } } };
  const read = await readJobProofs({ github: broken, repo, run: { id: 10, run_attempt: 1, html_url: url(10) } });
  assert.deepEqual(read.proofs, []);
  assert.ok(read.notices.some((notice) => /rate limited/.test(notice)));
});

test("7.16 · a job's failure fails its contract even where a test passed; its pass takes a contract its tests left not checked, and leaves a tested pass alone", () => {
  const untested = { number: "4.43", state: "not-checked", passed: 0, failed: 0, skipped: 0, total: 0, reason: "no test ran" };
  const tested = { number: "4.45", state: "passing", passed: 1, failed: 0, skipped: 0, total: 1, note: "1 of 1 passed" };
  const other = { number: "4.1", state: "not-checked", passed: 0, failed: 0, skipped: 0, total: 0, reason: "no test ran" };
  const verdicts = () => new Map([["4.43", { ...untested }], ["4.45", { ...tested }], ["4.1", { ...other }]]);

  const passed = applyJobProofs(verdicts(), "app", [
    { package: "app", contract: "4.43", state: "passing", note: "installer on Windows passed, run 10" },
    { package: "app", contract: "4.45", state: "passing", note: "windows-update passed, run 2" },
    { package: "cli", contract: "4.1", state: "failing", note: "another story's 4.1" },
  ]);
  assert.equal(passed.get("4.43").state, "passing");
  assert.equal(passed.get("4.43").note, "installer on Windows passed, run 10");
  assert.equal(passed.get("4.45").note, "1 of 1 passed", "a tested pass stands");
  assert.equal(passed.get("4.1").state, "not-checked", "a proof for another story's package changes nothing here");

  const failed = applyJobProofs(verdicts(), "app", [{ package: "app", contract: "4.45", state: "failing", note: "windows-update (windows-11-arm, open) failed, run 3" }]);
  assert.equal(failed.get("4.45").state, "failing");
  assert.match(failed.get("4.45").note, /windows-11-arm/);
  assert.equal(failed.get("4.43").state, "not-checked");
});

test("7.16 · the proofs handed to the recording keep only well-formed verdicts; anything else is none", () => {
  const good = { package: "app", contract: "4.43", state: "passing", note: "passed" };
  assert.deepEqual(jobProofsFrom(JSON.stringify([good, { ...good, state: "skipped" }, { contract: "4.45" }])), [good]);
  assert.deepEqual(jobProofsFrom(undefined), []);
  assert.deepEqual(jobProofsFrom(""), []);
  assert.deepEqual(jobProofsFrom("{not json"), []);
});
