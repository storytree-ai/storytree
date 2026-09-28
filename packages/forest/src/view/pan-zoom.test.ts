/**
 * Capability 4 · Drill-down (the forest story): the view maths the tree's two spaces share, the
 * one in the panel and the larger window (ADR-0743). Plain numbers, so read without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { bounded, centredOn, focusOf } from "./pan-zoom.js";

const cards = [
  { id: "a", x: 0, y: 0, width: 200, height: 100 },
  { id: "b", x: 400, y: 200, width: 200, height: 100 },
];

test("4.11 the panel's space opens on the selected card, the larger window on the middle of the story's cards", () => {
  assert.deepEqual(focusOf(cards, "b"), { x: 500, y: 250 });
  assert.deepEqual(focusOf(cards, undefined), { x: 300, y: 150 });
  assert.deepEqual(focusOf(cards, "gone"), { x: 300, y: 150 });
  assert.deepEqual(centredOn({ x: 500, y: 250 }, { width: 400, height: 360 }), { x: -300, y: -70, scale: 1 }, "at full size, the card in the middle of the frame");
});

test("4.11 however far it is dragged, some of the tree stays in the space", () => {
  const tree = { width: 1000, height: 400 };
  const frame = { width: 400, height: 360 };
  assert.deepEqual(bounded({ x: 5000, y: -5000, scale: 1 }, tree, frame), { x: 304, y: -304, scale: 1 });
});
