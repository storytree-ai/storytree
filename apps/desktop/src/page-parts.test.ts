/**
 * The frame mounting its stories' page operations from their manifests (capability 1 · Lifecycle, ADR-1021): the main
 * process answers the page parts the plugin loader composes, and the page's bridge offers the channels it composes, so
 * neither main.ts nor bridge.ts names the story. Lag in real use is the story mounted this way.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { readReadings } from "@storytree/lag-in-use";
import { partsPlugin } from "@storytree/plugin-loader";

import pageAnswers from "#parts/pageAnswers";
import pageChannels from "#parts/pageChannels";

import { createBridge } from "./bridge.js";
import { answerPageParts } from "./page-operations.js";

test("1.18 a story's page operations its package's manifest names are answered in the main process and offered to the page, the frame naming no story: a lag reading the page sends is kept in the app's home, stamped with the app's version", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-page-parts-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  answerPageParts({ handle: (channel, listener) => { handlers.set(channel, listener); } }, pageAnswers, { home, appVersion: "0.3.99" });

  const page = createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args));
  await page.recordLag([{ name: "open-island", response: 40, longFrames: 1, longestFrame: 72, settled: 300, progress: false }]);
  assert.deepEqual(readReadings(home).map(({ name, version, settled }) => ({ name, version, settled })), [{ name: "open-island", version: "0.3.99", settled: 300 }]);

  // The preload is bundled: its channels are the loader's build plugin's composition, the same as run unbundled.
  const desktop = fileURLToPath(new URL("..", import.meta.url));
  const out = mkdtempSync(path.join(tmpdir(), "storytree-page-channels-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const outfile = path.join(out, "page-channels.mjs");
  await build({ stdin: { contents: `export { default } from "#parts/pageChannels";`, resolveDir: desktop }, outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent", plugins: [partsPlugin()] });
  const { default: bundled } = await import(pathToFileURL(outfile).href) as { default: unknown };
  assert.deepEqual(bundled, pageChannels);
});
