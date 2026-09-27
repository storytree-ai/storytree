import assert from "node:assert/strict";
import test from "node:test";

import { releaseSource, releaseVersion } from "./release-source.js";

test("4.6 only successful CI for main or the unchanged head of a merged main PR can publish a release", () => {
  const run = { conclusion: "success", event: "pull_request", head_sha: "tested", head_branch: "feature", head_repository: { full_name: "storytree-ai/storytree" } };
  const pr = { merged: true, merge_commit_sha: "merged", head: { sha: "tested", repo: { full_name: "storytree-ai/storytree" } }, base: { ref: "main" } };
  assert.equal(releaseSource(run, pr), "merged");
  assert.equal(releaseSource({ ...run, event: "push", head_branch: "main" }), "tested");
  assert.equal(releaseSource({ ...run, conclusion: "failure" }, pr), undefined);
  assert.equal(releaseSource({ ...run, event: "workflow_dispatch" }, pr), undefined);
  assert.equal(releaseSource(run, { ...pr, merged: false }), undefined);
  assert.equal(releaseSource(run, { ...pr, head: { ...pr.head, sha: "not-tested" } }), undefined);
  assert.equal(releaseSource(run, { ...pr, base: { ref: "another-branch" } }), undefined);
  assert.equal(releaseSource({ ...run, head_repository: { full_name: "fork/storytree" } }, pr), undefined);
  assert.equal(releaseSource({ ...run, event: "push", head_branch: "feature" }), undefined);
});

test("4.6 each later main commit gets a higher release version, while a rerun keeps the same version", () => {
  assert.equal(releaseVersion("0.3.0", 123), "0.3.123");
  assert.equal(releaseVersion("0.3.0", 124), "0.3.124");
  assert.equal(releaseVersion("0.3.0", 123), "0.3.123");
  assert.throws(() => releaseVersion("0.3.0", 0));
});
