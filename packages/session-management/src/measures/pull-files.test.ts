/**
 * Capability 20 · Lane measures: contract 20.3, against a real git repository made for the test.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { pullFiles } from "./pull-files.js";

test("20.3 a pull request's changed files are read from its merge commit on the checkout's main line, and one not merged there is not found", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "pull-files-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "pipe" });
  try {
    git("init", "-q", "-b", "main");
    writeFileSync(path.join(folder, "a.ts"), "a\n");
    git("add", "."); git("commit", "-q", "-m", "first");
    git("checkout", "-q", "-b", "feature");
    writeFileSync(path.join(folder, "b.ts"), "b\n");
    writeFileSync(path.join(folder, "a.ts"), "a2\n");
    git("add", "."); git("commit", "-q", "-m", "change");
    git("checkout", "-q", "main");
    writeFileSync(path.join(folder, "c.ts"), "c\n");
    git("add", "."); git("commit", "-q", "-m", "on main meanwhile");
    git("merge", "-q", "--no-ff", "feature", "-m", "Merge pull request #7 from org/feature");

    const filesOf = await pullFiles(folder);
    assert.deepEqual(await filesOf(7), ["a.ts", "b.ts"], "the merge's files against its first parent, not main's own change");
    assert.equal(await filesOf(8), undefined);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
