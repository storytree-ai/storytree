/** Capability 2 · Focus selection: the map's focus tool, as its tool part serves it on the MCP server. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { mapTools } from "./tools.js";

test("2.7 the focus tool refuses a call that gives neither select nor crossing, or a crossing with a select that names no mapped story or with dry_run, before it reads anything", async () => {
  const tools: Record<string, (args: Record<string, unknown>, call: never) => Promise<unknown>> = {};
  const unreadHost = { imports: () => { throw new Error("read"); }, heldBack: () => undefined };
  mapTools(unreadHost).registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
  // A call whose library and connection throw on any read: a refusal must come first.
  const unread = () => { throw new Error("read"); };
  const call = { library: new Proxy({}, { get: unread }), storytree: new Proxy({}, { get: unread }), folder: "/nowhere" } as never;
  await assert.rejects(tools.focus!({}, call), /^Error: Give select, or crossing\.$/);
  await assert.rejects(tools.focus!({ crossing: ["src"], select: "cap:2" }, call), /^Error: With crossing, select names a mapped story: story:<name>\.$/);
  await assert.rejects(tools.focus!({ crossing: ["src"], mode: "dry_run" }, call), /^Error: A crossing answers counts or show\.$/);
});
