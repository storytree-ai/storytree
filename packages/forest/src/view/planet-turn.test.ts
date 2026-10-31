import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { waitUntil } from "@storytree/test-waits";

/** The real map view, bundled for the browser and mounted on a two-story plan: the capture seam counts its renders.
 * `__show(titles)` hands it the plan again, a live update, with the stories' titles as given. */
async function mapBundle(): Promise<string> {
  const entry = `import { createElement } from "react";
    import { createRoot } from "react-dom/client";
    import { workStates } from "@storytree/arc-surface";
    import { createKnowledgeCore } from "@storytree/knowledge-core/view";
    import { forestScene, storyNodes } from ${JSON.stringify(path.join(import.meta.dirname, "../index.ts"))};
    import { PlanetView } from ${JSON.stringify(path.join(import.meta.dirname, "planet-view.tsx"))};
    const health = { reported: { state: "passing" }, verified: { state: "passing" } };
    const capability = id => ({ id: id + "-cap", title: "1 · " + id, dependsOn: [], proposed: false, status: "healthy", contracts: [], health });
    const plan = titles => ({ arcs: [], stories: ["one", "two"].map((id, index) => ({ id, title: titles[index], health, capabilities: [capability(id)] })) });
    const history = ["one", "two"].map((id, index) => ({ seq: index + 1, recordId: id, type: "story", action: "created",
      record: { id, type: "story", version: 1, fields: { title: id }, createdAt: new Date(index).toISOString(), updatedAt: new Date(index).toISOString() } }));
    const places = new Map(storyNodes(plan(["one", "two"]), history).map(node => [node.id, node.place]));
    const core = createKnowledgeCore("app"), root = createRoot(document.querySelector("#map"));
    globalThis.__show = titles => root.render(createElement(PlanetView, { core, scene: forestScene(plan(titles), history, workStates([])), places, wisps: [],
      selected: undefined, onPick: () => {}, onNote: () => {} }));
    globalThis.__show(["one", "two"]);`;
  const result = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "js" }, bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".glb": "binary" },
    banner: { js: "globalThis.__renders = 0; globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__renders++; globalThis.__nav = nav; };" },
  });
  return result.outputFiles[0]!.text;
}

/** A page with the map mounted, once it has opened and stopped rendering. */
async function openedMap(t: { after(run: () => Promise<void>): void }) {
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
  return { page, renders };
}

test("3.71 · a drag that turns the glass sheet renders the map view a fixed few times, however many steps it takes, and the sheet still turns", async t => {
  const { page, renders } = await openedMap(t);
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

test("3.72 · a burst of live updates that change no island's land, coast or tints keeps its territories' geometry", async t => {
  const { page } = await openedMap(t);
  type Scene = { getObjectByName(name: string): { getObjectByName(name: string): unknown } | undefined };
  // Each island's territories as drawn, kept on the page to compare with what is drawn after the burst.
  await page.evaluate(() => {
    const page = window as unknown as { __globe: { scene: Scene }; __drawn: unknown[] };
    page.__drawn = ["one", "two"].map(story => page.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName("territory-land"));
    return page.__drawn.every(drawn => drawn !== undefined);
  }).then(drawn => assert.ok(drawn, "each island draws its territories"));
  // Each update renames a story: its island is drawn again for its name, and its land is the same.
  for (const titles of [["One", "two"], ["One", "Two"], ["one", "Two"], ["one", "two"]]) {
    await page.evaluate(titles => (window as unknown as { __show(titles: string[]): void }).__show(titles), titles);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const kept = await page.evaluate(() => {
    const { __globe: globe, __drawn: drawn } = window as unknown as { __globe: { scene: Scene }; __drawn: unknown[] };
    return ["one", "two"].map((story, index) => {
      const now = globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName("territory-land");
      return now !== undefined && now === drawn[index];
    });
  });
  assert.deepEqual(kept, [true, true], "each island's territories are the objects drawn before the burst");
});

test("3.73 · once the map has opened, every material on it has its shader program, shown or hidden, so no turn stops to compile one", async t => {
  const { page } = await openedMap(t);
  const uncompiled = await page.evaluate(() => {
    type Drawn = { name: string; type: string; material?: object | object[]; isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
    const { __globe: globe } = window as unknown as { __globe: { gl: { properties: { get(material: object): { currentProgram?: unknown } } }; scene: { traverse(visit: (object: Drawn) => void): void } } };
    const missing: string[] = [];
    globe.scene.traverse(object => {
      if (!(object.isMesh || object.isLine || object.isPoints || object.isSprite)) return;
      for (const material of [object.material ?? []].flat()) if (globe.gl.properties.get(material).currentProgram === undefined) missing.push(object.name || object.type);
    });
    return missing;
  });
  assert.deepEqual(uncompiled, []);
});
