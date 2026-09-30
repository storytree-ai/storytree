import assert from "node:assert/strict";
import { test } from "node:test";

import { removeCurrentProject } from "./remove-project.js";

test("Remove project (app menu): confirming takes the project on show off this computer's list, then reports it; nothing on show removes nothing; a failure is said, not reported as removed", async () => {
  const calls: string[] = [];
  const bridge = { removeProject: async (name: unknown) => { calls.push(`remove ${String(name)}`); return { status: "removed" as const, project: String(name) }; } };
  const onRemoved = async (project: string) => { calls.push(`removed ${project}`); };

  assert.deepEqual(await removeCurrentProject(bridge, { current: () => "blog", onRemoved }), { removed: "blog" });
  assert.deepEqual(calls, ["remove blog", "removed blog"], "the bridge removes first, then the frame refreshes");

  calls.length = 0;
  assert.deepEqual(await removeCurrentProject(bridge, { current: () => undefined, onRemoved }), { removed: null });
  assert.deepEqual(calls, [], "no project on show: nothing is called");

  const tracked = { removeProject: async (name: unknown) => ({ status: "removed" as const, project: String(name), kept: "/work/blog" }) };
  assert.deepEqual(await removeCurrentProject(tracked, { current: () => "blog", onRemoved: async () => {} }), { removed: "blog", kept: "/work/blog" }, "a marker git tracks is reported as left for the user");

  const failing = { removeProject: async () => { throw new Error("The list could not be saved."); } };
  assert.deepEqual(await removeCurrentProject(failing, { current: () => "blog", onRemoved }), { failed: "The project could not be removed: The list could not be saved." });
  assert.deepEqual(calls, [], "a failed removal is not reported as removed");
});
