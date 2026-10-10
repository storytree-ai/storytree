// Which main commit an own-health run records, and whose CI evidence it credits
// (packages/dev-loop/src/own-health-commit.mjs), against a fake Actions API.
import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseRecording } from "./own-health-commit.mjs";

const repo = { owner: "storytree-ai", repo: "storytree03" };
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const pushRun = (id, sha, conclusion = "success") => ({ id, run_attempt: 1, head_sha: sha, conclusion, event: "push", head_branch: "main", html_url: `https://github.com/storytree-ai/storytree03/actions/runs/${id}` });
const queueRun = (id, sha, conclusion = "success") => ({ id, run_attempt: 2, head_sha: sha, conclusion, event: "merge_group", head_branch: `gh-readonly-queue/main/pr-${id}-${"0".repeat(40)}`, html_url: `https://github.com/storytree-ai/storytree03/actions/runs/${id}` });
const prRun = (id, sha) => ({ id, run_attempt: 1, head_sha: sha, conclusion: "success", event: "pull_request", head_branch: "claude/some-branch", html_url: `https://github.com/storytree-ai/storytree03/actions/runs/${id}` });

/** A fake Octokit: listWorkflowRuns answers from `runs`, filtered as GitHub filters them; compare answers `status`. */
function github(runs, status = "behind") {
  return {
    rest: {
      actions: {
        listWorkflowRuns: async ({ head_sha, branch, event, status: wanted }) => ({
          data: {
            workflow_runs: runs.filter((run) => (head_sha === undefined || run.head_sha === head_sha) && (branch === undefined || run.head_branch === branch) &&
              (event === undefined || run.event === event) && (wanted === undefined || run.conclusion === wanted)),
          },
        }),
      },
      repos: { compareCommitsWithBasehead: async () => ({ data: { status } }) },
    },
  };
}

test("5.7 · main moved on and the commit's push run was cancelled: its own commit is recorded, crediting the merge queue's passing run of that exact commit", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, queueRun(10, A), pushRun(5, C)]), repo, own: A, mainHead: B, triggering: cancelled });
  assert.equal(choice.sha, A);
  assert.equal(choice.run?.id, 10);
  assert.equal(choice.run?.run_attempt, 2);
});

test("5.7 · at main's head, a cancelled push run is not evidence: the queue's passing run of the same commit is credited instead", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, queueRun(10, A)]), repo, own: A, mainHead: A, triggering: cancelled });
  assert.equal(choice.sha, A);
  assert.equal(choice.run?.id, 10);
});

test("5.7 · a passing push run of the commit is credited as before", async () => {
  const passed = pushRun(11, A);
  const choice = await chooseRecording({ github: github([passed]), repo, own: A, mainHead: A, triggering: passed });
  assert.deepEqual([choice.sha, choice.run?.id], [A, 11]);
});

test("5.7 · a pull request's run, a failed queue run or another commit's run never counts: with main moved on and nothing newer passing, nothing is recorded", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const runs = [cancelled, prRun(12, A), queueRun(13, A, "failure"), queueRun(14, C), pushRun(5, C)];
  const choice = await chooseRecording({ github: github(runs, "behind"), repo, own: A, mainHead: B, triggering: cancelled });
  assert.equal(choice.sha, undefined);
  assert.match(choice.notices.join("\n"), /records nothing/);
});

test("5.7 · at main's head with no passing run of its commit, it is still recorded, with no Windows or macOS credit", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, prRun(12, A)]), repo, own: A, mainHead: A, triggering: cancelled });
  assert.equal(choice.sha, A);
  assert.equal(choice.run, undefined);
});

test("5.7 · main moved on with no evidence at the commit: main's newest passing push run at or after it is recorded, as before", async () => {
  const cancelled = pushRun(11, A, "cancelled");
  const choice = await chooseRecording({ github: github([cancelled, pushRun(20, B)], "ahead"), repo, own: A, mainHead: C, triggering: cancelled });
  assert.deepEqual([choice.sha, choice.run?.id], [B, 20]);
});
