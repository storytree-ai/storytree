/** Shown words 1.1: the one table names each thing and each action once, and no word names two (ADR-1019 D3 as extended). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ACTIONS, CONCEPTS, sharedWords } from "./index.js";

test("1.1 each concept and each action has one shown word, and no shown word names two things", () => {
  assert.equal(CONCEPTS.capability.one, "part", "ADR-1019 D1: a capability is shown as a part");
  assert.equal(ACTIONS.addProject, "Add a project…", "F1.5: one name for adding a project");
  assert.deepEqual(sharedWords(), [], "no word in the table names two things");
  // A word given to two rows is caught, however it is written.
  assert.deepEqual(sharedWords({ a: "Add a project…", b: "add a project" }), ["add a project"]);
  assert.deepEqual(sharedWords({ a: { one: "part", many: "parts" }, b: "Part" }), ["part"]);
});
