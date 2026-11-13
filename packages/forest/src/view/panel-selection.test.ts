/** Forest capability 3 / knowledge-core capability 4: one right-side panel (ADR-0661 D2). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PanelSelection, panelPicks, type Selection } from "./panel-selection.js";

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
// measured on the mounted page in Chromium, across each switch; hidden land is never picked (3.12).
test("3.10 switching Stories off clears a selected story or shared store and its panel, switching Library off clears a note's card, and switching on clears nothing", () => {
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
  // A shared store stands on the sheet with the islands, so Stories off hides it and closes its panel; Library off keeps it.
  panel.store("postgres://db/shop");
  panel.switched({ stories: true, library: false });
  assert.deepEqual(panel.current, { kind: "store", id: "postgres://db/shop" }, "Library off keeps a store");
  panel.switched({ stories: false, library: true });
  assert.equal(panel.current, undefined, "Stories off closes a store's panel");
});

test("3.55 on the glass sheet a selected story stays selected on either side of the glass, and coming back above it to Stories closes a picked note's card", () => {
  const changes: Selection[] = [];
  const panel = new PanelSelection(selection => changes.push(selection));
  panel.story("forest", "pay");
  panel.turned("library");
  panel.turned("stories");
  assert.deepEqual(panel.current, { kind: "story", id: "forest", capability: "pay" }, "the story holds across the turn and back");
  panel.turned("library");
  panel.note("principle");
  panel.turned("stories");
  assert.equal(panel.current, undefined, "the note's card closes on the Stories face");
  assert.equal(changes.length, 3, "only the pick, the note and the closing changed the panel");
});

test("3.88 · a picked gate selects its island's story with the pair of capabilities it joins, for the panel", () => {
  const seen: Selection[] = [];
  const selection = new PanelSelection((next) => seen.push(next));
  selection.gate("story", ["a", "c"]);
  assert.deepEqual(selection.current, { kind: "story", id: "story", gate: ["a", "c"] });
  assert.deepEqual(seen, [{ kind: "story", id: "story", gate: ["a", "c"] }], "and says so");
  selection.story("story", "a");
  assert.deepEqual(selection.current, { kind: "story", id: "story", capability: "a" }, "a territory picked after it names no gate");
  selection.picked("story", undefined, ["a", "c"]);
  assert.deepEqual(selection.current, { kind: "story", id: "story", gate: ["a", "c"] }, "a map click that picked a gate selects its pair");
  selection.picked("story", "c");
  assert.deepEqual(selection.current, { kind: "story", id: "story", capability: "c" }, "one that picked a territory, its capability");
  selection.picked(undefined);
  assert.equal(selection.current, undefined, "one that picked nothing, nothing");
});

test("4.8 a capability's name clicked on the story's panel picks that capability of the story on show, as its territory's click would, and the story's name picks it alone", async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const host = window.document.createElement("aside") as unknown as HTMLElement;
  host.innerHTML = `<button type="button" class="panel-story-name" data-pick-story>Forest</button><ul><li><button type="button" class="panel-pick" data-pick-capability="cap_b">The <b>B</b></button></li></ul><p>Elsewhere</p>`;
  const changes: Selection[] = [];
  const selection = new PanelSelection(next => changes.push(next));
  const stop = panelPicks(host, selection);
  const click = (target: Element): void => { target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event); };
  selection.story("forest");
  click(host.querySelector("b")!);
  assert.deepEqual(selection.current, { kind: "story", id: "forest", capability: "cap_b" }, "the story on show, on that capability");
  click(host.querySelector("p")!);
  assert.equal(changes.length, 2, "a click elsewhere on the panel picks nothing");
  click(host.querySelector("[data-pick-story]")!);
  assert.deepEqual(selection.current, { kind: "story", id: "forest" }, "the story named above a capability picks the story alone");
  selection.close();
  click(host.querySelector("b")!);
  assert.equal(selection.current, undefined, "with no story on show, a name picks nothing");
  stop();
  selection.story("forest");
  click(host.querySelector("b")!);
  assert.deepEqual(selection.current, { kind: "story", id: "forest" }, "stopped, it hears nothing");
});
