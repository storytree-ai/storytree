import assert from "node:assert/strict";
import test from "node:test";
import { CATALOGUE, chooseIsland, DEFAULT_BUDGET, isSettled, turnFrames, type PageState } from "./catalogue.js";

test("3.42 the lag catalogue names each action by what it opens, picks its island by name or size, and knows settled from what the page shows", () => {
  // ADR-1001 D2's budget is every entry's unless it carries its own.
  assert.deepEqual(DEFAULT_BUDGET, { responseMs: 100, frameMs: 50, settledMs: 1000 });
  const islands = [{ story: "story_a", title: "The library", capabilities: 9 }, { story: "story_b", title: "The forest", capabilities: 2 },
    { story: "story_c", title: "Shop", capabilities: 14 }];
  assert.equal(chooseIsland("fewest", islands), "story_b");
  assert.equal(chooseIsland("most", islands), "story_c");
  assert.equal(chooseIsland({ story: "The library" }, islands), "story_a", "by title");
  assert.equal(chooseIsland({ story: "story_c" }, islands), "story_c", "by id");
  assert.equal(chooseIsland({ story: "Nowhere" }, islands), undefined);
  assert.equal(chooseIsland("most", []), undefined);

  const page: PageState = { selected: "story_c", note: undefined, panelOpen: true, mode: "forest", sessionSelected: false, still: true, progress: false, startSettled: true };
  assert.equal(isSettled({ selected: "island", panel: "open", still: true }, page, "story_c"), true);
  assert.equal(isSettled({ selected: "island", panel: "open" }, page, "story_a"), false, "another island is selected");
  assert.equal(isSettled({ selected: "island", panel: "open" }, { ...page, panelOpen: false }, "story_c"), false, "the panel is not yet on show");
  assert.equal(isSettled({ selected: "island", still: true }, { ...page, still: false }, "story_c"), false, "the glide is not over");
  assert.equal(isSettled({ selected: "none", panel: "closed" }, { ...page, selected: undefined, panelOpen: false }), true);
  assert.equal(isSettled({ note: "any" }, page), false);
  assert.equal(isSettled({ note: "any" }, { ...page, note: "note_1" }), true);
  assert.equal(isSettled({ mode: "library" }, page), false);
  assert.equal(isSettled({ session: "selected" }, { ...page, sessionSelected: true }), true);
  assert.equal(isSettled({}, page), true, "an action with no settled condition is settled once performed");
  assert.equal(isSettled({ start: "settled" }, page), true);
  assert.equal(isSettled({ start: "settled" }, { ...page, startSettled: false }), false, "the start's survey is still to come");

  // The first entries, by name: an island is opened by its size or its story's name, never a point, and settles on that island's panel.
  const by = new Map(CATALOGUE.map(action => [action.name, action]));
  assert.deepEqual([...by.keys()], ["open-fewest-island", "open-most-island", "open-named-island", "open-app-kept", "open-app-fresh", "close-panel",
    "library-and-back", "open-library-note", "open-session-row", "hover-sweep", "turn-forest", "turn-library", "idle"]);
  assert.deepEqual(["open-fewest-island", "open-most-island", "open-named-island"].map(name => by.get(name)!.perform),
    [[{ kind: "island", island: "fewest" }], [{ kind: "island", island: "most" }], [{ kind: "island", island: { story: "The library" } }]]);
  assert.deepEqual(by.get("open-named-island")!.settled, { selected: "island", panel: "open", still: true });
  assert.deepEqual(by.get("close-panel")!.settled, { selected: "none", panel: "closed" });
  assert.deepEqual(by.get("library-and-back")!.settled, { mode: "forest", still: true });
  assert.deepEqual(by.get("open-library-note")!.perform, [{ kind: "note" }]);
  // Opening the app starts the page again, keeping the forest the last start left or forgetting the keys the forest keeps it under.
  assert.deepEqual(by.get("open-app-kept")!.perform, [{ kind: "start", forget: [] }]);
  assert.deepEqual(by.get("open-app-fresh")!.perform, [{ kind: "start", forget: ["storytree.forest.tree.v1:", "storytree.forest.drawing.v1:"] }]);
  assert.deepEqual(by.get("open-app-fresh")!.settled, { start: "settled" });
  // Turning the map is a drag, in the forest and in the Library, read by its frames: it has nothing to settle.
  for (const [name, view] of [["turn-forest", "forest"], ["turn-library", "library"]] as const) {
    assert.deepEqual([by.get(name)!.perform, by.get(name)!.settled, by.get(name)!.turns, by.get(name)!.field], [[{ kind: "turn" }], {}, view, name]);
  }
  assert.deepEqual(by.get("turn-library")!.setup.at(-1), { kind: "wait", until: { mode: "library", still: true } }, "turned once the Library is on show");

  // A turn's frames are the intervals between its frame times: median, 95th percentile, longest, and how many over the frame budget.
  const times = [0, 16, 33, 50, 66, 150, 166, 183, 200, 216, 233, 250, 266, 283, 300, 316, 333, 350, 366, 383, 400];
  assert.deepEqual(turnFrames(times, 50), { p50: 17, p95: 17, max: 84, over: 1 });
  assert.deepEqual(turnFrames([0, 16, 120, 136], 50), { p50: 16, p95: 104, max: 104, over: 1 });
  assert.deepEqual(turnFrames([10], 50), { p50: 0, p95: 0, max: 0, over: 0 }, "one frame has no interval");
});
