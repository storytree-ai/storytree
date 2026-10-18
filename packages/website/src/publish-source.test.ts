import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("4.3 · failed, unmerged, superseded, foreign and unmatched queue runs cannot publish", () => {
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

// The live site skipped these merges even though it bundles both packages.
test("4.3 · the forest changes from PR #646 publish the website", () => {
  for (const file of [
    "packages/forest/src/view/island-overlays.tsx",
    "packages/forest/src/view/nameplates.ts",
    "packages/forest/src/view/planet-view.tsx",
    "packages/forest/src/view/styles.css",
  ]) assert.equal(websiteChanged([file]), true, file);
});

test("4.3 · the knowledge-core changes from PR #667 publish the website", () => {
  for (const file of [
    "packages/knowledge-core/src/look-inside/look-inside.ts",
    "packages/knowledge-core/src/reads/reads.ts",
    "packages/knowledge-core/src/view/globe-points.tsx",
    "packages/knowledge-core/src/view/surface.tsx",
  ]) assert.equal(websiteChanged([file]), true, file);
});

test("4.3 · publishing follows package manifests transitively, including cycles, without including unrelated packages", t => {
  const root = mkdtempSync(join(tmpdir(), "website-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = (directory: string, contents: object) => {
    const file = join(root, directory, "package.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(contents));
  };
  manifest("packages/website", {
    name: "@storytree/website", dependencies: { "@example/view": "workspace:*", react: "^19" },
    devDependencies: { "@example/build": "workspace:*" },
  });
  // Package names need not match their directories; the graph comes from the manifests.
  manifest("packages/drawing", {
    name: "@example/view", dependencies: { "@example/data": "workspace:*" },
  });
  manifest("apps/data", {
    name: "@example/data", dependencies: { "@example/view": "workspace:*" },
    optionalDependencies: { "@example/optional": "workspace:*" },
    peerDependencies: { "@example/peer": "workspace:*" },
  });
  for (const name of ["build", "optional", "peer", "unrelated"])
    manifest(`packages/${name}`, { name: `@example/${name}` });

  for (const directory of ["packages/website", "packages/drawing", "apps/data", "packages/build", "packages/optional", "packages/peer"]) {
    assert.equal(websiteChanged([`${directory}/src/index.ts`], root), true, directory);
    assert.equal(websiteChanged([`${directory}/package.json`], root), true, directory);
  }
  for (const file of ["packages/unrelated/src/index.ts", "packages/drawing-other/src/index.ts", "packages/forest-world/src/scene.ts"])
    assert.equal(websiteChanged([file], root), false, file);

  manifest("packages/drawing", { name: "@example/view" });
  assert.equal(websiteChanged(["apps/data/src/index.ts"], root), false, "removing a dependency changes the publication scope");
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

// Chapter 1: PR CI finished before the merge queue landed, then main CI was cancelled.
// Successful queue CI 36962398897 tested this exact commit; PR #503 later confirmed its merge.
test("4.3 · a successful queue run publishes once its exact tested commit is confirmed merged into main", () => {
  const queueSha = "124d21fb8dbdbafc5d443aff8773222092f13a9c";
  const queue = { ...run, event: "merge_group", head_sha: queueSha,
    head_branch: "gh-readonly-queue/main/pr-503-4558b679060cd175c220a9b07416a1b55c13a88b" };
  const mergedPr = { ...pr, merge_commit_sha: queueSha,
    head: { ...pr.head, sha: "01277aa9e9c3da9485c37c2672fe1be6ccaaee26" } };
  assert.equal(publicationSource(queue), undefined, "queue CI may finish before merge");
  assert.equal(publicationSource(queue, { ...mergedPr, merged: false }), undefined);
  assert.equal(publicationSource(queue, mergedPr), queueSha);
  assert.equal(publicationSource(queue, { ...mergedPr, merge_commit_sha: merged }), undefined);
  assert.equal(publicationSource(queue, { ...mergedPr, base: { ref: "release" } }), undefined);
  assert.equal(publicationSource(queue, { ...mergedPr, head: { ...pr.head, repo: { full_name: "someone/fork" } } }), undefined);
  assert.equal(publicationSource({ ...queue, conclusion: "failure" }, mergedPr), undefined);
  assert.equal(publicationSource({ ...queue, head_repository: { full_name: "someone/fork" } }, mergedPr), undefined);
});
