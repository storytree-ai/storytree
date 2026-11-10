// Which main commit an own-health run records, and whose CI evidence it credits
// (packages/repo-checks/src/test-run/main-commit.mjs), against a fake Actions API.
import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseRecording } from "./main-commit.mjs";

const repo = { owner: "storytree-ai", repo: "storytree03" };
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const pushRun = (id, sha, conclusion = "success") => ({ id, run_attempt: 1, head_sha: sha, conclusion, event: "push", head_branch: "main", html_url: `https://github.com/storytree-ai/storytree03/actions/runs/${id}` });
const queueRun = (id, sha, conclusion = "success") => ({ id, run_attempt: 2, head_sha: sha, conclusion, event: "merge_group", head_branch: `gh-readonly-queue/main/pr-${id}-${"0".repeat(40)}`, html_url: `https://github.com/storytree-ai/storytree03/actions/runs/${id}` });
const prRun = (id, sha) => ({ id, run_attempt: 1, head_sha: sha, conclusion: "success", event: "pull_request", head_branch: "claude/some-branch", html_url: `https://github.com/storytree-ai/storytree03/actions/runs/${id}` });
const nightlyRun = (id, sha, { conclusion = "success", event = "schedule", branch = "main" } = {}) =>
  ({ id, run_attempt: 3, head_sha: sha, conclusion, event, head_branch: branch, workflow: "macos-nightly.yml", html_url: `https://github.com/storytree-ai/storytree03/actions/runs/${id}` });

/** A fake Octokit: listWorkflowRuns answers from `runs` (each ci.yml's unless it names its workflow), filtered as GitHub filters them; compare answers `status`. */
function github(runs, status = "behind") {
  return {
    rest: {
      actions: {
        listWorkflowRuns: async ({ workflow_id, head_sha, branch, event, status: wanted }) => ({
          data: {
            workflow_runs: runs.filter((run) => (run.workflow ?? "ci.yml") === workflow_id && (head_sha === undefined || run.head_sha === head_sha) && (branch === undefined || run.head_branch === branch) &&
              (event === undefined || run.event === event) && (wanted === undefined || run.conclusion === wanted)),
          },
        }),
      },
      repos: { compareCommitsWithBasehead: async () => ({ data: { status } }) },
    },
  };
}

test("7.3 · main moved on and the commit's push run was cancelled: its own commit is recorded, crediting the merge queue's passing run of that exact commit", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, queueRun(10, A), pushRun(5, C)]), repo, own: A, mainHead: B, triggering: cancelled });
  assert.equal(choice.sha, A);
  assert.equal(choice.run?.id, 10);
  assert.equal(choice.run?.run_attempt, 2);
});

test("7.3 · at main's head, a cancelled push run is not evidence: the queue's passing run of the same commit is credited instead", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, queueRun(10, A)]), repo, own: A, mainHead: A, triggering: cancelled });
  assert.equal(choice.sha, A);
  assert.equal(choice.run?.id, 10);
});

test("7.3 · a passing push run of the commit is credited as before", async () => {
  const passed = pushRun(11, A);
  const choice = await chooseRecording({ github: github([passed]), repo, own: A, mainHead: A, triggering: passed });
  assert.deepEqual([choice.sha, choice.run?.id], [A, 11]);
});

test("7.3 · a pull request's run, a failed queue run or another commit's run never counts: with main moved on and nothing newer passing, nothing is recorded", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const runs = [cancelled, prRun(12, A), queueRun(13, A, "failure"), queueRun(14, C), pushRun(5, C)];
  const choice = await chooseRecording({ github: github(runs, "behind"), repo, own: A, mainHead: B, triggering: cancelled });
  assert.equal(choice.sha, undefined);
  assert.match(choice.notices.join("\n"), /records nothing/);
});

test("7.3 · at main's head with no passing run of its commit, it is still recorded, with no Windows or macOS credit", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, prRun(12, A)]), repo, own: A, mainHead: A, triggering: cancelled });
  assert.equal(choice.sha, A);
  assert.equal(choice.run, undefined);
  assert.match(choice.notices.join("\n"), /No passing CI evidence for a+; Windows-only contracts receive no credit/);
});

test("7.3 · main moved on with no evidence at the commit: main's newest passing push run at or after it is recorded, as before", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, pushRun(20, B)], "ahead"), repo, own: A, mainHead: C, triggering: cancelled });
  assert.deepEqual([choice.sha, choice.run?.id], [B, 20]);
});

test("7.3 · a push run that passed on the merge queue's verdict carries no evidence: the queue's passing run of that commit is credited", async () => {
  const reused = pushRun(11, A);
  const choice = await chooseRecording({ github: github([reused, queueRun(10, A)]), repo, own: A, mainHead: A, triggering: reused });
  assert.deepEqual([choice.sha, choice.run?.id, choice.run?.run_attempt], [A, 10, 2]);
});

test("7.3 · main moved on with no evidence at the commit: the newest passing main commit is credited with its queue run when one passed", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, pushRun(20, B), queueRun(19, B)], "ahead"), repo, own: A, mainHead: C, triggering: cancelled });
  assert.deepEqual([choice.sha, choice.run?.id], [B, 19]);
});

test("7.3 · the nightly macOS run's own recording credits its macOS evidence beside the merge queue's run of the same commit", async () => {
  const nightly = nightlyRun(30, A);
  const choice = await chooseRecording({ github: github([nightly, queueRun(10, A), pushRun(11, A)]), repo, own: A, mainHead: B, triggering: nightly });
  assert.deepEqual([choice.sha, choice.run?.id, choice.macos?.id, choice.macos?.run_attempt], [A, 10, 30, 3]);
});

test("7.3 · a merge's recording credits macOS only from a passing nightly run of main at its exact commit, never one that failed, ran on a branch or tested another commit", async () => {
  const passed = pushRun(11, A);
  const at = async (runs) => (await chooseRecording({ github: github([passed, ...runs]), repo, own: A, mainHead: A, triggering: passed })).macos?.id;
  assert.equal(await at([nightlyRun(30, A, { event: "workflow_dispatch" })]), 30);
  assert.equal(await at([nightlyRun(31, A, { conclusion: "failure" }), nightlyRun(32, A, { branch: "claude/x" }), nightlyRun(33, C)]), undefined);
  assert.equal(await at([]), undefined);
  const none = await chooseRecording({ github: github([passed]), repo, own: A, mainHead: A, triggering: passed });
  assert.match(none.notices.join("\n"), /No passing nightly macOS run tested a+; macOS-only contracts receive no credit/);
  assert.doesNotMatch((await chooseRecording({ github: github([passed, nightlyRun(30, A)]), repo, own: A, mainHead: A, triggering: passed })).notices.join("\n"), /nightly/);
});

test("7.3 · a nightly macOS lookup that fails still records the commit with its Windows evidence, says so, and credits no macOS", async () => {
  const passed = pushRun(11, A);
  const fake = github([passed]);
  const ciRuns = fake.rest.actions.listWorkflowRuns;
  fake.rest.actions.listWorkflowRuns = async (query) => {
    if (query.workflow_id === "macos-nightly.yml") throw new Error("API rate limit exceeded");
    return ciRuns(query);
  };
  const choice = await chooseRecording({ github: fake, repo, own: A, mainHead: A, triggering: passed });
  assert.deepEqual([choice.sha, choice.run?.id, choice.macos], [A, 11, undefined]);
  assert.match(choice.notices.join("\n"), /Could not look for nightly macOS evidence at a+: API rate limit exceeded/);
});
