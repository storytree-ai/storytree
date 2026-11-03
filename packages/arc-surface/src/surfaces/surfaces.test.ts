import assert from "node:assert/strict";
import { test } from "node:test";
import { arcSurfaces } from "./surfaces.js";

test("3.8 · the arc surface offers the Surfaces menu one switch, Arcs, with no settings", () => {
  assert.deepEqual(arcSurfaces.map(({ id, name, switchable, settings }) => ({ id, name, switchable, settings })), [{ id: "arcs", name: "Arcs", switchable: true, settings: [] }]);
});
