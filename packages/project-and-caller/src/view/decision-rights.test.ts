import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { decisionRights } from "../settings/decision-rights.js";
import { mountDecisionRights, renderDecisionRights } from "./decision-rights.js";

test("2.14 the app shows who decides what, read-only, from the card's own lines, with the project's standing delegations when it has them", () => {
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

test("2.14 a failed read of the project's standing delegations is shown as a failure, not as a project without them, and written to the console", async (t) => {
  const window = new Window();
  const globals = { document: window.document, CSSStyleSheet: window.CSSStyleSheet };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  let read!: () => void;
  const failed = new Promise<void>((resolve) => { read = resolve; });
  const logged = t.mock.method(console, "error", () => read());
  const host = window.document.createElement("main");
  window.document.body.append(host);
  const view = mountDecisionRights(host as unknown as HTMLElement, async () => { throw new Error("the library did not answer"); });
  t.after(async () => {
    view.stop();
    for (const key of Object.keys(globals)) {
      const descriptor = previous[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await window.happyDOM.close();
  });
  view.open();
  await failed;
  assert.match(host.querySelector("[data-delegations-error]")?.textContent ?? "", /could not be read: the library did not answer/);
  assert.ok(host.querySelector(".decision-rights-override"), "the split still shows");
  assert.deepEqual(logged.mock.calls.map((call) => [call.arguments[0], (call.arguments[1] as Error).message]),
    [["project-and-caller decision rights: the standing delegations could not be read", "the library did not answer"]]);
});
