import assert from "node:assert/strict";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { git, withTempDir } from "../testing/folders.js";
import { shellEdits } from "./shell-edits.js";

test("3.22 a first observation invents no edit, worktrees keep separate baselines, and a failed Git read preserves the last good observation and says why", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    const roots = [path.join(dir, "first"), path.join(dir, "second")];
    const failures: Error[] = [];
    const observe = (root: string) => shellEdits(home, root, { session: "one", harness: "codex", source: "hook", kind: "command-run", command: "node script.js", folder: root }, (error) => failures.push(error as Error));
    for (const root of roots) {
      mkdirSync(root);
      git(root, "init", "-b", "unborn");
      writeFileSync(path.join(root, "file.txt"), "existing dirty file");
      assert.deepEqual(observe(root), []);
    }
    const [first, second] = roots as [string, string];
    writeFileSync(path.join(first, "file.txt"), "written by the command");
    assert.deepEqual(observe(second), []);
    assert.deepEqual(observe(first).map((line) => line.kind === "file-edited" && line.files), [["file.txt"]]);
    assert.deepEqual(observe(first), []);

    renameSync(path.join(first, ".git"), path.join(dir, "unavailable-git"));
    writeFileSync(path.join(first, "file.txt"), "written while Git was unavailable");
    assert.deepEqual(failures, []);
    assert.deepEqual(observe(first), []);
    assert.equal(failures.length, 1);
    renameSync(path.join(dir, "unavailable-git"), path.join(first, ".git"));
    assert.deepEqual(observe(first).map((line) => line.kind === "file-edited" && line.files), [["file.txt"]]);
    assert.equal(failures.length, 1);
  });
});

test("3.22 a clean pull, fast-forward or merge invents no edit for the files Git imported, while writes committed in the same command still count", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    const root = path.join(dir, "repo");
    mkdirSync(root);
    const edited = () => shellEdits(home, root, { session: "one", harness: "codex", source: "hook", kind: "command-run", command: "git", folder: root }).map((line) => line.kind === "file-edited" && line.files);
    const commit = (file: string, text: string, message: string) => {
      writeFileSync(path.join(root, file), text);
      git(root, "add", file);
      git(root, "commit", "-q", "-m", message);
    };
    git(root, "init", "-q", "-b", "main");
    commit("source.ts", "one", "start");
    commit("other.ts", "one", "other");
    git(root, "checkout", "-q", "-b", "incoming");
    commit("source.ts", "two", "incoming change");
    git(root, "checkout", "-q", "main");
    assert.deepEqual(edited(), []);

    git(root, "merge", "-q", "--ff-only", "incoming");
    assert.deepEqual(edited(), []);

    git(root, "checkout", "-q", "-b", "side", "main~1");
    commit("side.ts", "side", "side change");
    git(root, "checkout", "-q", "main");
    assert.deepEqual(edited(), []);
    git(root, "merge", "-q", "--no-edit", "side");
    assert.deepEqual(edited(), []);

    git(root, "checkout", "-q", "-b", "upstream", "main~1");
    commit("upstream.ts", "upstream", "upstream change");
    git(root, "checkout", "-q", "main");
    assert.deepEqual(edited(), []);
    git(root, "pull", "-q", "--no-rebase", "--no-edit", ".", "upstream");
    assert.deepEqual(edited(), []);

    git(root, "checkout", "-q", "upstream");
    commit("later.ts", "later", "later upstream change");
    git(root, "checkout", "-q", "main");
    assert.deepEqual(edited(), []);
    commit("source.ts", "three", "the session's own change");
    git(root, "merge", "-q", "--no-edit", "upstream");
    assert.deepEqual(edited(), [["source.ts"]]);
  });
});
