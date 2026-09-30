/** Forest capability 3 / knowledge-core capability 4: one right-side panel (ADR-0661 D2). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PanelSelection, type Selection } from "./panel-selection.js";

test("3.13 a card replaces a story and a story replaces a card; Close and Escape dismiss the card", () => {
  const changes: Selection[] = [];
  const panel = new PanelSelection(selection => changes.push(selection));
  panel.story("forest");
  assert.deepEqual(panel.current, { kind: "story", id: "forest" });
  panel.note("principle");
  assert.deepEqual(panel.current, { kind: "note", id: "principle" });
  panel.story("library");
  assert.deepEqual(panel.current, { kind: "story", id: "library" });
  panel.note("principle");
  panel.close();
  assert.equal(panel.current, undefined);
  panel.note("decision");
  panel.key("Enter");
  assert.deepEqual(panel.current, { kind: "note", id: "decision" });
  panel.key("Escape");
  assert.equal(panel.current, undefined);
  assert.equal(changes.length, 7, "unrelated keys leave the panel alone");
});
