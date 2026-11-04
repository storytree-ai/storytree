/**
 * Capability 2 · Storytree projects: the left rail's width, collapse and toggle (ADR-1219), on a page of its own. The pointer and
 * keys are dispatched as the window would; the width is what the rail lays out, the `--rail-width` its frame and the map read.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import { mountRail, RAIL_MIN } from "./rail.js";

function memory(initial: Record<string, string> = {}) {
  const kept = new Map(Object.entries(initial));
  return { kept, getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } };
}

function open(storage: Pick<Storage, "getItem" | "setItem"> = memory(), width = 1440) {
  const window = new Window({ width, height: 900 });
  const document = window.document as unknown as Document;
  const bar = document.createElement("header");
  const content = document.createElement("main");
  document.body.append(bar, content);
  const rail = mountRail(content, { project: "site", tabs: ["sessions", "arcs"], storage, toggleHost: bar })!;
  const handle = content.querySelector<HTMLElement>("[role=separator]")!;
  const toggle = bar.querySelector<HTMLButtonElement>("button")!;
  const view = window as unknown as typeof globalThis;
  const pointer = (type: string, clientX: number) =>
    (type === "pointerdown" ? handle : document).dispatchEvent(new view.PointerEvent(type, { clientX, pointerId: 1, button: 0, bubbles: true }));
  const key = (target: EventTarget, init: KeyboardEventInit) => target.dispatchEvent(new view.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  const drag = (...xs: number[]) => { pointer("pointerdown", xs[0]!); for (const x of xs.slice(1)) pointer("pointermove", x); pointer("pointerup", xs.at(-1)!); };
  return {
    window, document, content, rail, handle, toggle, key, pointer, drag,
    side: () => content.querySelector<HTMLElement>(".side-rail")!,
    width: () => content.style.getPropertyValue("--rail-width"),
    now: () => Number(handle.getAttribute("aria-valuenow")),
  };
}

test("2.42 · the left rail's right edge is a handle that resizes it, by dragging or by the arrow keys, between a minimum its contents stay readable at and a maximum that leaves the map usable", () => {
  const on = open();
  assert.equal(on.handle.tabIndex, 0, "the handle takes the focus");
  assert.equal(on.handle.getAttribute("aria-orientation"), "vertical");
  assert.equal(on.width(), "384px", "it opens at its default width");
  assert.equal(on.now(), 384);
  const max = Number(on.handle.getAttribute("aria-valuemax"));
  assert.equal(Number(on.handle.getAttribute("aria-valuemin")), RAIL_MIN);
  assert.ok(max > RAIL_MIN && max <= 1440 - 360, "the widest leaves the map room");

  on.pointer("pointerdown", 384);
  on.pointer("pointermove", 500);
  assert.equal(on.width(), "500px", "the rail follows the pointer while dragged");
  on.pointer("pointerup", 520);
  assert.equal(on.width(), "520px");
  on.drag(520, 1400);
  assert.equal(on.now(), max, "dragged past the widest, it stops there");
  on.drag(max, 180);
  assert.equal(on.now(), RAIL_MIN, "dragged under the least but not far, it stops at the least");

  on.key(on.handle, { key: "ArrowRight" });
  assert.equal(on.now(), RAIL_MIN + 16, "the right arrow widens it a step");
  on.key(on.handle, { key: "ArrowLeft" });
  on.key(on.handle, { key: "ArrowLeft" });
  assert.equal(on.now(), RAIL_MIN, "the left arrow narrows it, never under the least");
  assert.equal(on.side().hidden, false);

  const narrow = open(memory(), 800);
  assert.ok(narrow.now() <= Number(narrow.handle.getAttribute("aria-valuemax")), "a narrow window opens it no wider than the map allows");
});

test("2.43 · dragging the rail's handle left past a threshold below its minimum collapses the rail away, and releasing above the threshold snaps it to at least the minimum", () => {
  const on = open();
  on.drag(384, 300);
  on.pointer("pointerdown", 300);
  on.pointer("pointermove", 40);
  assert.equal(on.side().hidden, true, "pushed far left, the rail is gone while dragged");
  assert.equal(on.width(), "0px", "and the map takes the window");
  on.pointer("pointermove", 150);
  assert.equal(on.side().hidden, false, "dragged back before letting go, it shows again");
  assert.equal(on.now(), RAIL_MIN, "at the least width");
  on.pointer("pointerup", 150);
  assert.equal(on.now(), RAIL_MIN, "let go above the threshold, it snaps to the least");

  on.drag(RAIL_MIN, 20);
  assert.equal(on.side().hidden, true, "let go past the threshold, it stays collapsed");
  assert.equal(on.width(), "0px");
  assert.ok(on.content.contains(on.handle), "the handle stays at the window's edge");
  on.drag(0, 450);
  assert.equal(on.side().hidden, false, "dragged out from the edge, it comes back");
  assert.equal(on.now(), 450);
});

test("2.44 · a sidebar toggle in the app bar, and Ctrl+B, show and hide the left rail, and showing it again restores the last width dragged to", () => {
  const on = open();
  assert.equal(on.toggle.getAttribute("aria-expanded"), "true");
  assert.equal(on.toggle.getAttribute("aria-controls"), on.side().id);
  on.drag(384, 470);
  on.toggle.click();
  assert.equal(on.side().hidden, true, "the toggle hides the rail");
  assert.equal(on.width(), "0px");
  assert.equal(on.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(on.toggle.getAttribute("aria-label"), "Show sidebar");
  on.toggle.click();
  assert.equal(on.side().hidden, false);
  assert.equal(on.now(), 470, "shown again at the width last dragged to");

  on.drag(470, 500, 150, 10);
  on.toggle.click();
  assert.equal(on.now(), 470, "collapsed by a drag, the toggle brings back the width it had before that drag, not one it passed");

  on.key(on.document.body, { key: "b", ctrlKey: true });
  assert.equal(on.side().hidden, true, "Ctrl+B hides it");
  on.key(on.document.body, { key: "B", metaKey: true });
  assert.equal(on.side().hidden, false, "and Cmd+B shows it");
  const field = on.document.createElement("input");
  on.document.body.append(field);
  on.key(field, { key: "b", ctrlKey: true });
  assert.equal(on.side().hidden, false, "typing in a field keeps its keys");

  on.key(on.handle, { key: "Enter" });
  assert.equal(on.side().hidden, true, "Enter on the handle collapses it");
  on.key(on.handle, { key: "ArrowLeft" });
  assert.equal(on.side().hidden, true, "the left arrow leaves it collapsed");
  on.key(on.handle, { key: "ArrowRight" });
  assert.equal(on.now(), 470, "the right arrow shows it at its width");

  on.rail.stop();
  assert.equal(on.toggle.isConnected, false, "the toggle goes with the rail");
  on.key(on.document.body, { key: "b", ctrlKey: true });
  assert.equal(on.width(), "", "a stopped rail hears no shortcut");
});

test("2.45 · the left rail's width and whether it is collapsed are kept in the page's storage across launches, and a storage that is empty or throws falls back to the default width, shown", () => {
  const storage = memory();
  const first = open(storage);
  first.drag(384, 480);
  first.toggle.click();
  first.rail.stop();
  const again = open(storage);
  assert.equal(again.side().hidden, true, "relaunched, it is still collapsed");
  again.toggle.click();
  assert.equal(again.now(), 480, "and shows at the width he left it");
  again.rail.stop();
  assert.equal(open(storage).now(), 480, "shown is kept too");

  const throwing = { getItem: () => { throw new Error("no storage"); }, setItem: () => { throw new Error("no storage"); } };
  const fallen = open(throwing);
  assert.equal(fallen.side().hidden, false, "a storage that throws opens it shown");
  assert.equal(fallen.now(), 384, "at the default width");
  fallen.drag(384, 300);
  assert.equal(fallen.now(), 300, "and it still resizes for this launch");
  const garbled = open(memory({ "storytree.app.rail.v1": "{not json" }));
  assert.deepEqual([garbled.side().hidden, garbled.now()], [false, 384], "a kept value it cannot read is the default");
});
