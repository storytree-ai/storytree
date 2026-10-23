/** Capability 4 · Updates: a copy that does not install releases says so, and does nothing else. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { noUpdates } from "./update-state.js";

test("4.10 a copy that does not install releases answers every update request as unavailable, naming its build", () => {
  const updates = noUpdates(() => "development build");
  for (const action of ["check", "install", "status"] as const) {
    assert.deepEqual(updates.request(action), { phase: "unavailable", runningBuild: "development build" });
  }
  assert.throws(() => updates.request("rebuild"), /Unknown update action/);
});
