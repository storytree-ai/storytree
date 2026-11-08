/**
 * Capability 2 · Storytree projects: the story panel under library news (ADR-0836 D1, D2). News that changes nothing on show
 * touches nothing; a change keeps the folds the user opened (a contract's own too), the handle in focus and the scroll.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import type { StoryPanel } from "@storytree/forest";

import { storyPanel } from "./story-panel.js";

function setup() {
  const window = new Window();
  const document = window.document;
  const host = document.createElement("aside") as unknown as HTMLElement;
  const body = document.createElement("div") as unknown as HTMLElement;
  document.body.appendChild(host as never);
  body.dataset.selected = "s";
  let title = "one";
  const writes: string[] = [];
  let proto: object | null = host;
  let set: PropertyDescriptor | undefined;
  while (set === undefined && proto !== null) { set = Object.getOwnPropertyDescriptor(proto, "innerHTML"); proto = Object.getPrototypeOf(proto); }
  assert.ok(set);
  Object.defineProperty(host, "innerHTML", { get: () => set!.get!.call(host), set: (v: string) => { writes.push(v); set!.set!.call(host, v); } });
  const fold = (kind: string, inner: string) => `<div class="panel-fold" data-fold="${kind}"><button class="panel-handle" aria-expanded="false">${kind}</button><div class="panel-fold-body" hidden>${inner}</div></div>`;
  const view = storyPanel(host, {
    body,
    drill: () => ({ story: "s", title, description: "", capabilities: [] }) as unknown as StoryPanel,
    render: () => `<h2>${title}</h2>${fold("contracts", `<ul><li data-contract-id="k1">${fold("contract", "k1 body")}</li></ul>`)}`,
    folds: (panel) => { // the forest's folds keep the top-level kinds open; a contract's own is the panel's to keep
      for (const handle of panel.querySelectorAll<HTMLElement>('[data-fold="contracts"] > .panel-handle')) { handle.setAttribute("aria-expanded", "true"); (handle.nextElementSibling as HTMLElement).hidden = false; }
    },
    libraryCard: () => () => {},
    deselect: () => {},
  });
  return { host, view, writes, change: (next: string) => { title = next; } };
}

test("2.51 · news that leaves the panel's content unchanged rebuilds nothing", () => {
  const { view, writes, host } = setup();
  view.show();
  const first = host.querySelector(".panel-handle");
  for (let news = 0; news < 5; news++) view.show();
  assert.equal(writes.length, 1, "one drawing, however much news lands");
  assert.ok(host.querySelector(".panel-handle") === first, "the same elements stay on the panel");
});

test("2.51 · a change on the story keeps the open folds, a contract's own fold, the handle in focus and the scroll", () => {
  const { view, writes, host, change } = setup();
  view.show();
  const handles = () => [...host.querySelectorAll<HTMLButtonElement>(".panel-handle")];
  for (const handle of handles()) {
    handle.setAttribute("aria-expanded", "true");
    (handle.nextElementSibling as HTMLElement).hidden = false;
  }
  handles()[1]!.focus();
  host.scrollTop = 40;
  change("two");
  view.show();
  assert.equal(writes.length, 2, "the change is drawn");
  assert.match(host.innerHTML, /two/);
  assert.deepEqual(handles().map((h) => h.getAttribute("aria-expanded")), ["true", "true"], "both folds, the contract's own included, stay open");
  assert.equal((handles()[1]!.nextElementSibling as HTMLElement).hidden, false);
  assert.ok(host.ownerDocument.activeElement === handles()[1], "the focused handle keeps focus");
  assert.equal(host.scrollTop, 40, "and the scroll holds");
});
