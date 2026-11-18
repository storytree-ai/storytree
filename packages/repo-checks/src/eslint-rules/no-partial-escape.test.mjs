// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import plugin from "./index.mjs";

const rule = plugin.rules["no-partial-escape"];
const code = (line) => line.replaceAll("#", "$").replaceAll("'", "`");
const refused = (line) => ({ code: code(line), errors: [{ messageId: "partialEscape", line: 1 }] });

test("8.11 · storytree/no-partial-escape refuses a replace or replaceAll by a backslash-led string of a regex of one character, a class or a group of them that misses backslash (PR #724's /\\./g), its message naming js/incomplete-sanitization and the full escape /[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\"; a pattern matching backslash (the full escape, \\\\, a range over it, \\W), a negated class, a chain escaping backslash first, a replacement without a backslash, a one-character string pattern and the pattern in a string or comment pass", () => {
  assert.match(rule?.meta?.messages?.partialEscape ?? "", /js\/incomplete-sanitization/);
  assert.ok(rule.meta.messages.partialEscape.includes(code(String.raw`/[.*+?^#{}()|[\]\\]/g, "\\#&"`)), rule.meta.messages.partialEscape);

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("no-partial-escape", rule, {
    valid: [
      String.raw`export const full = (text: string): string => text.replace(/[.*+?^#{}()|[\]\\]/g, "\\#&");`,
      String.raw`export const slashes = (text: string): string => text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");`,
      String.raw`export const shell = (text: string): string => text.replace(/[\\#']/g, "\\#&");`,
      String.raw`export const wordy = (text: string): string => text.replace(/[\W]/g, "\\#&");`,
      String.raw`export const negated = (text: string): string => text.replace(/[^a-z]/g, "\\#&");`,
      String.raw`export const ranged = (text: string): string => text.replace(/[!-~]/g, "\\#&");`,
      String.raw`export const dashed = (text: string): string => text.replace(/\./g, "-");`,
      String.raw`export const fixture = "at.replace(/\\./g, \"\\\\.\")";`,
      String.raw`export const said = 1;` + "\n" + String.raw`// at.replace(/\./g, "\\.")`,
      String.raw`export const dotted = (at: string): string => at.replaceAll(".", "\\.");`,
    ].map(code),
    invalid: [
      refused(String.raw`export const dotted = (at: string): RegExp => new RegExp(at.replace(/\./g, "\\."));`),
      refused(String.raw`export const listed = (text: string): string => text.replace(/[.*+?^#{}()|[\]]/g, "\\#&");`),
      refused(String.raw`export const grouped = (text: string): string => text.replace(/([."])/g, "\\#1");`),
      refused(String.raw`export const quoted = (text: string): string => text.replaceAll(new RegExp("\"", "g"), "\\\"");`),
    ],
  });

  new RuleTester().run("no-partial-escape", rule, {
    valid: [code(String.raw`export const full = (text) => text.replace(/[.*+?^#{}()|[\]\\]/g, "\\#&");`)],
    invalid: [refused(String.raw`export const dotted = (at) => at.replace(/\./g, "\\.");`)],
  });
});
