// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import plugin from "./index.mjs";

const rule = plugin.rules["diff-follows-renames"];
const code = (line) => line.replaceAll("#", "$").replaceAll("'", "`");
const IMPORT = `import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";\n`;
const refused = (line) => ({ code: IMPORT + code(line), errors: [{ messageId: "unfollowed", line: 2 }] });

test("8.38 · storytree/diff-follows-renames refuses a git call reading added lines, added files or each file's status or counts without following renames (escape_3bdd35178213's diff -U0 --no-renames, push-check's diff-tree --no-renames --diff-filter=AM, the factory pull's git(\"diff\", \"--name-status\", \"--no-renames\", from, to), a diff --name-status, --numstat or --raw --no-renames, code-measures' log --numstat --no-renames churn read, a log --name-status or -p --no-renames, a --cached --name-only --no-renames --diff-filter=AM, --no-renames beside --unified=0, -p or --patch, and diff-tree, diff-index or diff-files with -p, --name-status or an A filter and no -M, through git(root, ...), git(...), git([...]), runGit, ops.git, execFileSync, spawnSync, execFile and spawn), its message naming escape_3bdd35178213 and -M; a --name-only or status --no-renames read, a --name-status --no-renames --diff-filter=D, a D or M filter, -M, -M50% or --find-renames on diff or log, a porcelain diff or log with no --no-renames, a plumbing --name-only with no A filter, a string holding such a call and a non-git callee pass", () => {
  assert.match(rule?.meta?.messages?.unfollowed ?? "", /escape_3bdd35178213/);
  assert.match(rule.meta.messages.unfollowed, /(?<![\w-])-M\b/, "names the fix: follow renames with -M");

  new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } }).run("diff-follows-renames", rule, {
    valid: [
      String.raw`export const scoped = (git: (args: string[]) => string, mergeBase: string) => git(["diff", "--name-only", "--no-renames", "-z", mergeBase]);`,
      String.raw`export const kept = (git: (args: string[]) => string, base: string) => git(["diff", "--name-status", "--no-renames", "--diff-filter=D", "-z", base]);`,
      String.raw`export const churn = (git: (folder: string, args: string[]) => Promise<string>, folder: string, since: string, sha: string) => git(folder, ["log", "--numstat", "-M", "--format=", '--since=#{since}', sha, "--", "packages"]);`,
      String.raw`export const history = (git: (args: string[]) => string, commit: string) => git(["log", "--first-parent", "-M", "--name-status", "--format=%H", commit]);`,
      String.raw`export const porcelainLog = (git: (args: string[]) => string, commit: string) => git(["log", "--name-status", "--format=%H", commit]);`,
      String.raw`export const statusFollowed = (git: (args: string[]) => string, from: string, to: string) => git(["diff", "--name-status", "-M", "-z", from, to]);`,
      String.raw`export const statusPorcelain = (git: (args: string[]) => string, from: string, to: string) => git(["diff", "--name-status", "-z", from, to]);`,
      String.raw`export const dirty = (git: (args: string[]) => string) => git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]);`,
      String.raw`export const lines = (git: (...args: string[]) => string, root: string, base: string) => git(root, "diff", "-U0", "-M", "--no-color", base);`,
      String.raw`export const porcelain = (runGit: (...args: string[]) => string, root: string, base: string) => runGit(root, "diff", "-U0", "--no-color", base);`,
      String.raw`export const tree = (git: (args: string[]) => string, commit: string) => git(["diff-tree", "-r", "-z", "-M", "--no-commit-id", "--diff-filter=AMR", commit]);`,
      String.raw`export const found = (git: (args: string[]) => string, commit: string) => git(["diff-tree", "-r", "-z", "--find-renames", "--no-commit-id", "--diff-filter=AMR", commit]);`,
      String.raw`export const half = (git: (args: string[]) => string, commit: string) => git(["diff-tree", "-r", "-z", "-M50%", "--diff-filter=AMR", commit]);`,
      String.raw`export const staged = () => execFileSync("git", ["diff", "--cached", "--name-only", "-M", "--diff-filter=AMR", "-z"]);`,
      String.raw`export const deleted = (git: (args: string[]) => string, base: string) => git(["diff", "--no-renames", "--diff-filter=D", "-z", base]);`,
      String.raw`export const modified = (git: (args: string[]) => string, base: string) => git(["diff", "-U0", "--no-renames", "--diff-filter=M", base]);`,
      String.raw`export const names = (git: (args: string[]) => string, commit: string) => git(["diff-tree", "-r", "--name-only", "--no-commit-id", commit]);`,
      String.raw`export const fixture = 'git(["diff", "-U0", "--no-renames", base])';`,
      String.raw`export const other = (storytree: (args: string[]) => string) => storytree(["diff", "-U0", "--no-renames"]);`,
    ].map((line) => IMPORT + code(line)),
    invalid: [
      refused(String.raw`export const added = (git: (...args: string[]) => string, root: string, base: string) => git(root, "-c", "core.quotePath=false", "diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", base);`),
      refused(String.raw`export const pushed = (git: (args: string[]) => string, commit: string) => git(["diff-tree", "-r", "-z", "--root", "-m", "--first-parent", "--no-renames", "--no-commit-id", "--diff-filter=AM", commit]);`),
      refused(String.raw`export const staged = () => execFileSync("git", ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=AM", "-z"]);`),
      refused(String.raw`export const unified = (runGit: (...args: string[]) => string, root: string, base: string) => runGit(root, "diff", "--unified=0", "--no-renames", base);`),
      refused(String.raw`export const patched = (ops: { git: (args: string[]) => string }, base: string) => ops.git(["diff", "-p", "--no-renames", base]);`),
      refused(String.raw`export const patch = (base: string) => spawnSync("git", ["diff", "--patch", "--no-renames", base]);`),
      refused(String.raw`export const plumbing = (git: (args: string[]) => string, commit: string) => git(["diff-tree", "-r", "-p", commit]);`),
      refused(String.raw`export const created = (git: (args: string[]) => string, commit: string) => git(["diff-tree", "-r", "--diff-filter=A", commit]);`),
      refused(String.raw`export const index = () => execFile("git", ["diff-index", "--cached", "-p", "HEAD"]);`),
      refused(String.raw`export const files = () => spawn("git", ["diff-files", "-p"]);`),
      refused(String.raw`export const pulled = (git: (...args: string[]) => string, from: string, to: string) => git("diff", "--name-status", "--no-renames", from, to);`),
      refused(String.raw`export const status = (folder: string, from: string, to: string) => spawnSync("git", ["-C", folder, "diff", "--name-status", "--no-renames", "-z", from, to]);`),
      refused(String.raw`export const counts = (git: (args: string[]) => string, base: string) => git(["diff", "--numstat", "--no-renames", base]);`),
      refused(String.raw`export const churn = (git: (folder: string, args: string[]) => Promise<string>, folder: string, since: string, sha: string) => git(folder, ["log", "--numstat", "--no-renames", "--format=", '--since=#{since}', sha, "--", "packages"]);`),
      refused(String.raw`export const history = (git: (args: string[]) => string, commit: string) => git(["log", "--name-status", "--no-renames", "--format=%H", commit]);`),
      refused(String.raw`export const patches = (git: (args: string[]) => string, commit: string) => git(["log", "-p", "--no-renames", commit]);`),
      refused(String.raw`export const treeStatus = (git: (args: string[]) => string, commit: string) => git(["diff-tree", "-r", "--name-status", commit]);`),
      refused(String.raw`export const raw = (git: (args: string[]) => string, base: string) => git(["diff", "--raw", "--no-renames", base]);`),
    ],
  });
});
