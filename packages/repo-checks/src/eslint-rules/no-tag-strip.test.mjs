// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import plugin from "./index.mjs";

const rule = plugin.rules["no-tag-strip"];
const refused = (code, line = 1) => ({ code, errors: [{ messageId: "tagStrip", line }] });

test("8.9 · storytree/no-tag-strip refuses a global replace or replaceAll by \"\" of a regex starting with < (a literal, new RegExp(\"<script[^>]*>\", \"gi\") and html[\"replace\"]), its message naming js/incomplete-multi-character-sanitization and the fix; a spaced replacement, a non-global replace, an escape, a split, a run of < alone, the pattern in a string or comment and a replace repeated in a while, do-while or for loop pass", () => {
  assert.match(rule?.meta?.messages?.tagStrip ?? "", /js\/incomplete-multi-character-sanitization/);
  assert.match(rule.meta.messages.tagStrip, /repeat/i, "names the fix: repeat the replace until nothing changes");

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("no-tag-strip", rule, {
    valid: [
      `export const spaced = (html: string): string => html.replace(/<[^>]+>/g, " ");`,
      String.raw`export const once = (html: string): string => html.replace(/<svg[\s\S]*<\/svg>/, "");`,
      `export const escaped = (text: string): string => text.replace(/</g, "&lt;").replace(/>/g, "");`,
      `export const split = (html: string): string => html.split(/<[^>]*>/).join("");`,
      `export const angles = (text: string): string => text.replace(/<+/g, "");`,
      `export const fixture = 'html.replace(/<[^>]+>/g, "")';`,
      `export const said = 1;\n// html.replace(/<[^>]+>/g, "")`,
      [
        "export function settled(html: string): string {",
        "  let before;",
        "  do {",
        "    before = html;",
        `    html = html.replace(/<[^>]*>/g, "");`,
        "  } while (html !== before);",
        "  return html;",
        "}",
      ].join("\n"),
      [
        "export function drained(html: string): string {",
        `  while (/<[^>]*>/.test(html)) html = html.replace(/<[^>]*>/g, "");`,
        "  return html;",
        "}",
      ].join("\n"),
      [
        "export function looped(html: string): string {",
        `  for (let before = ""; before !== html; ) {`,
        "    before = html;",
        `    html = html.replace(/<[^>]*>/g, "");`,
        "  }",
        "  return html;",
        "}",
      ].join("\n"),
    ],
    invalid: [
      refused(`export const plain = (html: string): string => html.replace(/<[^>]+>/g, "");`),
      refused(String.raw`export const uncommented = (html: string): string => html.replaceAll(/<!--[\s\S]*?-->/g, '');`),
      refused("export const unscripted = (html: string): string => html.replace(new RegExp(\"<script[^>]*>\", \"gi\"), ``);"),
      refused(`export const bracketed = (html: string): string => html["replace"](/<[^>]+>/g, "");`),
      refused(`${"\n".repeat(9)}export const tenth = (html: string): string => html.replace(/<\\/?b>/g, "");`, 10),
    ],
  });

  new RuleTester().run("no-tag-strip", rule, {
    valid: [`export const spaced = (html) => html.replace(/<[^>]+>/g, " ");`],
    invalid: [refused(`export const plain = (html) => html.replace(/<[^>]+>/g, "");`)],
  });
});
