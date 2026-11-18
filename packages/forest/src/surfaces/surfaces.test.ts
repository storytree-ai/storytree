// Capability 3 · Story node render
import assert from "node:assert/strict";
import { test } from "node:test";

import { forestSurfaces } from "./surfaces.js";

test("4.6 · the story panel's capability details switch on and off on their own, following no other surface", () => {
  const details = forestSurfaces.find(({ id }) => id === "capability-details");
  assert.ok(details !== undefined);
  assert.equal(details.switchable, true);
  assert.equal("follows" in details, false);
});
