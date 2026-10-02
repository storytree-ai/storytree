/**
 * Capability 4 · Drill-down (the forest story): the capability tree laid out for its own pannable
 * space (ADR-0743). A graph layout, as 0.2 drew it: every card one readable size, what a capability
 * builds on below it, and another story's capability beside the one that builds on it rather than
 * in one row of every outside capability.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { CapabilityLine, StoryPanel } from "./drill-down.js";
import { CARD, layoutTree, OUTSIDE_CARD } from "./tree-layout.js";
import { fitted } from "../view/pan-zoom.js";

function line(id: string): CapabilityLine {
  return { id, title: `The ${id}`, description: "", reported: "not-checked", state: "planned", status: "proposed", contracts: [] };
}

// a ← b ← c inside the story; a builds on x and c on y, both in another story.
const panel: StoryPanel = {
  story: "s",
  title: "Story s",
  description: "",
  capabilities: [line("a"), line("b"), line("c")],
  arrows: [
    { from: "b", to: "a", toTitle: "The a", landed: false, toStatus: "proposed" },
    { from: "c", to: "b", toTitle: "The b", landed: false, toStatus: "proposed" },
    { from: "a", to: "x", toTitle: "The x", toStory: "Story t", landed: true, toStatus: "proposed" },
    { from: "c", to: "y", toTitle: "The y", toStory: "Story t", landed: false, toStatus: "proposed" },
  ],
};

test("4.9 the tree is a graph of fixed-size cards: each capability above what it builds on, another story's beside what builds on it", () => {
  const layout = layoutTree(panel);
  const at = new Map(layout.cards.map((card) => [card.id, card]));
  assert.deepEqual([...at.keys()].sort(), ["a", "b", "c", "x", "y"]);
  for (const card of layout.cards) {
    const size = card.own ? CARD : OUTSIDE_CARD;
    assert.deepEqual([card.width, card.height], [size.width, size.height], "no card shrinks to fit");
  }
  const y = (id: string): number => { const card = at.get(id); return card === undefined ? Number.NaN : card.y + card.height / 2; };
  assert.ok(y("c") < y("b") && y("b") < y("a") && y("a") < y("x"), "what a capability builds on sits below it");
  assert.equal(y("y"), y("b"), "an outside capability sits one row below the one that builds on it");
  assert.notEqual(y("x"), y("y"), "not every outside capability in one row");
  assert.equal(at.get("x")?.own, false);
  assert.equal(at.get("a")?.own, true);
  assert.equal(layout.links.length, 4);
  assert.ok(layout.width >= CARD.width && layout.height >= 3 * CARD.height + OUTSIDE_CARD.height);
});

test("4.9, 4.11 five independent capabilities fit the story panel at readable full size", () => {
  const layout = layoutTree({ ...panel, capabilities: ["a", "b", "c", "d", "e"].map(line), arrows: [] });
  for (const frame of [{ width: 530, height: 440 }, { width: 438, height: 350 }]) {
    assert.equal(fitted(layout, frame).scale, 1, "fitting the whole tree must not halve the labels and health words");
  }
  assert.equal(layout.cards.length, 5);
  for (const card of layout.cards) {
    assert.deepEqual([card.width, card.height], [CARD.width, CARD.height]);
    assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.width <= layout.width && card.y + card.height <= layout.height);
    for (const other of layout.cards) {
      if (card === other) continue;
      assert.ok(card.x + card.width <= other.x || other.x + other.width <= card.x || card.y + card.height <= other.y || other.y + other.height <= card.y, "every card has its own readable space");
    }
  }
});
