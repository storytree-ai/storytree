/** Capability 12 · Import an existing project: the import_project tool, as App setup's tool part serves it on the MCP server. */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { setupToolParts } from "./tools.js";

test("12.3 · the import_project tool answers a folder that does not exist with the refusal saying there is nothing to import, marked refused, reading nothing", async () => {
  const tools: Record<string, (args: Record<string, unknown>, call: never) => Promise<{ text: string; refused?: boolean }>> = {};
  for (const part of setupToolParts) part({}).registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
  // A call whose library and connection throw on any read: the refusal comes first.
  const unread = () => { throw new Error("read"); };
  const call = { library: new Proxy({}, { get: unread }), storytree: new Proxy({}, { get: unread }), project: "shop", folder: path.resolve("/nowhere-here") } as never;
  const answered = await tools.import_project!({ folder: "gone" }, call);
  assert.equal(answered.refused, true);
  assert.match(answered.text, /gone does not exist, so there is nothing to import\.$/);
});
