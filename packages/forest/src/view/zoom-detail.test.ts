/**
 * Capability 3 · Story node render (the forest story): which marks the map shows at the eye's zoom (3.86, ADR-1253 D2 as
 * narrowed by ADR-1272). Plain numbers, so read without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DETAIL_SLACK, DETAIL_ZOOM, DetailStore, detailAt } from "./zoom-detail.js";

/** The zoom that frames a map of storytree's size whole, as measured; the wheel stops at half of it. */
const WHOLE = 0.96, FLOOR = WHOLE / 2;

test("3.86 · the territories show at every zoom down to the wheel's floor; near, the roads, gates, relief and settlements too", () => {
  assert.equal(detailAt(WHOLE), "territories", "the map opens on its territories");
  assert.equal(detailAt(FLOOR), "territories", "the wheel's floor, half the whole map's zoom, still shows the territories");
  assert.equal(detailAt(FLOOR, "near"), "territories", "and drawn back to it from near");
  assert.equal(detailAt(DETAIL_ZOOM.near * 2), "near");
  assert.equal(detailAt(DETAIL_ZOOM.near * 2, "territories"), "near");
});

test("3.86 · a zoom wobbling about the near threshold, within its slack, keeps the level it had; past the slack it changes", () => {
  const inside = DETAIL_SLACK / 2, past = DETAIL_SLACK * 1.5, threshold = DETAIL_ZOOM.near;
  for (const was of ["territories", "near"] as const) {
    let level: ReturnType<typeof detailAt> = was;
    for (const wobble of [1 + inside, 1 - inside, 1, 1 + inside, 1 - inside]) level = detailAt(threshold * wobble, level);
    assert.equal(level, was, `a wobble at ${threshold} keeps ${was}`);
  }
  assert.equal(detailAt(threshold * (1 + past), "territories"), "near");
  assert.equal(detailAt(threshold * (1 - past), "near"), "territories");
});

test("3.86 · the map's level is told to its listeners only when a zoom changes it", () => {
  const store = new DetailStore();
  let heard = 0;
  store.subscribe(() => heard++);
  assert.equal(store.get(), "territories", "before the eye's first zoom");
  store.zoom(DETAIL_ZOOM.near * 2);
  store.zoom(DETAIL_ZOOM.near * 1.9);
  store.zoom(DETAIL_ZOOM.near * (1 - DETAIL_SLACK / 2));
  assert.deepEqual([store.get(), heard], ["near", 1]);
  store.zoom(FLOOR);
  assert.deepEqual([store.get(), heard], ["territories", 2]);
  store.zoom(FLOOR / 2);
  assert.deepEqual([store.get(), heard], ["territories", 2], "below the floor nothing hides");
});
