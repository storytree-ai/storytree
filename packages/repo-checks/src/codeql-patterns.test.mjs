// Capability 8 · Storytree's own test and gate entries. increment_15f747652fc7: a CodeQL pattern a pull request met
// (PR #489's tag-stripping replace, incomplete multi-character sanitization) is refused by `pnpm lint` before CodeQL sees it.
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
