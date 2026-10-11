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

// The canvas, scene, core, camera, rotation and zoom surviving each switch, and a launch opening with both on, are
// measured on the mounted page in Chromium (evidence/mounted-views); hidden land is never picked (3.12).
test("3.10 switching Stories off clears a selected story and its panel, switching Library off clears a note's card, and switching on clears nothing", () => {
  const changes: Selection[] = [];
  const panel = new PanelSelection(selection => changes.push(selection));
  panel.story("forest", "pay");
  panel.switched({ stories: true, library: false });
  assert.deepEqual(panel.current, { kind: "story", id: "forest", capability: "pay" }, "Library off keeps a story");
  panel.switched({ stories: false, library: true });
  assert.equal(panel.current, undefined);
  assert.deepEqual(changes.at(-1), undefined, "the page hears the panel close");
  panel.note("principle");
  panel.switched({ stories: false, library: true });
  panel.switched({ stories: true, library: true });
  assert.deepEqual(panel.current, { kind: "note", id: "principle" }, "Stories off and on keep a note's card");
  panel.switched({ stories: true, library: false });
  assert.equal(panel.current, undefined, "Library off closes the card");
  assert.equal(changes.length, 4, "only the two clearings changed the panel");
});
