// Capability 8 · Storytree's own test and gate entries. increment_15f747652fc7: a CodeQL pattern a pull request met
// (PR #489's tag-stripping replace, incomplete multi-character sanitization) is refused by `pnpm lint` before CodeQL sees it;
// increment_171a0ab97911 adds PR #724's partial backslash escape (incomplete sanitization).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { describe, sanitizationHits } from "./codeql-patterns.mjs";
import { RULES, lint } from "./lint.mjs";

const STRIPS = `export const plain = (html: string): string => html.replace(/<[^>]+>/g, "");
export const uncommented = (html: string): string => html.replaceAll(/<!--[\\s\\S]*?-->/g, '');
export const unscripted = (html: string): string => html.replace(new RegExp("<script[^>]*>", "gi"), \`\`);
export const bracketed = (html: string): string => html["replace"](/<[^>]+>/g, "");
${"\n".repeat(5)}export const tenth = (html: string): string => html.replace(/<\\/?b>/g, "");
`;

const PASSES = `export const spaced = (html: string): string => html.replace(/<[^>]+>/g, " ");
export const once = (html: string): string => html.replace(/<svg[\\s\\S]*<\\/svg>/, "");
export const escaped = (text: string): string => text.replace(/</g, "&lt;").replace(/>/g, "");
export const split = (html: string): string => html.split(/<[^>]*>/).join("");
export const angles = (text: string): string => text.replace(/<+/g, "");
export const fixture = 'html.replace(/<[^>]+>/g, "")';
export function settled(html: string): string {
  let before;
  do {
    before = html;
    html = html.replace(/<[^>]*>/g, "");
  } while (html !== before);
  return html;
}
`;

test("8.9 pnpm lint refuses a global replace that removes an HTML tag or comment, CodeQL's incomplete multi-character sanitization, naming file and line; a spaced, single or repeated replace, an escape, a split, a run of < alone and a file that cannot be parsed pass", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codeql-patterns-"));
  t.after(() => removeTemp(root));
  mkdirSync(path.join(root, "packages", "view", "src"), { recursive: true });
  writeFileSync(path.join(root, "packages", "view", "src", "strip.ts"), STRIPS);
  writeFileSync(path.join(root, "packages", "view", "src", "pass.ts"), PASSES);
  mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "dep", "index.js"), STRIPS);
  writeFileSync(path.join(root, "packages", "view", "src", "broken.ts"), 'html.replace(/<[^>]+>/g, "") ))) {{{\n');

  const lines = [];
  const code = await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => lines.push(line) });
  assert.equal(code, 1, lines.join("\n"));
  const refused = lines.filter((line) => line.startsWith("codeql-patterns: "));
  assert.deepEqual(refused.map((line) => /^codeql-patterns: (\S+:\d+) /.exec(line)?.[1]), ["packages/view/src/strip.ts:1", "packages/view/src/strip.ts:2", "packages/view/src/strip.ts:3", "packages/view/src/strip.ts:4", "packages/view/src/strip.ts:10"], lines.join("\n"));
  assert.match(refused[0], /incomplete-multi-character-sanitization/, "names the CodeQL rule it stands in for");

  writeFileSync(path.join(root, "packages", "view", "src", "strip.ts"), "export {};\n");
  const clean = [];
  assert.equal(await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => clean.push(line) }), 0, clean.join("\n"));
});

/** A code file's text, written raw with `#` standing for `$` (a template literal would read `${`) and `'` for a backtick. */
const code = (lines) => lines.map((line) => line.replaceAll("#", "$").replaceAll("'", "`")).join("\n");

const PARTIAL = code([
  String.raw`export const dotted = (at: string): RegExp => new RegExp(at.replace(/\./g, "\\."));`,
  String.raw`export const listed = (text: string): string => text.replace(/[.*+?^#{}()|[\]]/g, "\\#&");`,
  String.raw`export const grouped = (text: string): string => text.replace(/([."])/g, "\\#1");`,
  String.raw`export const quoted = (text: string): string => text.replaceAll(new RegExp("\"", "g"), "\\\"");`,
]);

const ESCAPES = code([
  String.raw`export const full = (text: string): string => text.replace(/[.*+?^#{}()|[\]\\]/g, "\\#&");`,
  String.raw`export const slashes = (text: string): string => text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");`,
  String.raw`export const shell = (text: string): string => text.replace(/[\\#']/g, "\\#&");`,
  String.raw`export const wordy = (text: string): string => text.replace(/[\W]/g, "\\#&");`,
  String.raw`export const negated = (text: string): string => text.replace(/[^a-z]/g, "\\#&");`,
  String.raw`export const ranged = (text: string): string => text.replace(/[!-~]/g, "\\#&");`,
  String.raw`export const dashed = (text: string): string => text.replace(/\./g, "-");`,
  String.raw`export const fixture = "at.replace(/\\./g, \"\\\\.\")";`,
]);

test("8.11 · pnpm lint refuses a replace that escapes some characters by a backslash and misses backslash itself (PR #724's /\\./g, a class or group of them), CodeQL's incomplete sanitization, naming file and line; an escape whose pattern matches backslash, a replacement without a backslash and a string pass", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codeql-patterns-"));
  t.after(() => removeTemp(root));
  mkdirSync(path.join(root, "packages", "view", "src"), { recursive: true });
  writeFileSync(path.join(root, "packages", "view", "src", "partial.test.ts"), PARTIAL);
  writeFileSync(path.join(root, "packages", "view", "src", "full.ts"), ESCAPES);

  const lines = [];
  const exit = await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => lines.push(line) });
  assert.equal(exit, 1, lines.join("\n"));
  const refused = lines.filter((line) => line.startsWith("codeql-patterns: "));
  assert.deepEqual(refused.map((line) => /^codeql-patterns: (\S+:\d+) /.exec(line)?.[1]), ["packages/view/src/partial.test.ts:1", "packages/view/src/partial.test.ts:2", "packages/view/src/partial.test.ts:3", "packages/view/src/partial.test.ts:4"], lines.join("\n"));
  assert.match(refused[0], /js\/incomplete-sanitization/, "names the CodeQL rule it stands in for");
  assert.ok(refused[0].includes(code([String.raw`/[.*+?^#{}()|[\]\\]/g, "\\#&"`])), "points at the full escape");
});

const STRING_PARTIAL = code([
  String.raw`export const dotted = (at: string): RegExp => new RegExp(at.replaceAll(".", "\\."));`,
  String.raw`export const first = (at: string): RegExp => new RegExp(at.replace(".", "\\."));`,
  String.raw`export const slashed = (at: string): RegExp => new RegExp(at.replaceAll("/", "\\/"));`,
  String.raw`export const quoted = (text: string): string => text.replaceAll("x", "\\x").replaceAll(".", "\\.");`,
]);

const STRING_ESCAPES = code([
  String.raw`export const slashes = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll("'", "\\'");`,
  String.raw`export const dashed = (text: string): string => text.replaceAll(".", "-");`,
  String.raw`export const words = (text: string): string => text.replaceAll("ab", "\\ab");`,
]);

test("8.12 · pnpm lint refuses a replace of a one-character string pattern other than backslash by a backslash-led string (replaceAll(\".\", \"\\\\.\")), CodeQL's incomplete sanitization, naming file and line; a chain that escapes backslash first and a replacement without a backslash pass", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codeql-patterns-"));
  t.after(() => removeTemp(root));
  mkdirSync(path.join(root, "packages", "view", "src"), { recursive: true });
  writeFileSync(path.join(root, "packages", "view", "src", "partial.test.ts"), STRING_PARTIAL);
  writeFileSync(path.join(root, "packages", "view", "src", "full.ts"), STRING_ESCAPES);

  const lines = [];
  const exit = await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => lines.push(line) });
  assert.equal(exit, 1, lines.join("\n"));
  const refused = lines.filter((line) => line.startsWith("codeql-patterns: "));
  assert.deepEqual(refused.map((line) => /^codeql-patterns: (\S+:\d+) /.exec(line)?.[1]), ["packages/view/src/partial.test.ts:1", "packages/view/src/partial.test.ts:2", "packages/view/src/partial.test.ts:3", "packages/view/src/partial.test.ts:4", "packages/view/src/partial.test.ts:4"], lines.join("\n"));
  assert.match(refused[0], /js\/incomplete-sanitization/, "names the CodeQL rule it stands in for");
});

// increment_6f5baa5be4ed: PR #988's clone, CodeQL's js/second-order-command-line-injection. Each refused call is on a
// line of its own, so the refusals name exactly these lines (a ternary of two refused lists may name its line twice).
const UNENDED = code([
  String.raw`import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";`,
  String.raw`export const cloned = (url: string, dir: string) => execFileSync("git", ["clone", "--depth", "1", url, dir]);`,
  String.raw`export const fetched = (remote: string) => spawn("git", ["fetch", remote]);`,
  String.raw`export const synced = (git: (args: string[]) => string, cond: boolean, folder: string, factory: string) => git(cond ? ["-C", folder, "pull", "--ff-only", factory, "main"] : ["clone", "--depth", "1", factory, folder]);`,
  String.raw`export const heads = (runGit: (...args: string[]) => string, root: string, origin: string) => runGit(root, "ls-remote", origin);`,
  String.raw`export const pushed = (args: string[]) => execFile("git", ["push", ...args]);`,
  String.raw`export const pulled = (remote: string) => spawnSync("git", ["pull", '#{remote}', "main"]);`,
]);

const ENDED = code([
  String.raw`import { execFile, execFileSync, spawn } from "node:child_process";`,
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
]);

test("8.17 · pnpm lint refuses a git call passing an input-built argument after a remote subcommand (clone, fetch, pull, ls-remote, push) with no -- before it, CodeQL's second-order command-line injection (PR #988's clone), naming file, line and the fix; the same calls with -- or --end-of-options, literals, a refspec or file:// template, an option's value, a spread or ternary of literal lists, a list with no remote subcommand and a string pass", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codeql-patterns-"));
  t.after(() => removeTemp(root));
  mkdirSync(path.join(root, "packages", "tools", "src"), { recursive: true });
  writeFileSync(path.join(root, "packages", "tools", "src", "remote.ts"), UNENDED);
  writeFileSync(path.join(root, "packages", "tools", "src", "ended.ts"), ENDED);

  const lines = [];
  const exit = await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => lines.push(line) });
  assert.equal(exit, 1, lines.join("\n"));
  const refused = lines.filter((line) => line.startsWith("codeql-patterns: "));
  assert.deepEqual([...new Set(refused.map((line) => /^codeql-patterns: (\S+:\d+) /.exec(line)?.[1]))], ["packages/tools/src/remote.ts:2", "packages/tools/src/remote.ts:3", "packages/tools/src/remote.ts:4", "packages/tools/src/remote.ts:5", "packages/tools/src/remote.ts:6", "packages/tools/src/remote.ts:7"], lines.join("\n"));
  for (const line of refused) {
    assert.match(line, /js\/second-order-command-line-injection/, "names the CodeQL rule it stands in for");
    assert.match(line, /["'`]?--["'`]? before/, "names the fix: -- before the argument");
  }

  writeFileSync(path.join(root, "packages", "tools", "src", "remote.ts"), "export {};\n");
  const clean = [];
  assert.equal(await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => clean.push(line) }), 0, clean.join("\n"));
});

// increment_b3e14f7421a6: PR #989's three regexes (CodeQL's js/polynomial-redos, packages/code-measures churn.ts,
// read.ts and source.ts), verbatim, and one built from a string with the same flaw, a refused regex a line from line 2.
// The fixtures are text written to files, so this file holds none of them as a live regex.
const OVERLAPPING = [
  "// PR #989's regexes, before they were fixed",
  String.raw`export const renamed = (path: string) => /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);`,
  String.raw`export const window = (text: string) => /^\s*(\d+)\s*([dw]?)\s*$/i.exec(text);`,
  String.raw`export const header = (text: string) => /^(?:#![^\n]*\n)?(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))+/.exec(text);`,
  String.raw`export const braced = new RegExp("^(.*)\\{(.*)\\}$");`,
].join("\n");

const DISJOINT = [
  String.raw`export const listed = (text: string) => text.split(/\s*,\s*/);`,
  String.raw`export const braced = (text: string) => /^([^{]*)\{([^}]*)\}$/.exec(text);`,
  String.raw`export const trimmed = (text: string) => text.replace(/^\s+|\s+$/g, "");`,
  String.raw`export const window = (text: string) => /^\s*(\d+)\s*([dw]?)$/i.exec(text);`,
  String.raw`export const shown = "/^(.*)\\{(.*) => (.*)\\}(.*)$/";`,
  String.raw`// /^\s*(\d+)\s*([dw]?)\s*$/i was read.ts's before it was fixed`,
].join("\n");

test("8.18 · pnpm lint refuses a regex whose repeated parts overlap so it can backtrack super-linearly (PR #989's three regexes and one new RegExp of a string), CodeQL's polynomial ReDoS, one refusal a regex naming file, line, the regex and the fix (disjoint parts), its hit of kind redos; parts kept apart by a character neither matches, alternatives, one \\s* removed and a regex in a string or comment pass", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codeql-patterns-"));
  t.after(() => removeTemp(root));
  mkdirSync(path.join(root, "packages", "measures", "src"), { recursive: true });
  writeFileSync(path.join(root, "packages", "measures", "src", "overlap.ts"), OVERLAPPING);
  writeFileSync(path.join(root, "packages", "measures", "src", "disjoint.ts"), DISJOINT);

  assert.deepEqual(sanitizationHits("packages/measures/src/overlap.ts", OVERLAPPING).map(({ line, kind }) => ({ line, kind })), [2, 3, 4, 5].map((line) => ({ line, kind: "redos" })), "the push check counts these hits");
  assert.deepEqual(sanitizationHits("packages/measures/src/disjoint.ts", DISJOINT), []);

  const lines = [];
  const exit = await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => lines.push(line) });
  assert.equal(exit, 1, lines.join("\n"));
  const refused = lines.filter((line) => line.startsWith("codeql-patterns: "));
  assert.deepEqual(refused.map((line) => /^codeql-patterns: (\S+:\d+) /.exec(line)?.[1]), ["packages/measures/src/overlap.ts:2", "packages/measures/src/overlap.ts:3", "packages/measures/src/overlap.ts:4", "packages/measures/src/overlap.ts:5"], lines.join("\n"));
  const shown = [String.raw`/^(.*)\{(.*)`, String.raw`/^\s*(\d+)\s`, String.raw`/^(?:#![^\n]`, String.raw`/^(.*)\{(.*)`];
  refused.forEach((line, at) => {
    assert.match(line, /js\/polynomial-redos/, "names the CodeQL rule it stands in for");
    assert.ok(line.includes(shown[at]), `names the regex ${shown[at]}: ${line}`);
    assert.match(line, /disjoint/, "names the fix: make the repeated parts match disjoint characters");
  });

  writeFileSync(path.join(root, "packages", "measures", "src", "overlap.ts"), "export {};\n");
  const clean = [];
  assert.equal(await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => clean.push(line) }), 0, clean.join("\n"));
});

// The narrowing of 8.18: CodeQL's rule fires only on a regex run over outside input, which a test's assertion and a
// vendored bundle never are, and a regex no input can make fail, or one holding a negative lookaround, is not refused.
const BRACES = String.raw`export const braced = (text: string) => /^(.*)\{(.*)\}$/.exec(text);` + "\n";

const UNFAILING = [
  String.raw`export const bullet = (text: string) => text.replace(/^\s*·?\s*/, "");`,
  String.raw`export const unless = (text: string) => /^(?!x)(.*)\{(.*)\}$/.exec(text);`,
].join("\n");

test("8.18 · pnpm lint does not read test files (*.test.*, *.spec.*) or minified bundles (*.min.js) for an overlapping regex, while the same regex in a source file is refused; a regex no input can make fail (/^\\s*·?\\s*/) and one holding a negative lookaround pass", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codeql-patterns-"));
  t.after(() => removeTemp(root));
  const src = path.join(root, "packages", "measures", "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(path.join(src, "braces.ts"), BRACES);
  writeFileSync(path.join(src, "braces.test.ts"), BRACES);
  writeFileSync(path.join(src, "braces.spec.ts"), BRACES);
  writeFileSync(path.join(src, "braces.test.mjs"), String.raw`export const braced = (text) => /^(.*)\{(.*)\}$/.exec(text);` + "\n");
  writeFileSync(path.join(src, "unfailing.ts"), UNFAILING);
  mkdirSync(path.join(root, "packages", "sketches", "vendor"), { recursive: true });
  writeFileSync(path.join(root, "packages", "sketches", "vendor", "sketch.min.js"), String.raw`var b=function(t){return/^(.*)\{(.*)\}$/.exec(t)};export{b};` + "\n");

  const lines = [];
  const exit = await lint({ root, rules: RULES.filter(({ name }) => name === "codeql-patterns"), log: (line) => lines.push(line) });
  assert.equal(exit, 1, lines.join("\n"));
  const refused = lines.filter((line) => line.startsWith("codeql-patterns: "));
  assert.deepEqual(refused.map((line) => /^codeql-patterns: (\S+:\d+) /.exec(line)?.[1]), ["packages/measures/src/braces.ts:1"], lines.join("\n"));
  assert.match(refused[0], /js\/polynomial-redos/);
});

// Each refused regex below backtracks super-linearly on a long run of its string followed by a character that ends
// the match: the em dash is outside ASCII; each backreference can match empty, so the \w parts either side of it meet;
// -* can match empty, so the two \s* meet. The last can never fail: [\s\S]* takes the whole input and $ holds there.
const REACHED = [
  String.raw`export const rule = (text: string) => /^(—+)\s*(—*)$/.exec(text);`,
  String.raw`export const twice = (text: string) => /^(\w*)\1\w*$/.exec(text);`,
  String.raw`export const named = (text: string) => /^(?<word>\w*)\k<word>\w*$/.exec(text);`,
  String.raw`export const item = (text: string) => /^\s*-*\s*(\w+)$/.exec(text);`,
  String.raw`export const whole = (text: string) => /^([\s\S]*)\s*$/.exec(text);`,
].join("\n");

test("8.18 · an overlapping regex's hit names the string both parts repeat: — for /^(—+)\\s*(—*)$/ (a character outside ASCII), a for a numbered (\\1) and a named (\\k<word>) backreference between two \\w*, a space for two \\s* with only -* between them, and its refusal says a run of that string; /^([\\s\\S]*)\\s*$/, whose match no input can make fail, passes", () => {
  const hits = sanitizationHits("packages/measures/src/reached.ts", REACHED);
  assert.deepEqual(hits.map(({ line, kind, regex, pump }) => ({ line, kind, regex, pump })), [
    { line: 1, kind: "redos", regex: "/^(—+)\\s*(—*)$/", pump: "—" },
    { line: 2, kind: "redos", regex: "/^(\\w*)\\1\\w*$/", pump: "a" },
    { line: 3, kind: "redos", regex: "/^(?<word>\\w*)\\k<word>\\w*$/", pump: "a" },
    { line: 4, kind: "redos", regex: "/^\\s*-*\\s*(\\w+)$/", pump: " " },
  ]);
  assert.deepEqual(hits.map((hit) => /a run of (".*?") can be split/.exec(describe(hit))?.[1]), ['"—"', '"a"', '"a"', '" "']);
});
