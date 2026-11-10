/** Capability 2 · Focus selection: the map's focus tool, as its tool part serves it on the MCP server. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { capabilitiesCommand } from "./read.js";
import { mapTools } from "./tools.js";

test("2.7 the focus tool refuses a call that gives neither select nor crossing, or a crossing with a select that names no imported story or with dry_run, before it reads anything", async () => {
  const tools: Record<string, (args: Record<string, unknown>, call: never) => Promise<unknown>> = {};
  const unreadHost = { imports: () => { throw new Error("read"); }, heldBack: () => undefined };
  mapTools(unreadHost).registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
  // A call whose library and connection throw on any read: a refusal must come first.
  const unread = () => { throw new Error("read"); };
  const call = { library: new Proxy({}, { get: unread }), storytree: new Proxy({}, { get: unread }), folder: "/nowhere" } as never;
  await assert.rejects(tools.focus!({}, call), /^Error: Give select, or crossing\.$/);
  await assert.rejects(tools.focus!({ crossing: ["src"], select: "cap:2" }, call), /^Error: With crossing, select names an imported story: story:<name>\.$/);
  await assert.rejects(tools.focus!({ crossing: ["src"], mode: "dry_run" }, call), /^Error: A crossing answers counts or show\.$/);
});

test("2.8 with capabilities and select story:<name>, the focus tool answers that story's capability tree as the map command's --capabilities does, as text and as data, and refuses it with crossing or a select that names no story before it reads anything", async () => {
  const tools: Record<string, (args: Record<string, unknown>, call: never) => Promise<{ text: string; data?: unknown }>> = {};
  mapTools({ imports: async () => [], heldBack: () => undefined }).registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
  const unread = () => { throw new Error("read"); };
  const unreadCall = { library: new Proxy({}, { get: unread }), storytree: new Proxy({}, { get: unread }), folder: "/nowhere" } as never;
  await assert.rejects(tools.focus!({ capabilities: true, select: "cap:2" }, unreadCall), /^Error: capabilities answers for one story: select story:<name>, with no crossing\.$/);
  await assert.rejects(tools.focus!({ capabilities: true, select: "story:The app", crossing: ["src"] }, unreadCall), /^Error: capabilities answers for one story: select story:<name>, with no crossing\.$/);

  const folder = await mkdtemp(path.join(tmpdir(), "focus-capabilities-"));
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;\n\nexport const more = 2;\n");
    await writeFile(path.join(folder, "packages/app/src/view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);');
    const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
    const plan = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [
      { id: "projects", title: "2 · Projects", health, status: "healthy", dependsOn: [], contracts: [{ id: "empty", title: "2.5 · empty view", health }] },
    ] }] };
    const library = { name: "fixture", projectTree: async () => plan };
    const call = { library, storytree: {}, folder } as never;

    const answer = await tools.focus!({ capabilities: true, select: "story:The app" }, call);

    assert.deepEqual(answer.data, JSON.parse(await capabilitiesCommand(library as never, folder, "story:The app", true)));
    assert.equal(answer.text, await capabilitiesCommand(library as never, folder, "story:The app"));
    assert.match(answer.text, /2 · Projects  \[projects\]  healthy; 2 lines in 1 file; 1 contract/);
  } finally {
    await removeTemp(folder);
  }
});
