/**
 * The frame mounting its stories' page operations from their manifests (capability 1 · Lifecycle, ADR-1021): the main
 * process answers the page parts the plugin loader composes, and the page's bridge offers the channels it composes, so
 * neither main.ts nor bridge.ts names the story. Lag in real use is the story mounted this way.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import type { AnnotatedTree } from "@storytree/library";

import { readReadings } from "@storytree/app/lag";
import { readSettings } from "@storytree/project-and-caller";
import { partsPlugin } from "@storytree/plugin-loader";

import pageAnswers from "./main/parts/page-answers.js";
import pageChannels from "./parts/page-channels.js";

import { createBridge } from "./bridge.js";
import { answerPageParts } from "./page-operations.js";

/** The feedback corner's side of the frame, which these tests do not use: nothing declared, no library, no window. */
const NO_FEEDBACK = { declaredSurfaces: [], server: () => undefined, captureWindow: async () => undefined };

test("1.18 a story's page operations its package's manifest names are answered in the main process and offered to the page, the frame naming no story: a lag reading the page sends is kept in the app's home, stamped with the app's version", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-page-parts-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  answerPageParts({ handle: (channel, listener) => { handlers.set(channel, listener); } }, pageAnswers, pageChannels, {
    home,
    appVersion: "0.3.99",
    library: () => { throw new Error("the library is not open"); },
    treeRead: () => undefined,
    surveyWorker: path.join(home, "survey-worker.cjs"),
    ...NO_FEEDBACK,
  });

  assert.equal(import.meta.resolve("#parts/pageAnswers"), new URL("./main/parts/page-answers.ts", import.meta.url).href, "the app's #parts/pageAnswers is its composing module");
  assert.equal(import.meta.resolve("#parts/pageChannels"), new URL("./parts/page-channels.ts", import.meta.url).href, "the app's #parts/pageChannels is its composing module");
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

test("1.18 the settings panel's page operations its manifest names are answered from the frame's home: a setting the page saves reaches the settings file there, and the page reads it back", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-page-settings-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  answerPageParts({ handle: (channel, listener) => { handlers.set(channel, listener); } }, pageAnswers, pageChannels, {
    home,
    appVersion: "0.3.99",
    library: () => { throw new Error("the library is not open"); },
    treeRead: () => undefined,
    surveyWorker: path.join(home, "survey-worker.cjs"),
    ...NO_FEEDBACK,
  });

  const page = createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args));
  assert.equal((await page.saveSetting("context-guidance", ["420000"])).ok, true);
  assert.equal(readSettings(home)["context-guidance"]?.value, 420000);
  const read = await page.readSettings();
  assert.equal(read.ok && read.value["context-guidance"]?.value, 420000);
});

test("1.18 the forest's code survey its manifest names is answered from what the frame offers: the open library's project folder and imports, the tree the page last read, and the bundled survey worker", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-page-survey-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  // The worker bundled as build.mjs bundles it, resolved through the forest package the survey mounts from.
  const surveyWorker = path.join(folder, "survey-worker.cjs");
  const worker = createRequire(fileURLToPath(import.meta.resolve("@storytree/forest/code-survey"))).resolve("@storytree/map/code-survey/worker");
  await build({ entryPoints: [worker], outfile: surveyWorker, bundle: true, format: "cjs", platform: "node", target: "node22", logLevel: "silent" });
  const checkout = path.join(folder, "checkout");
  mkdirSync(path.join(checkout, "packages", "shop", "src"), { recursive: true });
  writeFileSync(path.join(checkout, "packages", "shop", "src", "claim.ts"), "export const claim = 1;\n");
  const tree = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-claims", title: "3 · Claims" }] }] } as unknown as AnnotatedTree;
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  answerPageParts({ handle: (channel, listener) => { handlers.set(channel, listener); } }, pageAnswers, pageChannels, {
    home: folder,
    appVersion: "0.3.99",
    library: () => ({
      projectFolder: async (project: unknown) => project === "shop" ? checkout : undefined,
      // The page read the tree already, so the survey must not read it again.
      projectTree: async () => { throw new Error("the tree was read a second time"); },
      projectImports: async () => [],
    }),
    treeRead: (project) => project === "shop" ? tree : undefined,
    surveyWorker,
    ...NO_FEEDBACK,
  });

  const page = createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args));
  const survey = await page.codeSurvey("shop");
  assert.deepEqual(survey["story-shop"]?.files, [{ path: "src/claim.ts", lines: 1 }]);
  assert.deepEqual(await page.codeSurvey("elsewhere"), {}, "a project with no checkout here has no survey");
});

test("1.20 the page operations of a part this computer switches off are not answered: each of its channels refuses, saying the part is off and how to switch it on, and the rest are answered", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-page-parts-off-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  answerPageParts({ handle: (channel, listener) => { handlers.set(channel, listener); } }, pageAnswers, pageChannels, {
    home,
    appVersion: "0.3.99",
    library: () => { throw new Error("the library is not open"); },
    treeRead: () => undefined,
    surveyWorker: path.join(home, "survey-worker.cjs"),
    ...NO_FEEDBACK,
  }, ["app"]);

  const page = createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args));
  await assert.rejects(page.recordLag([]), /app is switched off on this computer\. Switch it on with: storytree settings set part app on/);
  assert.deepEqual(readReadings(home), [], "nothing was kept");
  assert.equal((await page.saveSetting("context-guidance", ["420000"])).ok, true, "the core's settings panel is still answered");
});
