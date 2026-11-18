// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import plugin from "./index.mjs";

const rule = plugin.rules["no-one-character-escape"];
const refused = (code, count = 1) => ({ code, errors: Array.from({ length: count }, () => ({ messageId: "oneCharacterEscape", line: 1 })) });

test("8.12 · storytree/no-one-character-escape refuses a replace or replaceAll of a one-character string pattern other than backslash by a backslash-led string (replaceAll(\".\", \"\\\\.\")), each in a chain refused, its message naming js/incomplete-sanitization; a chain escaping backslash first, a pattern of two characters, a replacement without a backslash and a regex pattern pass", () => {
  assert.match(rule?.meta?.messages?.oneCharacterEscape ?? "", /js\/incomplete-sanitization/);

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("no-one-character-escape", rule, {
    valid: [
      String.raw`export const slashes = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll("'", "\\'");`,
      String.raw`export const dashed = (text: string): string => text.replaceAll(".", "-");`,
      String.raw`export const words = (text: string): string => text.replaceAll("ab", "\\ab");`,
      String.raw`export const fixture = "at.replaceAll(\".\", \"\\\\.\")";`,
      String.raw`export const dotted = (at: string): string => at.replace(/\./g, "\\.");`,
    ],
    invalid: [
      refused(String.raw`export const dotted = (at: string): RegExp => new RegExp(at.replaceAll(".", "\\."));`),
      refused(String.raw`export const first = (at: string): RegExp => new RegExp(at.replace(".", "\\."));`),
      refused(String.raw`export const slashed = (at: string): RegExp => new RegExp(at.replaceAll("/", "\\/"));`),
      refused(String.raw`export const quoted = (text: string): string => text.replaceAll("x", "\\x").replaceAll(".", "\\.");`, 2),
    ],
  });

  new RuleTester().run("no-one-character-escape", rule, {
    valid: [String.raw`export const slashes = (text) => text.replaceAll("\\", "\\\\").replaceAll(".", "\\.");`],
    invalid: [refused(String.raw`export const dotted = (at) => at.replaceAll(".", "\\.");`)],
  });
});
