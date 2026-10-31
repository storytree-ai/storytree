import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { waitUntil } from "@storytree/test-waits";

/** The real map view, bundled for the browser and mounted on a two-story plan: the capture seam counts its renders. */
async function mapBundle(): Promise<string> {
  const entry = `import { createElement } from "react";
    import { createRoot } from "react-dom/client";
    import { workStates } from "@storytree/arc-surface";
    import { createKnowledgeCore } from "@storytree/knowledge-core/view";
    import { forestScene, storyNodes } from ${JSON.stringify(path.join(import.meta.dirname, "../index.ts"))};
    import { PlanetView } from ${JSON.stringify(path.join(import.meta.dirname, "planet-view.tsx"))};
    const health = { reported: { state: "not-checked" }, verified: { state: "not-checked" } };
    const tree = { arcs: [], stories: ["one", "two"].map(id => ({ id, title: id, health, capabilities: [] })) };
    const history = tree.stories.map(({ id }, index) => ({ seq: index + 1, recordId: id, type: "story", action: "created",
      record: { id, type: "story", version: 1, fields: { title: id }, createdAt: new Date(index).toISOString(), updatedAt: new Date(index).toISOString() } }));
    const scene = forestScene(tree, history, workStates([]));
    const places = new Map(storyNodes(tree, history).map(node => [node.id, node.place]));
    createRoot(document.querySelector("#map")).render(createElement(PlanetView, { core: createKnowledgeCore("app"), scene, places, wisps: [],
      selected: undefined, onPick: () => {}, onNote: () => {} }));`;
  const result = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "js" }, bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".glb": "binary" },
    banner: { js: "globalThis.__renders = 0; globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__renders++; globalThis.__nav = nav; };" },
  });
  return result.outputFiles[0]!.text;
}

test("3.71 · a drag that turns the glass sheet renders the map view a fixed few times, however many steps it takes, and the sheet still turns", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  await page.addScriptTag({ content: await mapBundle() });
  await page.waitForFunction(() => {
    const { __globe: globe, __nav: nav } = window as unknown as { __globe?: { scene: { getObjectByName(name: string): unknown } }; __nav?: unknown };
    return nav !== undefined && globe?.scene.getObjectByName("planet:two") !== undefined;
  }, undefined, { timeout: 60_000 });
  const renders = () => page.evaluate(() => (window as unknown as { __renders: number }).__renders);
  // The opening settles: the sheet opens framed and the islands report their places, then the view stops rendering.
  let last = -1;
  await waitUntil(async () => { const now = await renders(); const still = now === last; last = now; return still; }, 30_000, "the map view to stop rendering after it opens");
  const turn = () => page.evaluate(() => (window as unknown as { __globe: { scene: { getObjectByName(name: string): { quaternion: { toArray(): number[] } } } } })
    .__globe.scene.getObjectByName("globe").quaternion.toArray());
  const before = await turn();
  await page.evaluate(() => { (window as unknown as { __renders: number }).__renders = 0; });

  // A Ctrl+drag spins and tilts the sheet; sixty steps, each drawn on the next frame.
  await page.keyboard.down("Control");
  await page.mouse.move(400, 300);
  await page.mouse.down();
  for (let step = 1; step <= 60; step++) {
    await page.mouse.move(400 + step * 4, 300 + step);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  await page.keyboard.up("Control");
  // The drag's last step is drawn on the frame after it.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const rendered = await renders();
  assert.ok(rendered <= 3, `a 60-step drag rendered the map view ${rendered} times`);
  assert.notDeepEqual(await turn(), before, "the drag turned the sheet's group");
});
