// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import * as oxlint from "../oxlint.mjs";
import plugin from "./index.mjs";

const rule = plugin.rules["one-form-command-line"];
const at = (file) => path.join(process.cwd(), file);
const SOURCE = at("packages/base-dev-loop/src/unit-run.mjs");
const HEADER = [
  `import { readFileSync } from "node:fs";`,
  `import { readFile } from "node:fs/promises";`,
  `import { join } from "node:path";`,
].join("\n");
const code = (line) => line.replaceAll("#{", "${").replaceAll("'", "`");
const source = (...lines) => [HEADER, ...lines.map(code)].join("\n");
const refused = (text, line = 4, filename = SOURCE) => ({ code: text, filename, errors: [{ messageId: "unmatched", line }] });
const passes = (text, filename = SOURCE) => ({ code: text, filename });
const ESCAPE = `export const alive = (tree, file) => tree.some((row) => row.commandLine?.includes(file) === true);`;

test("8.36 · storytree/one-form-command-line refuses, in a non-test source file under packages/ or apps/, an .includes, .endsWith, .startsWith or .indexOf call, or an === or !== comparison, whose receiver or operand is a process command line (a member .commandLine or .CommandLine, or a read of /proc/<pid>/cmdline) not first put in forward-slash form; its message names escape_d5ad2f7cc448 and to put both sides in one form (repo-relative, forward slashes); a normalised command line, a .args array, a value that is no command line, and a test file pass", () => {
  const message = rule?.meta?.messages?.unmatched ?? "";
  assert.match(message, /escape_d5ad2f7cc448/);
  assert.match(message, /forward slash/i, "says to use forward slashes");
  assert.match(message, /repo-relative/i, "says to compare repo-relative paths");
  assert.match(message, /\bone form\b/i, "says to put both sides in one form");

  new RuleTester({ cwd: process.cwd() }).run("one-form-command-line", rule, {
    valid: [
      passes(source(String.raw`export const alive = (tree, relative) => tree.some((row) => row.commandLine?.replaceAll("\\", "/").includes(relative) === true);`)),
      passes(source(String.raw`export const alive = (row, x) => row.CommandLine.replace(/\\/g, "/").includes(x);`)),
      passes(source(String.raw`export const ends = (row, x) => row.commandLine.split("\\").join("/").endsWith(x);`)),
      passes(source(String.raw`export const own = (proc, pid, x) => readFileSync('/proc/#{pid}/cmdline', "utf8").replaceAll("\\", "/").includes(x);`)),
      passes(source(`export const hooked = (hook, x) => hook.args.includes(x);`)),
      passes(source(`export const named = (row, x) => row.name.includes(x);`)),
      passes(source(`export const same = (row, x) => row.name === x;`)),
      passes(source(`export const sandboxOff = (app) => app.commandLine.hasSwitch("no-sandbox");`)),
      passes(source(ESCAPE), at("packages/x/src/a.test.mjs")),
      passes(source(ESCAPE), at("scripts/x.mjs")),
      passes(source(ESCAPE), at("docs/packages/x.mjs")),
    ],
    invalid: [
      refused(source(ESCAPE)),
      refused(source(`export const ends = (row, x) => row.CommandLine.endsWith(x);`)),
      refused(source(`export const starts = (row, x) => row.CommandLine.startsWith(x);`)),
      refused(source(`export const found = (row, x) => row.CommandLine.indexOf(x) !== -1;`)),
      refused(source(`export const same = (row, file) => row.commandLine === file;`)),
      refused(source(`export const other = (row, file) => file !== row.CommandLine;`)),
      refused(source(`export const isOurs = (pid, x) => readFileSync('/proc/#{pid}/cmdline', "utf8").includes(x);`)),
      refused(source(`export const isOurs = async (pid, x) => (await readFile('/proc/#{pid}/cmdline', "utf8")).endsWith(x);`)),
      refused(source(`export const scan = (tree, file) => {`, `  const found = tree.filter((row) => row.commandLine.includes(file));`, `  return found;`, `};`), 5),
      refused(source(ESCAPE), 4, at("apps/desktop/src/main/runs.mjs")),
    ],
  });

  new RuleTester({ cwd: process.cwd(), languageOptions: { parserOptions: { lang: "ts" } } }).run("one-form-command-line", rule, {
    valid: [passes(String.raw`export const alive = (tree: { commandLine?: string }[], file: string) => tree.some((row) => row.commandLine?.replaceAll("\\", "/").includes(file) === true);`, at("apps/desktop/src/main/runs.ts"))],
    invalid: [refused(`export const alive = (tree: { commandLine?: string }[], file: string) => tree.some((row) => row.commandLine?.includes(file) === true);`, 1, at("apps/desktop/src/main/runs.ts"))],
  });
});

test("8.36 · through pnpm lint's config, the escape's own command-line match in a package's source is one storytree/one-form-command-line hit at its line naming escape_d5ad2f7cc448, and the same text in a test file or outside packages/ and apps/ is none", () => {
  const named = oxlint.ruleHits(["packages/base-dev-loop/src/unit-run.mjs", "packages/base-dev-loop/src/unit-run.test.mjs", "scripts/unit-run.mjs"].map((file) => ({ file, text: source(ESCAPE) })))
    .map((hits) => hits.filter(({ rule: id }) => id === "storytree/one-form-command-line"));
  const [hits, inTest, outside] = named;
  assert.deepEqual(hits.map(({ line }) => line), [4]);
  assert.match(hits[0].message, /escape_d5ad2f7cc448/);
  assert.deepEqual(inTest, []);
  assert.deepEqual(outside, []);
});
