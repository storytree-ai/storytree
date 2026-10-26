/**
 * The page mounting a factory plugin's surface views (capability 2 · Storytree projects; plugin loader capability 5): each
 * view module is imported where the window serves it, at run time, and mounted while its surface is on.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { mountPluginViews } from "./plugin-views.js";

test("2.17 the page imports each switched-on stand-in surface's view where the window serves it and mounts it with the project and the bridge, leaves a switched-off one unloaded, says one that cannot be loaded while the rest mount, and stops what it mounted", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-plugin-views-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, text: string): string => {
    writeFileSync(path.join(dir, name), text);
    return pathToFileURL(path.join(dir, name)).href;
  };
  const drawn = file("drawn.mjs", `export function mount(host, { project, bridge }) {
    host.drawn.push(project + " with " + bridge.name);
    return { stop() { host.drawn.push("stopped " + project); } };
  }\n`);
  const off = file("off.mjs", `throw new Error("a switched-off view is never imported");\n`);
  const broken = file("broken.mjs", `export const nothing = 1;\n`);

  const host = { drawn: [] as string[] } as unknown as HTMLElement & { drawn: string[] };
  const mounted = await mountPluginViews(host, [
    { surface: "my-lag", url: drawn },
    { surface: "my-off", url: off },
    { surface: "my-broken", url: broken },
  ], (surface) => surface !== "my-off", { project: "storytree", bridge: { name: "the bridge" } });

  assert.deepEqual(host.drawn, ["storytree with the bridge"]);
  assert.deepEqual(mounted.failed.map(({ surface }) => surface), ["my-broken"]);
  assert.match(mounted.failed[0]!.why, /exports no mount/);
  mounted.stop();
  assert.deepEqual(host.drawn, ["storytree with the bridge", "stopped storytree"]);
});
