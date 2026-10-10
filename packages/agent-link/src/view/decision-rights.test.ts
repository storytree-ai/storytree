import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionRights } from "../settings/decision-rights.js";
import { renderDecisionRights } from "./decision-rights.js";

test("10.14 the app shows who decides what, read-only, from the card's own lines, with the project's standing delegations when it has them", () => {
  const split = decisionRights();
  const html = renderDecisionRights({ delegations: "1. Reversible engineering <choices>.\n2. Built looks." });
  for (const line of [...split.decides, ...split.asks, ...split.honesty]) {
    assert.ok(html.toLowerCase().includes(escape(line).toLowerCase()), `shows "${line}"`);
  }
  assert.ok(html.includes(escape(split.override)), "says the user's instructions file overrides it");
  assert.ok(html.includes(escape(split.delegations)), "says agents check the standing delegations first");
  assert.match(html, /Reversible engineering &lt;choices&gt;\./, "shows the project's register, escaped");
  assert.doesNotMatch(html, /<(input|select|textarea|button|form)\b|contenteditable/, "nothing on it is editable");

  const none = renderDecisionRights({});
  assert.doesNotMatch(none, /data-delegations/, "a project without the register shows none");
  assert.ok(none.includes(escape(split.override)));
});

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
