// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import plugin from "./index.mjs";

const rule = plugin.rules["no-partial-regexp-escape"];
const code = (line) => line.replaceAll("#", "$").replaceAll("~", "`");
const refused = (line) => ({ code: code(line), errors: [{ messageId: "partialRegexpEscape", line: 1 }] });

test("8.31 · storytree/no-partial-regexp-escape refuses, as new RegExp(…) or RegExp(…)'s source or an interpolation of it, a replace or replaceAll chain with a backslash-led replacement and no replace by the full idiom (a backslash-only escape, a backslash-first chain, PR #748's version.replaceAll(\".\", \"\\\\.\")), and a quasi ending in an odd backslash run before an interpolation, once each, its message naming escape_159b701eadc6 and /[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\"; the full idiom, a chain starting or ending with it, an interpolation with no replace, a replacement without a backslash, an even backslash run, the chain outside a RegExp and a string literal source pass", () => {
  assert.match(rule?.meta?.messages?.partialRegexpEscape ?? "", /escape_159b701eadc6/);
  assert.ok(rule.meta.messages.partialRegexpEscape.includes(code(String.raw`/[.*+?^#{}()|[\]\\]/g, "\\#&"`)), rule.meta.messages.partialRegexpEscape);

  new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } }).run("no-partial-regexp-escape", rule, {
    valid: [
      String.raw`new RegExp(x.replace(/[.*+?^#{}()|[\]\\]/g, "\\#&"));`,
      String.raw`new RegExp(~a #{x.replace(/[.*+?^#{}()|[\]\\]/g, "\\#&")} b~);`,
      String.raw`new RegExp(x.replaceAll("/", "\\/").replace(/[.*+?^#{}()|[\]\\]/g, "\\#&"));`,
      String.raw`new RegExp(x.replace(/[.*+?^#{}()|[\]\\]/g, "\\#&").replaceAll("/", "\\/"));`,
      String.raw`new RegExp(~id-#{id}~);`,
      String.raw`new RegExp(x.replace(/-/g, "_"));`,
      String.raw`new RegExp(~a\\\\#{x}~);`,
      String.raw`const s = x.replaceAll("\\", "\\\\");`,
      String.raw`new RegExp("a\\.b");`,
    ].map(code),
    invalid: [
      refused(String.raw`new RegExp(x.replaceAll("\\", "\\\\"));`),
      refused(String.raw`new RegExp(~a #{x.replaceAll("\\", "\\\\")} b~);`),
      refused(String.raw`new RegExp(x.replaceAll("\\", "\\\\").replaceAll(".", "\\."));`),
      refused(String.raw`RegExp(x.replace(/\\/g, "\\\\"));`),
      refused(String.raw`new RegExp(~version: #{version.replaceAll(".", "\\.")}(?:\\s|#)~);`),
      refused(String.raw`new RegExp(~["']\\#{extension}["']~);`),
      refused(String.raw`new RegExp(~a\\\\\\#{x}~);`),
    ],
  });

  new RuleTester().run("no-partial-regexp-escape", rule, {
    valid: [code(String.raw`new RegExp(x.replace(/[.*+?^#{}()|[\]\\]/g, "\\#&"));`)],
    invalid: [refused(String.raw`new RegExp(x.replaceAll("\\", "\\\\"));`)],
  });
});
