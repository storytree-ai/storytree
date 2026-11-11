// Capability 8 · Storytree's own test and gate entries. increment_15f747652fc7: a CodeQL pattern a pull request met
// (PR #489's tag-stripping replace, incomplete multi-character sanitization) is refused by `pnpm lint` before CodeQL sees it;
// increment_171a0ab97911 adds PR #724's partial backslash escape (incomplete sanitization).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

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
