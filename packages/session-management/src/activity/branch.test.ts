import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { git, withTempDir } from "@storytree/project-and-caller/testing/folders";
import { currentBranch } from "./branch.js";

test("3.16 the branch a line records is the one its folder's worktree is on: a linked worktree's own, from a subfolder too, and none on a detached head", async () => {
  await withTempDir((dir) => {
    const main = path.join(dir, "main");
    mkdirSync(main);
    git(main, "init", "-q", "-b", "main");
    writeFileSync(path.join(main, "a.txt"), "a\n");
    git(main, "add", ".");
    git(main, "commit", "-q", "-m", "first");
    const linked = path.join(dir, "linked");
    git(main, "worktree", "add", "-q", "-b", "claude/fix-login", linked);
    const inPackage = path.join(linked, "packages", "forest");
    mkdirSync(inPackage, { recursive: true });

    assert.equal(currentBranch(main), "main");
    assert.equal(currentBranch(linked), "claude/fix-login");
    assert.equal(currentBranch(inPackage), "claude/fix-login");
    git(linked, "switch", "-q", "--detach");
    assert.equal(currentBranch(linked), undefined);
    assert.equal(currentBranch(main), "main");
  });
});
