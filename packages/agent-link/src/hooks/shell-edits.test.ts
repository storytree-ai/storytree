import assert from "node:assert/strict";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
    commit("source.ts", "four", "own write before switching");
    git(root, "switch", "-q", "-c", "keep-own-write");
    assert.deepEqual(edited(), [["source.ts"]], "a switch that retains a just-committed shell write must not hide it");
  });
});

test("3.22 checkout, switch, reset and rebase claim no imported edits, including a reset at the same HEAD; a shell write beside a switch still counts", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    const root = path.join(dir, "repo");
    mkdirSync(root);
    const edited = () => shellEdits(home, root, { session: "one", harness: "codex", source: "hook", kind: "command-run", command: "git", folder: root }).flatMap((line) => line.kind === "file-edited" ? line.files : []);
    const commit = (file: string, text: string) => {
      writeFileSync(path.join(root, file), text);
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", text);
    };
    git(root, "init", "-q", "-b", "main");
    commit("source.ts", "base");
    git(root, "switch", "-q", "-c", "incoming");
    rmSync(path.join(root, "source.ts"));
    commit("incoming.ts", "imported");
    git(root, "switch", "-q", "main");
    assert.deepEqual(edited(), []);

    git(root, "switch", "-q", "-c", "work", "incoming");
    assert.deepEqual(edited(), [], "a branch switch imports additions and deletions");
    writeFileSync(path.join(root, "incoming.ts"), "dirty before checkout");
    assert.deepEqual(edited(), ["incoming.ts"]);
    git(root, "checkout", "-q", "-f", "main");
    assert.deepEqual(edited(), [], "checkout discarding earlier dirt imports no edits either");
    git(root, "reset", "-q", "--hard", "incoming");
    assert.deepEqual(edited(), [], "a reset moving HEAD is not an edit");
    writeFileSync(path.join(root, "incoming.ts"), "own write");
    assert.deepEqual(edited(), ["incoming.ts"]);
    git(root, "reset", "-q", "--hard", "HEAD");
    assert.deepEqual(edited(), [], "discarding dirt at the same HEAD is not an edit");
    writeFileSync(path.join(root, "incoming.ts"), "dirty again");
    assert.deepEqual(edited(), ["incoming.ts"]);
    git(root, "checkout", "-q", "-f", "work");
    assert.deepEqual(edited(), [], "checkout at the same commit also discards dirt without claiming it");
    git(root, "switch", "-q", "-c", "side", "incoming~1");
    writeFileSync(path.join(root, "own.ts"), "own write beside switch");
    assert.deepEqual(edited(), ["own.ts"], "only the shell's own write counts");
    git(root, "add", "own.ts");
    git(root, "commit", "-q", "-m", "own write");
    assert.deepEqual(edited(), []);
    git(root, "rebase", "incoming");
    assert.deepEqual(edited(), [], "replaying the session's commits imports no new edits");
  });
});
