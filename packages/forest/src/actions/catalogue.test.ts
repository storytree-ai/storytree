import assert from "node:assert/strict";
import test from "node:test";
import { CATALOGUE, chooseIsland, DEFAULT_BUDGET, isSettled, type PageState } from "./catalogue.js";

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

  const page: PageState = { selected: "story_c", note: undefined, panelOpen: true, mode: "forest", sessionSelected: false, still: true, progress: false };
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

  // The first entries, by name: an island is opened by its size or its story's name, never a point, and settles on that island's panel.
  const by = new Map(CATALOGUE.map(action => [action.name, action]));
  assert.deepEqual([...by.keys()], ["open-fewest-island", "open-most-island", "open-named-island", "close-panel",
    "library-and-back", "open-library-note", "open-session-row", "hover-sweep", "idle"]);
  assert.deepEqual(["open-fewest-island", "open-most-island", "open-named-island"].map(name => by.get(name)!.perform),
    [[{ kind: "island", island: "fewest" }], [{ kind: "island", island: "most" }], [{ kind: "island", island: { story: "The library" } }]]);
  assert.deepEqual(by.get("open-named-island")!.settled, { selected: "island", panel: "open", still: true });
  assert.deepEqual(by.get("close-panel")!.settled, { selected: "none", panel: "closed" });
  assert.deepEqual(by.get("library-and-back")!.settled, { mode: "forest", still: true });
  assert.deepEqual(by.get("open-library-note")!.perform, [{ kind: "note" }]);
});
