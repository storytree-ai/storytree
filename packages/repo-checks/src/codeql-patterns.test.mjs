// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { describe, sanitizationHits } from "./codeql-patterns.mjs";
import { RULES, lint } from "./lint.mjs";

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
