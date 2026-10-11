/** Forest capability 3: the globe's Stories and Library switches (ADR-1002 D1, D2). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { flipSwitch, globeLayers, LAUNCH_SWITCHES } from "./globe-switches.js";

test("3.10 a launch opens with Stories on and Library off, and a press flips only its own switch", () => {
  assert.deepEqual(LAUNCH_SWITCHES, { stories: true, library: false });
  const both = flipSwitch(LAUNCH_SWITCHES, "library");
  assert.deepEqual(both, { stories: true, library: true });
  assert.deepEqual(flipSwitch(both, "stories"), { stories: false, library: true });
  assert.deepEqual(flipSwitch(flipSwitch(LAUNCH_SWITCHES, "stories"), "stories"), LAUNCH_SWITCHES);
});

test("3.9 each pair of switches draws its own globe: both on the islands over the core, Library off a solid globe, Stories off the core alone, both off nothing", () => {
  assert.deepEqual(globeLayers({ stories: true, library: true }, true), { mode: "forest", library: true, shown: true, offered: ["stories", "library"] });
  assert.deepEqual(globeLayers({ stories: true, library: false }, true), { mode: "forest", library: false, shown: true, offered: ["stories", "library"] });
  assert.deepEqual(globeLayers({ stories: false, library: true }, true), { mode: "library", library: true, shown: true, offered: ["stories", "library"] });
  assert.deepEqual(globeLayers({ stories: false, library: false }, true), { mode: "library", library: false, shown: false, offered: ["stories", "library"] });
});

test("3.9 with the Surfaces menu's Library off, only Stories is offered and the globe is solid", () => {
  assert.deepEqual(globeLayers(LAUNCH_SWITCHES, false), { mode: "forest", library: false, shown: true, offered: ["stories"] });
  assert.equal(globeLayers({ stories: false, library: true }, false).shown, false, "Stories off leaves nothing to draw");
});
