import assert from "node:assert/strict";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { git, withTempDir } from "../testing/folders.js";
import { shellEdits } from "./shell-edits.js";

test("3.22 a first observation invents no edit, worktrees keep separate baselines, and a failed Git read preserves the last good observation", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    const roots = [path.join(dir, "first"), path.join(dir, "second")];
    const observe = (root: string) => shellEdits(home, root, { session: "one", harness: "codex", source: "hook", kind: "command-run", command: "node script.js", folder: root });
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
    assert.deepEqual(observe(first), []);
    renameSync(path.join(dir, "unavailable-git"), path.join(first, ".git"));
    assert.deepEqual(observe(first).map((line) => line.kind === "file-edited" && line.files), [["file.txt"]]);
  });
});
