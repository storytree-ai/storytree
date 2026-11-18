// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import plugin from "./index.mjs";

const rule = plugin.rules["git-end-of-options"];
const code = (line) => line.replaceAll("#", "$").replaceAll("'", "`");
const IMPORT = `import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";\n`;
const refused = (line, count = 1) => ({ code: IMPORT + code(line), errors: Array.from({ length: count }, () => ({ messageId: "unended", line: 2 })) });

test("8.17 · storytree/git-end-of-options refuses a git call passing an input-built argument after clone, fetch, pull, ls-remote or push with no -- before it (execFileSync, spawn, execFile, spawnSync with \"git\", a git(...) wrapper's ternary branches each, runGit(root, ...)), its message naming js/second-order-command-line-injection and to put \"--\" before the argument; -- or --end-of-options first, literals, a refspec or file:// template, an option's value, a spread or ternary of literal lists, a list with no remote subcommand, another tool's pull and a string pass", () => {
  assert.match(rule?.meta?.messages?.unended ?? "", /js\/second-order-command-line-injection/);
  assert.match(rule.meta.messages.unended, /put ["'`]?--["'`]? before/, "names the fix: put -- before the argument");

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("git-end-of-options", rule, {
    valid: [
      String.raw`export const cloned = (url: string, dir: string) => execFileSync("git", ["clone", "--depth", "1", "--", url, dir]);`,
      String.raw`export const fetched = (remote: string) => spawn("git", ["fetch", "--end-of-options", remote]);`,
      String.raw`export const synced = (git: (args: string[]) => string, cond: boolean, folder: string, factory: string) => git(cond ? ["-C", folder, "pull", "--ff-only", "--", factory, "main"] : ["clone", "--depth", "1", "--", factory, folder]);`,
      String.raw`export const heads = (runGit: (...args: string[]) => string, root: string, origin: string) => runGit(root, "ls-remote", "--", origin);`,
      String.raw`export const pushed = (args: string[]) => execFile("git", ["push", "--", ...args]);`,
      String.raw`export const literal = () => execFileSync("git", ["fetch", "--quiet", "origin", "main"]);`,
      String.raw`export const refspec = (main: string) => execFileSync("git", ["fetch", "origin", '+refs/heads/#{main}:refs/remotes/origin/#{main}']);`,
      String.raw`export const local = (x: string) => execFileSync("git", ["clone", 'file://#{x}']);`,
      String.raw`export const shallow = (n: string, url: string) => execFileSync("git", ["clone", "--depth", n, "--", url]);`,
      String.raw`export const branched = (branch: string, url: string) => execFileSync("git", ["clone", "--branch", branch, "--", url]);`,
      String.raw`export const quiet = (q: boolean) => execFileSync("git", ["fetch", ...(q ? ["--quiet"] : []), "origin"]);`,
      String.raw`export const either = (git: (args: string[]) => string, cond: boolean) => git(cond ? ["fetch", "origin"] : ["pull", "origin", "main"]);`,
      String.raw`export const parsed = (git: (args: string[]) => string, ref: string) => git(["rev-parse", ref]);`,
      String.raw`export const adr = (storytree: (args: string[]) => string, id: string) => storytree(["adr", "pull", id]);`,
      String.raw`export const fixture = 'execFileSync("git", ["clone", url, dir])';`,
    ].map((line) => IMPORT + code(line)),
    invalid: [
      refused(String.raw`export const cloned = (url: string, dir: string) => execFileSync("git", ["clone", "--depth", "1", url, dir]);`),
      refused(String.raw`export const fetched = (remote: string) => spawn("git", ["fetch", remote]);`),
      refused(String.raw`export const synced = (git: (args: string[]) => string, cond: boolean, folder: string, factory: string) => git(cond ? ["-C", folder, "pull", "--ff-only", factory, "main"] : ["clone", "--depth", "1", factory, folder]);`, 2),
      refused(String.raw`export const heads = (runGit: (...args: string[]) => string, root: string, origin: string) => runGit(root, "ls-remote", origin);`),
      refused(String.raw`export const pushed = (args: string[]) => execFile("git", ["push", ...args]);`),
      refused(String.raw`export const pulled = (remote: string) => spawnSync("git", ["pull", '#{remote}', "main"]);`),
    ],
  });

  new RuleTester().run("git-end-of-options", rule, {
    valid: [IMPORT + `export const cloned = (url, dir) => execFileSync("git", ["clone", "--", url, dir]);`],
    invalid: [refused(`export const cloned = (url, dir) => execFileSync("git", ["clone", url, dir]);`)],
  });
});
