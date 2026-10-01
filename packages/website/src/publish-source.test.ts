import assert from "node:assert/strict";
import { test } from "node:test";
import { publicationBase, publicationSource, websiteChanged } from "./publish-source.js";

const repository = "storytree-ai/storytree";
const head = "a".repeat(40);
const merged = "b".repeat(40);
const run = { conclusion: "success", event: "pull_request", head_sha: head, head_branch: "website", head_repository: { full_name: repository } };
const pr = { merged: true, merge_commit_sha: merged, head: { sha: head, repo: { full_name: repository } }, base: { ref: "main" } };

test("4.3 · successful CI selects the merged commit, including CI's direct merges", () => {
  assert.equal(publicationSource(run, pr), merged);
  assert.equal(publicationSource({ ...run, event: "push", head_branch: "main" }), head);
});

test("4.3 · failed, unmerged, superseded, foreign and queue runs cannot publish", () => {
  assert.equal(publicationSource({ ...run, conclusion: "failure" }, pr), undefined);
  assert.equal(publicationSource(run), undefined);
  assert.equal(publicationSource(run, { ...pr, merged: false }), undefined);
  assert.equal(publicationSource(run, { ...pr, head: { ...pr.head, sha: merged } }), undefined);
  assert.equal(publicationSource(run, { ...pr, base: { ref: "other" } }), undefined);
  assert.equal(publicationSource({ ...run, head_repository: { full_name: "someone/fork" } }, pr), undefined);
  assert.equal(publicationSource(run, { ...pr, head: { ...pr.head, repo: { full_name: "someone/fork" } } }), undefined);
  assert.equal(publicationSource({ ...run, event: "merge_group" }, pr), undefined);
  assert.equal(publicationSource({ ...run, event: "push" }), undefined);
  assert.equal(publicationSource(run, { ...pr, merge_commit_sha: null }), undefined);
});

test("4.3 · website build inputs trigger publishing; unrelated merges do not", () => {
  for (const file of ["packages/website/src/index.html", "packages/website/public/forest.json", "packages/forest-world/src/scene.ts", "README.md", "pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml", "tsconfig.base.json", ".github/workflows/website.yml"]) {
    assert.equal(websiteChanged([file]), true, file);
  }
  assert.equal(websiteChanged(["packages/app/src/view.ts", "stories/forest.md", "AGENTS.md"]), false);
  assert.equal(websiteChanged([]), false);
  assert.equal(websiteChanged(["packages/website-other/src/page.ts"]), false);
});

test("4.3 · a merge is compared with the commit the live site carries, so a website merge whose own run was cancelled still publishes", () => {
  const live = "c".repeat(40);
  const ancestors = new Set([live]);
  const isAncestor = (commit: string) => ancestors.has(commit);
  assert.equal(publicationBase(merged, `${live}\n`, isAncestor), live);
  for (const unreadable of [undefined, "Not found", "unpublished local build", "d".repeat(40)]) {
    assert.equal(publicationBase(merged, unreadable, isAncestor), `${merged}^1`, String(unreadable));
  }
});
