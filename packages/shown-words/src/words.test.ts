/** Shown words 1.1: the one table names each thing and each action once, and no word names two (ADR-1019 D3 as extended). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ACTIONS, CONCEPTS, PLACES, sharedWords } from "./index.js";

test("1.1 · each concept and each action has one shown word, and no shown word names two things", () => {
  assert.deepEqual(CONCEPTS.capability, { one: "capability", many: "capabilities" }, "ADR-1322 D1: a capability is shown as a capability");
  assert.equal(ACTIONS.addProject, "Add a project…", "F1.5: one name for adding a project");
  assert.equal(PLACES.unclaimed, "Not in any capability", "F3.8: code no capability reaches has its own words");
  assert.doesNotMatch(PLACES.unclaimed, /claim/i, "and they never read as a claim on work");
  assert.deepEqual(sharedWords(), [], "no word in the table names two things");
  // A word given to two rows is caught, however it is written.
  assert.deepEqual(sharedWords({ a: "Add a project…", b: "add a project" }), ["add a project"]);
  assert.deepEqual(sharedWords({ a: { one: "part", many: "parts" }, b: "Part" }), ["part"]);
});
