/**
 * Capability 3 · Story node render (the forest story): which marks the map shows at the eye's zoom (3.86, ADR-1253 D2).
 * Plain numbers, so read without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DETAIL_SLACK, DETAIL_ZOOM, DetailStore, detailAt } from "./zoom-detail.js";

/** The zoom that frames a map of storytree's size whole, as measured, and where its territories show from. */
const WHOLE = 0.96, TERRITORIES = WHOLE * DETAIL_ZOOM.territories;

test("3.86 · from far the map shows islands only, nearer their territories, near their roads, gates, relief and settlements", () => {
  assert.equal(detailAt(WHOLE, WHOLE), "territories", "the map opens on its territories");
  assert.equal(detailAt(WHOLE / 2, WHOLE), "far", "the wheel's floor, half the whole map's zoom, is far");
  assert.equal(detailAt(DETAIL_ZOOM.near * 2, WHOLE), "near");
  assert.equal(detailAt(DETAIL_ZOOM.near * 2, WHOLE, "far"), "near", "a jump from far to near passes both thresholds at once");
  assert.equal(detailAt(WHOLE / 2, WHOLE, "near"), "far", "and back");
  assert.equal(detailAt(WHOLE, 4), "far", "the territories' threshold follows the whole map's zoom");
  assert.equal(detailAt(3, 4), "near", "and never stands above the near marks'");
});

test("3.86 · a zoom wobbling about a threshold, within its slack, keeps the level it had; past the slack it changes", () => {
  const inside = DETAIL_SLACK / 2, past = DETAIL_SLACK * 1.5;
  for (const [threshold, below, above] of [[TERRITORIES, "far", "territories"], [DETAIL_ZOOM.near, "territories", "near"]] as const) {
    for (const was of [below, above]) {
      let level: ReturnType<typeof detailAt> = was;
      for (const wobble of [1 + inside, 1 - inside, 1, 1 + inside, 1 - inside]) level = detailAt(threshold * wobble, WHOLE, level);
      assert.equal(level, was, `a wobble at ${threshold} keeps ${was}`);
    }
    assert.equal(detailAt(threshold * (1 + past), WHOLE, below), above);
    assert.equal(detailAt(threshold * (1 - past), WHOLE, above), below);
  }
});

test("3.86 · the map's level is told to its listeners only when a zoom changes it", () => {
  const store = new DetailStore();
  let heard = 0;
  store.subscribe(() => heard++);
  assert.equal(store.get(), "territories", "before the eye's first zoom");
  store.zoom(DETAIL_ZOOM.near * 2, WHOLE);
  store.zoom(DETAIL_ZOOM.near * 1.9, WHOLE);
  store.zoom(DETAIL_ZOOM.near * (1 - DETAIL_SLACK / 2), WHOLE);
  assert.deepEqual([store.get(), heard], ["near", 1]);
  store.zoom(WHOLE / 2, WHOLE);
  assert.deepEqual([store.get(), heard], ["far", 2]);
});
