import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import plugin from "./index.mjs";

const rule = plugin.rules["gh-number-names-repo"];
const at = (file) => path.join(process.cwd(), file);
const MERGES = at("packages/session-management/src/claims/merges.ts");
const WATCH = at("packages/agent-pool/src/watch.mjs");
const ARCS = at("packages/arc-surface/src/verbs/arcs.ts");
const OTHER = at("packages/x/src/y.mjs");
const IMPORT = `import { execFile } from "node:child_process";\n`;
const code = (line) => IMPORT + line.replaceAll("#{", "${").replaceAll("'", "`");
const refused = (line, filename = MERGES, count = 1) => ({ code: code(line), filename, errors: Array.from({ length: count }, () => ({ messageId: "unnamed", line: 2 })) });
const passes = (line, filename = MERGES) => ({ code: code(line), filename });
const OPENER = String.raw`export const deps = (run, repo) => ({ openerOf: async (pr) => (await run("gh", ["pr", "view", pr, "--json", "author"], { cwd: repo })).stdout });`;
const MERGED = String.raw`export function mergedPull(folder: string, number: string) { execFile("gh", ["pr", "view", number, "--json", "state"], { cwd: folder }, () => {}); }`;

test("8.37 · storytree/gh-number-names-repo refuses, in any call's array argument, a gh pr or issue subcommand taking a number (view, checks, merge, issue view) followed by a non-literal element (a name, String(pr), a template) with no -R or --repo, including the drill's ask(command, [...prefix, ...]) shape and execFile and run wrappers; its message names escape_20e13274224a and to pass -R with the repository; -R, --repo, --repo=…, a ternary spread of a literal list holding -R, a literal number, pr list, pr create and a string pass; openerOf in packages/agent-pool/src/watch.mjs and mergedPull in packages/arc-surface/src/verbs/arcs.ts pass, the same code in another file or function is refused", () => {
  const message = rule?.meta?.messages?.unnamed ?? "";
  assert.match(message, /escape_20e13274224a/);
  assert.match(message, /\bpass\b[^.]*-R\b/, "says to pass -R");
  assert.match(message, /repositor/, "says -R names the repository");

  new RuleTester({ cwd: process.cwd(), languageOptions: { parserOptions: { lang: "ts" } } }).run("gh-number-names-repo", rule, {
    valid: [
      passes(String.raw`export const state = (run, pr, repo) => run("gh", ["pr", "view", String(pr), "-R", repo, "--json", "state"]);`),
      passes(String.raw`export const state = (run, n, repo) => run("gh", ["pr", "view", n, "--repo", repo]);`),
      passes(String.raw`export const state = (run, n, repo) => run("gh", ["pr", "view", n, '--repo=#{repo}']);`),
      passes(String.raw`export const own = (run, pr, on, VIEW) => run("gh", ["pr", "view", String(pr), ...(on ? ["-R", on] : []), ...VIEW]);`),
      passes(String.raw`export const five = (run) => run("gh", ["pr", "view", "5"]);`),
      passes(String.raw`export const listed = (run) => run("gh", ["pr", "list", "--json", "number"]);`),
      passes(String.raw`export const opened = (run, t) => run("gh", ["pr", "create", "--title", t]);`),
      passes(String.raw`export const fixture = 'execFile("gh", ["pr", "view", number, "--json", "state"])';`),
      passes(OPENER, WATCH),
      passes(MERGED, ARCS),
    ],
    invalid: [
      refused(String.raw`export const asked = (ask, command, prefix, number, env, folder) => ask(command, [...prefix, "pr", "view", number, "--json", "state"], env, 1, { cwd: folder, shell: false });`),
      refused(String.raw`export const state = (number: string, folder: string) => execFile("gh", ["pr", "view", number, "--json", "state"], { cwd: folder });`),
      refused(String.raw`export const checks = (run, pr) => run("gh", ["pr", "checks", String(pr)]);`),
      refused(String.raw`export const merged = (run, pr) => run("gh", ["pr", "merge", pr, "--merge"]);`),
      refused(String.raw`export const issue = (run, n) => run("gh", ["issue", "view", n]);`),
      refused(String.raw`export const templated = (run, n) => run("gh", ["pr", "view", '#{n}']);`),
      refused(OPENER, OTHER),
      refused(MERGED, at("packages/x/src/y.ts")),
      refused(String.raw`export const deps = (run, repo) => ({ authorOf: async (pr) => (await run("gh", ["pr", "view", pr, "--json", "author"], { cwd: repo })).stdout });`, WATCH),
      refused(String.raw`export function closedPull(folder: string, number: string) { execFile("gh", ["pr", "view", number, "--json", "state"], { cwd: folder }, () => {}); }`, ARCS),
    ],
  });
});
