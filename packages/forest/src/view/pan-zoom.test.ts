/**
 * Capability 4 · Drill-down (the forest story): the view maths the tree's two spaces share, the
 * one in the panel and the larger window (ADR-0743). Plain numbers, so read without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { bounded, fitted, opening } from "./pan-zoom.js";

test("4.11 both spaces open with the whole tree fitted in the frame and centred, never larger than full size nor smaller than the least zoom", () => {
  assert.deepEqual(fitted({ width: 1000, height: 400 }, { width: 500, height: 400 }), { x: 0, y: 100, scale: 0.5 }, "a wide tree: its width fills the frame, centred top to bottom");
  assert.deepEqual(fitted({ width: 300, height: 1200 }, { width: 400, height: 600 }), { x: 125, y: 0, scale: 0.5 }, "a tall tree: its height fills the frame, centred side to side");
  assert.deepEqual(fitted({ width: 200, height: 100 }, { width: 400, height: 300 }), { x: 100, y: 100, scale: 1 }, "a small tree stays at full size, centred");
  assert.deepEqual(fitted({ width: 10000, height: 100 }, { width: 400, height: 300 }), { x: -1300, y: 135, scale: 0.3 }, "a huge tree stops at the least zoom, its middle in the middle");
});

test("4.11 however far it is dragged, some of the tree stays in the space", () => {
  const tree = { width: 1000, height: 400 };
  const frame = { width: 400, height: 360 };
  assert.deepEqual(bounded({ x: 5000, y: -5000, scale: 1 }, tree, frame), { x: 304, y: -304, scale: 1 });
});

test("the tree's opening zoom: the whole tree fitted by default, as today; full size or close up open on the tree's top, centred (ADR-0750)", () => {
  const tree = { width: 1000, height: 1200 };
  const frame = { width: 500, height: 400 };
  assert.deepEqual(opening("whole-tree", tree, frame), fitted(tree, frame));
  assert.deepEqual(opening("full-size", tree, frame), { x: -250, y: 0, scale: 1 });
  assert.deepEqual(opening("close", tree, frame), { x: -500, y: 0, scale: 1.5 });
  assert.deepEqual(opening("full-size", { width: 200, height: 100 }, frame), { x: 150, y: 150, scale: 1 }, "a tree smaller than the frame is centred");
});
