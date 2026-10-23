// Whether CI's push run on main may stand on the merge queue's verdict (packages/dev-loop/src/queue-verdict.mjs),
// against a fake Actions API.
import assert from "node:assert/strict";
import { test } from "node:test";

import { queueVerdict } from "./queue-verdict.mjs";

const repo = { owner: "storytree-ai", repo: "storytree03" };
const A = "a".repeat(40);
const B = "b".repeat(40);

const run = (id, sha, event = "merge_group", attempt = 1) => ({ id, run_attempt: attempt, head_sha: sha, event,
  head_branch: event === "merge_group" ? `gh-readonly-queue/main/pr-${id}-${"0".repeat(40)}` : event === "push" ? "main" : "claude/branch" });

/** A fake Octokit: runs filtered as GitHub filters them, and each run's latest jobs from `jobs` by run id. */
function github(runs, jobs, { fail } = {}) {
  return {
    rest: {
      actions: {
        listWorkflowRuns: async ({ head_sha, event }) => {
          if (fail) throw new Error(fail);
          return { data: { workflow_runs: runs.filter((r) => r.head_sha === head_sha && (event === undefined || r.event === event)) } };
        },
        listJobsForWorkflowRun: async ({ run_id }) => ({ data: { jobs: jobs[run_id] ?? [] } }),
      },
    },
  };
}

const verify = (conclusion, status = "completed") => [{ name: "verify on Linux", status: "completed", conclusion: "success" }, { name: "verify", status, conclusion }];

test("7.9 · a push to main stands on the merge queue's run of that exact commit once its verify passed, naming the run and attempt", async () => {
  const verdict = await queueVerdict({ github: github([run(10, A, "merge_group", 2)], { 10: verify("success") }), repo, sha: A });
  assert.deepEqual(verdict.run, { id: 10, attempt: 2 });
});

test("7.9 · a queue run whose verify failed or has not finished, another commit's queue run, or a pull request's run leaves the push to test in full", async () => {
  const runs = [run(10, A), run(11, A), run(12, B), run(13, A, "pull_request")];
  const jobs = { 10: verify("failure"), 11: verify(null, "in_progress"), 12: verify("success"), 13: verify("success") };
  const verdict = await queueVerdict({ github: github(runs, jobs), repo, sha: A });
  assert.equal(verdict.run, undefined);
  assert.match(verdict.reason, /in full/);
});

test("7.9 · when the Actions API cannot be read, the push tests in full and says why", async () => {
  const verdict = await queueVerdict({ github: github([], {}, { fail: "rate limited" }), repo, sha: A });
  assert.equal(verdict.run, undefined);
  assert.match(verdict.reason, /rate limited/);
});
