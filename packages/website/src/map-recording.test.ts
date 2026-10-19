import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRecording, onSheet } from "./map-recording.js";
import { sheetLayout } from "@storytree/forest/view";
import { rowOf } from "@storytree/forest";
import { SHEET_RADIUS, sheetPoint } from "@storytree/forest-world/planet";
import type { GrowthSnapshot } from "./forest-data.js";
import shop from "./shop-snapshot.json" with { type: "json" };
import own from "./own-snapshot.json" with { type: "json" };

test("3.4 · the map chapter lays the shop's first four stories out by their own plan: signing in, browsing above it, the cart and checkout side by side above browsing", () => {
  const original = shop as unknown as GrowthSnapshot;
  const recording = mapRecording(original);
  const signIn = "story_d263ef0f3f72", browsing = "story_0c07d0047754", cart = "story_2de9e8f4db21", checkout = "story_66f80ffaaa4d";
  const place = new Map(recording.places.map(node => [node.id, node.place]));
  assert.deepEqual([signIn, browsing, cart, checkout].map(story => place.get(story)), [1, 1001, 2001, 2002]);
  // Rows 0, 1 and 2, the cart and checkout side by side in the third: the sheet lays them out by these places (the next test).
  assert.deepEqual(recording.scene.islands.map(island => island.story).sort(), [signIn, browsing, cart, checkout].sort(), "framed by the four, not the finished shop");
  assert.deepEqual(original.places.find(node => node.id === checkout)!.place, 3001, "free play keeps the finished shop's places");
});

test("3.4 · on the glass sheet the map chapter lays the four out by the sheet's rule, depth running west to east: signing in, then browsing, then the cart above checkout; every recorded growth lands each island where the app's sheet puts its plan", () => {
  const original = shop as unknown as GrowthSnapshot;
  const recording = onSheet(mapRecording(original));
  const signIn = "story_d263ef0f3f72", browsing = "story_0c07d0047754", cart = "story_2de9e8f4db21", checkout = "story_66f80ffaaa4d";
  const point = new Map(recording.spots.map(([story, spot]) => [story, sheetPoint(spot)]));
  const [s, b, c, k] = [point.get(signIn)!, point.get(browsing)!, point.get(cart)!, point.get(checkout)!];
  assert.ok(s.x < b.x && b.x < c.x, "signing in to the west, browsing east of it, the cart east of browsing");
  assert.ok(Math.abs(c.x - k.x) < 1e-6 && c.y > k.y, "the cart and checkout in one column, the cart to the north");
  for (const grown of [recording, onSheet(original), onSheet(own as unknown as GrowthSnapshot)]) {
    const places = new Map(grown.places.map(node => [node.id, node.place]));
    assert.equal(grown.radius, SHEET_RADIUS, `${grown.project}: the roads are measured on the sheet`);
    // The sheet's rule, island by island: a depth is a column, deeper ones further east, and down a column by slot from the north.
    const at = new Map(grown.spots.map(([story, spot]) => [story, sheetPoint(spot)]));
    assert.deepEqual([...at.keys()].sort(), grown.scene.islands.map(island => island.story).sort(), `${grown.project}: every island of the plan is placed`);
    for (const [one, p] of at) for (const [other, q] of at) {
      const a = rowOf(places.get(one)!), b = rowOf(places.get(other)!);
      if (a.row < b.row) assert.ok(p.x < q.x, `${grown.project}: ${one} west of the deeper ${other}`);
      else if (a.row === b.row) assert.ok(Math.abs(p.x - q.x) < 1e-6 && (a.slot >= b.slot || p.y > q.y), `${grown.project}: ${one} and ${other} in one column, by slot from the north`);
    }
    // Every stage drawn within its full plan, as the replay draws it, keeps each island at that place.
    for (const stage of grown.stages) for (const [story, spot] of sheetLayout(stage.scene, places, grown.scene).spots)
      assert.deepEqual(spot, new Map(grown.spots).get(story), `${grown.project} at ${stage.id}: ${story} where the sheet puts it`);
  }
});
