/** Forest capability 3: the Stories and Library switches (ADR-1002 D1, D2), and the glass sheet's two looks. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { flipSwitch, globeLayers, LAUNCH_FACE, LAUNCH_SWITCHES, sheetFaces } from "./globe-switches.js";

test("3.10 a launch opens with Stories on and Library off, and a press flips only its own switch", () => {
  assert.deepEqual(LAUNCH_SWITCHES, { stories: true, library: false });
  const both = flipSwitch(LAUNCH_SWITCHES, "library");
  assert.deepEqual(both, { stories: true, library: true });
  assert.deepEqual(flipSwitch(both, "stories"), { stories: false, library: true });
  assert.deepEqual(flipSwitch(flipSwitch(LAUNCH_SWITCHES, "stories"), "stories"), LAUNCH_SWITCHES);
});

test("3.9 each pair of switches chooses its own look: both on the islands with the knowledge, Library off the islands with no notes, Stories off the Library look, both off nothing", () => {
  assert.deepEqual(globeLayers({ stories: true, library: true }, true), { mode: "forest", library: true, shown: true, offered: ["stories", "library"] });
  assert.deepEqual(globeLayers({ stories: true, library: false }, true), { mode: "forest", library: false, shown: true, offered: ["stories", "library"] });
  assert.deepEqual(globeLayers({ stories: false, library: true }, true), { mode: "library", library: true, shown: true, offered: ["stories", "library"] });
  assert.deepEqual(globeLayers({ stories: false, library: false }, true), { mode: "library", library: false, shown: false, offered: ["stories", "library"] });
});

test("3.9 with the Surfaces menu's Library off, only Stories is offered, with no notes", () => {
  assert.deepEqual(globeLayers(LAUNCH_SWITCHES, false), { mode: "forest", library: false, shown: true, offered: ["stories"] });
  assert.equal(globeLayers({ stories: false, library: true }, false).shown, false, "Stories off leaves nothing to draw");
});

test("3.55 the glass sheet's Stories and Library buttons are two looks, one pressed at a time, each the mode it draws: a launch opens on Stories, and with the Surfaces menu's Library off only Stories is offered", () => {
  assert.equal(LAUNCH_FACE, "stories");
  assert.deepEqual(sheetFaces("stories", true), { mode: "forest", library: true, pressed: { stories: true, library: false }, offered: ["stories", "library"] });
  assert.deepEqual(sheetFaces("library", true), { mode: "library", library: true, pressed: { stories: false, library: true }, offered: ["stories", "library"] });
  assert.deepEqual(sheetFaces("library", false), { mode: "forest", library: false, pressed: { stories: true, library: false }, offered: ["stories"] });
});
