/** Data schema contract 3.5: a newer-schema refusal helps identify stale running code. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { codeDistance } from "./code-distance.js";

test("3.5 · code distance stays pinned to loaded code after the checkout advances, and follows fetched main", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-code-distance-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Schema test");
    git("config", "user.email", "schema@example.test");
    const source = path.join(folder, "source.ts");
    writeFileSync(source, "// first version\n");
    git("add", "source.ts");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "initial");
    const distance = codeDistance(source);
    assert.equal(distance(), undefined, "origin/main has not been fetched");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    assert.equal(distance(), 0);

    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "one ahead");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    assert.equal(distance(), 1, "advancing the checkout does not update code already loaded");
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "two ahead");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    assert.equal(distance(), 2, "a later fetch changes the reference, not the loaded revision");
    assert.equal(codeDistance(source)(), 0, "restarted code reads the updated checkout");

    const bundle = path.join(folder, "bundle.mjs");
    writeFileSync(bundle, "// installed build of unknown age\n");
    assert.equal(codeDistance(bundle)(), undefined, "an untracked installed bundle cannot borrow a containing checkout's revision");
    git("update-ref", "-d", "refs/remotes/origin/main");
    assert.equal(distance(), undefined, "losing the reference cannot mask the schema refusal");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("3.5 · code outside a checkout has no invented commit distance", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-code-distance-"));
  try {
    const source = path.join(folder, "installed.mjs");
    writeFileSync(source, "// installed build\n");
    assert.equal(codeDistance(source)(), undefined);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
