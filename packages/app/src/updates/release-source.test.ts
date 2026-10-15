import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { releaseSource, releaseVersion, versionAt } from "./release-source.js";
import { sourceVersion } from "./version.js";

test("4.6 only main's own successful CI run of a commit can publish it, never a pull request's run", () => {
  const run = { conclusion: "success", event: "push", head_sha: "tested", head_branch: "main", head_repository: { full_name: "storytree-ai/storytree" } };
  assert.equal(releaseSource(run), "tested");
  assert.equal(releaseSource({ ...run, conclusion: "failure" }), undefined);
  assert.equal(releaseSource({ ...run, conclusion: "cancelled" }), undefined);
  assert.equal(releaseSource({ ...run, conclusion: null }), undefined);
  assert.equal(releaseSource({ ...run, head_branch: "feature" }), undefined);
  assert.equal(releaseSource({ ...run, head_repository: { full_name: "fork/storytree" } }), undefined);
  assert.equal(releaseSource({ ...run, event: "workflow_dispatch" }), undefined);
  assert.equal(releaseSource({ ...run, event: "merge_group", head_branch: "gh-readonly-queue/main/pr-1-abc" }), undefined);
  assert.equal(releaseSource({ ...run, event: "pull_request", head_branch: "main" }), undefined);
});

test("4.6 each later main commit gets a higher release version, while a rerun keeps the same version", () => {
  assert.equal(releaseVersion("0.3.0", 123), "0.3.123");
  assert.equal(releaseVersion("0.3.0", 124), "0.3.124");
  assert.equal(releaseVersion("0.3.0", 123), "0.3.123");
  assert.throws(() => releaseVersion("0.3.0", 0));
});

test("4.6 a build run from a storytree checkout reports the release version its commit would carry, and its short commit", () => {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  assert.deepEqual(sourceVersion(), { version: versionAt(git, "HEAD"), commit: git("rev-parse", "--short=7", "HEAD") });
});
