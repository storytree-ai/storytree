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

// The canvas, scene, core, camera, rotation and zoom surviving each switch, and a launch opening in Forest, are
// measured on the mounted page in Chromium (evidence/forest-library-toggle); hidden land is never picked (3.12).
test("3.10 choosing Library clears a selected story and its panel, keeps an artifact's card, and choosing Forest clears nothing", () => {
  const changes: Selection[] = [];
  const panel = new PanelSelection(selection => changes.push(selection));
  panel.story("forest", "pay");
  panel.modeChosen("forest");
  assert.deepEqual(panel.current, { kind: "story", id: "forest", capability: "pay" });
  panel.modeChosen("library");
  assert.equal(panel.current, undefined);
  assert.deepEqual(changes.at(-1), undefined, "the page hears the panel close");
  panel.note("principle");
  panel.modeChosen("library");
  panel.modeChosen("forest");
  assert.deepEqual(panel.current, { kind: "note", id: "principle" });
  assert.equal(changes.length, 3, "only the story's clearing changed the panel");
});
