import assert from "node:assert/strict";
import { test } from "node:test";

import { deleteChosenProject } from "./delete-project.js";

test("3.6 Delete a project (app menu): nothing is asked of the library until the chosen name is typed; then it is deleted with the snapshot choice and the frame refreshes; a refusal is said, not reported as deleted", async () => {
  const calls: string[] = [];
  const bridge = { deleteProject: async (name: unknown, typed: unknown, snapshot: unknown) => { calls.push(`delete ${String(name)} ${String(typed)} ${String(snapshot)}`); return { status: "deleted" as const, project: String(name), snapshot: "/home/backups/old/1.json" }; } };
  const onDeleted = async (project: string) => { calls.push(`deleted ${project}`); };

  assert.deepEqual(await deleteChosenProject(bridge, { project: "old", typed: "ol", snapshot: true, onDeleted }), { deleted: null });
  assert.deepEqual(calls, [], "a name not yet typed asks nothing");

  assert.deepEqual(await deleteChosenProject(bridge, { project: "old", typed: "old", snapshot: false, onDeleted }), { deleted: "old", snapshot: "/home/backups/old/1.json" });
  assert.deepEqual(calls, ["delete old old false", "deleted old"], "deleted with the snapshot choice, then the frame refreshes");

  calls.length = 0;
  const refusing = { deleteProject: async () => { throw new Error("A live session is working in “old”."); } };
  assert.deepEqual(await deleteChosenProject(refusing, { project: "old", typed: "old", snapshot: true, onDeleted }), { failed: "The project was not deleted: A live session is working in “old”." });
  assert.deepEqual(calls, [], "a refused deletion is not reported as deleted");
});
