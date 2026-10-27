/**
 * A factory plugin standing in for a switched-off part, in the window (capability 1 · Lifecycle; plugin loader capability 5):
 * the main process composes the factory's stand-ins into its page answers, page channels and surfaces, offers the page
 * the stand-in's channels and views, and serves a view only from a mounted stand-in's exported files.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { PLUGIN_INTERFACE } from "@storytree/plugin-loader";

import { createBridge } from "./bridge.js";
import { pluginResponse, windowKinds, windowStandIns, type WindowParts } from "./main/stand-ins.js";
import { answerPageParts, type PageFrame } from "./page-operations.js";
import pageChannels from "./parts/page-channels.js";

/** The channel the page's bridge sends a lag reading on, which a stand-in for the part reuses. */
const LAG = pageChannels.parts.find((channels) => "recordLag" in channels)!.recordLag!;
const VIEW = "export function mount(host, context) { host.drawn = context.project; }\n";

/** A factory folder holding plugin `my-lag`, which stands in for the part `lag` with a page operation and a surface with a view. */
function factory(t: TestContext): string {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-window-factory-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const dir = path.join(folder, "plugins", "my-lag");
  mkdirSync(dir, { recursive: true });
  const kinds = { pageAnswers: "./page", pageChannels: "./page", surfaces: "./page" };
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "my-lag",
    type: "module",
    exports: { "./page": "./page.js", "./view": "./view.js" },
    storytree: { interface: PLUGIN_INTERFACE, ...Object.fromEntries(Object.entries(kinds).map(([kind, from]) => [kind, [{ from, export: kind }]])) },
  }));
  writeFileSync(path.join(dir, "page.js"), [
    `export const pageChannels = [{ recordLag: ${JSON.stringify(LAG)} }];`,
    `export const pageAnswers = [(frame) => ({ channels: pageChannels[0], answers: { recordLag: (readings) => \`my-lag kept \${readings.length} in \${frame.home}\` } })];`,
    `export const surfaces = [{ id: "my-lag", name: "My lag", description: "Lag, my way", switchable: true, settings: [], view: "./view" }];`,
  ].join("\n"));
  writeFileSync(path.join(dir, "view.js"), VIEW);
  writeFileSync(path.join(dir, "secret.txt"), "not exported");
  return folder;
}

const graph = { lag: ["library"], forest: ["library"], library: [] };
const builtIn: WindowParts = {
  pageAnswers: { parts: [() => ({ channels: { recordLag: LAG }, answers: { recordLag: () => "built-in lag" } })], owners: ["lag"], graph },
  pageChannels: { parts: [{ recordLag: LAG }], owners: ["lag"], graph },
  surfaces: { parts: [{ id: "lag", name: "Lag", description: "", switchable: true, settings: [] }, { id: "globe", name: "Globe", description: "", switchable: false, settings: [] }], owners: ["lag", "forest"], graph },
};
const frame = { home: "the-home" } as PageFrame;

/** The page's bridge over the main process's handlers, as answered with `off` switched off; a channel answered twice throws, as Electron's does. */
function window(composed: ReturnType<typeof windowStandIns>, off: readonly string[]) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  answerPageParts({
    handle: (channel, listener) => {
      if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
      handlers.set(channel, listener);
    },
  }, composed.pageAnswers, composed.pageChannels, frame, off);
  return createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args), { standIns: composed.page });
}

test("1.24 a factory plugin standing in for a switched-off part answers its page operations in the part's place, no channel answered twice, and offers the page its channels and its surface's view; switched back on, the built-in part's are", async (t) => {
  const folder = factory(t);
  const standIns = { folder, plugins: { lag: "my-lag" } };

  const off = windowStandIns(builtIn, standIns, ["lag"]);
  const page = window(off, ["lag"]);
  assert.equal(await page.recordLag([{}, {}]), "my-lag kept 2 in the-home");
  assert.deepEqual(page.pluginViews, [{ surface: "my-lag", url: "storytree-plugin://factory/my-lag/view" }]);
  assert.deepEqual(off.surfaces.parts.map((surface) => surface.id), ["lag", "my-lag", "globe"]);

  const on = windowStandIns(builtIn, standIns, []);
  assert.deepEqual(on.page, { channels: [], views: [] });
  const builtInPage = window(on, []);
  assert.equal(await builtInPage.recordLag([]), "built-in lag");
  assert.deepEqual(builtInPage.pluginViews, []);
});

test("plugin-loader 5.13 · a factory plugin that adds a part, standing in for none, offers the page its surface's view while the setting names it, after the built-in surfaces, and the window's scheme serves it; with the setting dropped, neither", (t) => {
  const folder = factory(t);
  const standIns = { folder, plugins: { "my-lag": "my-lag" } };
  const added = windowStandIns(builtIn, standIns, ["my-lag"]);
  assert.deepEqual(added.page.views, [{ surface: "my-lag", url: "storytree-plugin://factory/my-lag/view" }]);
  assert.deepEqual(added.surfaces.parts.map((surface) => surface.id), ["lag", "globe", "my-lag"]);
  assert.deepEqual([...added.served.plugins], ["my-lag"]);
  const dropped = windowStandIns(builtIn, standIns, []);
  assert.deepEqual(dropped.page.views, []);
  assert.deepEqual([...dropped.served.plugins], []);
});

test("1.24 the window's own scheme serves a view only from a mounted stand-in's exported files: a name it does not export, a path out of its folder, or a plugin standing in for no switched-off part is refused", async (t) => {
  const folder = factory(t);
  const composed = windowStandIns(builtIn, { folder, plugins: { lag: "my-lag" } }, ["lag"]);

  const served = pluginResponse("storytree-plugin://factory/my-lag/view", composed.served);
  assert.equal(served.status, 200);
  assert.match(served.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.equal(await served.text(), VIEW);

  for (const url of [
    "storytree-plugin://factory/my-lag/secret.txt",
    "storytree-plugin://factory/my-lag/package.json",
    "storytree-plugin://factory/my-lag/%2E%2E/%2E%2E/plugins/my-lag/secret.txt",
    "storytree-plugin://factory/..%2Fmy-lag/view",
    "storytree-plugin://elsewhere/my-lag/view",
  ]) assert.equal(pluginResponse(url, composed.served).status, 404, url);

  const switchedOn = windowStandIns(builtIn, { folder, plugins: { lag: "my-lag" } }, []);
  const refused = pluginResponse("storytree-plugin://factory/my-lag/view", switchedOn.served);
  assert.equal(refused.status, 404);
  assert.match(await refused.text(), /my-lag stands in for no switched-off part/);
});

test("1.42 the app opens its projects with the kinds of record a factory plugin standing in for a switched-off part declares, none while the part is on, and logs a plugin whose kinds cannot be read as a stand-in that failed (ADR-1178 D3)", (t) => {
  const folder = factory(t);
  const file = path.join(folder, "plugins", "my-lag", "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const reading = { kind: "my-lag.reading", version: 1, fields: { type: "object", properties: { ms: { type: "number" } } }, writers: ["my_lag"] };
  const declare = (kind: object) => writeFileSync(file, JSON.stringify({ ...manifest, storytree: { ...manifest.storytree, recordKinds: [kind] } }));
  const standIns = { folder, plugins: { lag: "my-lag" } };
  const logged: string[] = [];
  const log = (line: string) => void logged.push(line);

  declare(reading);
  assert.deepEqual(windowKinds(graph, standIns, ["lag"], log), [reading]);
  assert.deepEqual(windowKinds(graph, standIns, [], log), [], "with lag on, my-lag is not mounted and declares none");
  assert.deepEqual(logged, []);

  declare({ ...reading, kind: "lag.reading" });
  assert.deepEqual(windowKinds(graph, standIns, ["lag"], log), []);
  assert.deepEqual(logged, [`lag is switched off on this computer, and its stand-in my-lag's record kinds could not be read: my-lag's record kind "lag.reading" is not named my-lag.<kind>. Switch it on with: storytree settings set part lag on`]);
});
