import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { waitUntil } from "@storytree/test-waits";

/** The real map view, bundled for the browser and mounted on a two-story plan: the capture seam counts its renders.
 * `__show(titles)` hands it the plan again, a live update, with the stories' titles as given. `linked` gives each story a
 * second capability its first depends on, and story one's first depends on story two's, so each island has roads.
 * `__zoom()` reads the eye's zoom the map shows its detail by. */
async function mapBundle(linked = false): Promise<string> {
  const entry = `import { createElement } from "react";
    import { createRoot } from "react-dom/client";
    import { workStates } from "@storytree/arc-surface";
    import { createKnowledgeCore } from "@storytree/knowledge-core/view";
    import { forestScene, storyNodes } from ${JSON.stringify(path.join(import.meta.dirname, "../index.ts"))};
    import { PlanetView } from ${JSON.stringify(path.join(import.meta.dirname, "planet-view.tsx"))};
    import { sheetEyeZoom } from "@storytree/forest-world/planet";
    const linked = ${JSON.stringify(linked)};
    const health = { reported: { state: "passing" }, verified: { state: "passing" } };
    const capability = (id, dependsOn = []) => ({ id: id + "-cap", title: "1 · " + id, dependsOn, proposed: false, status: "healthy", contracts: [], health });
    const capabilities = id => !linked ? [capability(id)]
      : [capability(id, [id + "-b-cap", ...(id === "one" ? ["two-cap"] : [])]), { ...capability(id + "-b"), title: "2 · " + id }];
    const plan = titles => ({ arcs: [], stories: ["one", "two"].map((id, index) => ({ id, title: titles[index], health, capabilities: capabilities(id) })) });
    const history = ["one", "two"].map((id, index) => ({ seq: index + 1, recordId: id, type: "story", action: "created",
      record: { id, type: "story", version: 1, fields: { title: id }, createdAt: new Date(index).toISOString(), updatedAt: new Date(index).toISOString() } }));
    const places = new Map(storyNodes(plan(["one", "two"]), history).map(node => [node.id, node.place]));
    const core = createKnowledgeCore("app"), root = createRoot(document.querySelector("#map"));
    globalThis.__show = titles => root.render(createElement(PlanetView, { core, scene: forestScene(plan(titles), history, workStates([])), places, wisps: [],
      selected: undefined, onPick: () => {}, onNote: () => {} }));
    globalThis.__zoom = () => sheetEyeZoom(globalThis.__globe.camera, globalThis.__globe.size);
    globalThis.__show(["one", "two"]);`;
  const result = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "js" }, bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".glb": "binary" },
    banner: { js: "globalThis.__renders = 0; globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__renders++; globalThis.__nav = nav; };" },
  });
  return result.outputFiles[0]!.text;
}

/** A page with the map mounted, once it has opened and stopped rendering. */
async function openedMap(t: { after(run: () => Promise<void>): void }, linked = false, viewport = { width: 800, height: 600 }) {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport });
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  await page.addScriptTag({ content: await mapBundle(linked) });
  await page.waitForFunction(() => {
    const { __globe: globe, __nav: nav } = window as unknown as { __globe?: { scene: { getObjectByName(name: string): unknown } }; __nav?: unknown };
    return nav !== undefined && globe?.scene.getObjectByName("planet:two") !== undefined;
  }, undefined, { timeout: 60_000 });
  const renders = () => page.evaluate(() => (window as unknown as { __renders: number }).__renders);
  // The opening settles: the sheet opens framed and the islands report their places, then the view stops rendering, and
  // each island's land, built in its turn (3.87), with its roads when it has links, stands as built. A land rebuilt for
  // roads that came after it traces its cut borders on over frames that render nothing, so it stands only once they are whole.
  const built = () => page.evaluate(linked => {
    type Part = { uuid: string; geometry?: { drawRange: { count: number } } };
    const { __globe: globe, __renders: renders } = window as unknown as { __renders: number; __globe: { scene: { getObjectByName(name: string): { getObjectByName(name: string): Part | undefined } | undefined } } };
    const lands = ["one", "two"].map(story => globe.scene.getObjectByName(`planet:${story}`));
    const drawn = lands.map(island => island?.getObjectByName("territory-land")?.uuid);
    const routed = !linked || lands.every(island => island?.getObjectByName("island-roads") !== undefined);
    const whole = lands.every(island => (island?.getObjectByName("territory-borders")?.geometry?.drawRange.count ?? Infinity) === Infinity);
    return drawn.every(uuid => uuid !== undefined) && routed && whole ? JSON.stringify([renders, drawn]) : undefined;
  }, linked);
  let last: string | undefined;
  await waitUntil(async () => { const now = await built(); const still = now !== undefined && now === last; last = now; return still; }, 30_000, "the map view to stop rendering after it opens, its islands' land built");
  // A land built last compiles its shaders on the frame after.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return { page, renders };
}

test("3.87 · an island on the map as it opens has its land stand when it is built, however late its turn comes, never traced on", async t => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  // Every turn the page hands on comes 1.5 s late, so each island's land is built well after the sheet first drew.
  await page.evaluate(() => {
    const later = window.setTimeout.bind(window);
    window.setTimeout = ((run: () => void, ms?: number) => later(run, ms ? ms : 1500)) as typeof window.setTimeout;
  });
  // Linked, so each island has two territories and a border between them to trace.
  await page.addScriptTag({ content: await mapBundle(true) });
  // Each frame, until island one's borders are first drawn, which is when they are read: whole, or how far traced on.
  // As a script, since a named function in an evaluated one would need the bundler's helper.
  await page.addScriptTag({ content: `(function look() {
    const lines = window.__globe?.scene.getObjectByName("planet:one")?.getObjectByName("territory-borders");
    if (lines === undefined) { requestAnimationFrame(look); return; }
    window.__first = { whole: lines.geometry.drawRange.count === Infinity, at: window.__globe.clock.getElapsedTime() };
  })();` });
  await waitUntil(() => page.evaluate(() => (window as unknown as { __first?: unknown }).__first !== undefined), 60_000, "island one's land to be built");
  const borders = await page.evaluate(() => (window as unknown as { __first: { whole: boolean; at: number } }).__first);
  assert.ok(borders.at > 1, `the land was built ${borders.at} s after the map opened`);
  assert.ok(borders.whole, "its borders stand whole on the first frame they are drawn");
});

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

test("3.86 · an island nobody selected is laid out with its roads; zooming out past the threshold hides its roads, the territories stay shown down to the wheel's floor, zooming back shows the roads, and the shapes never change", async t => {
  // A small window, so the whole map opens below the near marks' zoom and the wheel can draw back to its floor.
  const { page } = await openedMap(t, true, { width: 400, height: 300 });
  type Mark = { visible: boolean; parent: Mark | null; geometry?: { getAttribute(name: string): { array: ArrayLike<number> } } };
  type Scene = { getObjectByName(name: string): { getObjectByName(name: string): Mark | undefined } | undefined };
  const island = () => page.evaluate(() => {
    const { __globe: globe, __zoom: zoom } = window as unknown as { __globe: { scene: Scene }; __zoom(): number };
    const plate = globe.scene.getObjectByName("planet:one");
    const roads = plate?.getObjectByName("island-roads"), borders = plate?.getObjectByName("territory-borders");
    // Shown when it and everything it hangs from is visible (a named function here would need the bundler's helper).
    const [roadsShown, bordersShown] = [roads, borders].map(mark => {
      let shown = mark !== undefined;
      for (let at: Mark | null | undefined = mark; at; at = at.parent) shown &&= at.visible;
      return shown;
    });
    return { zoom: zoom(), roads: roads === undefined ? undefined : roadsShown, territories: bordersShown,
      borders: Array.from(borders?.geometry?.getAttribute("position").array ?? []) };
  });
  const wheel = async (by: number, until: (now: Awaited<ReturnType<typeof island>>) => boolean, what: string) => {
    await page.mouse.move(200, 150);
    for (let step = 0; step < 80; step++) {
      const now = await island();
      if (until(now)) return now;
      await page.mouse.wheel(0, by);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    throw new Error(`the wheel never reached ${what}; ${JSON.stringify({ ...(await island()), borders: undefined })}`);
  };
  const near = await wheel(-240, now => now.roads === true, "an island not selected with its roads shown, near");
  const territories = await wheel(240, now => now.roads === false, "the roads hidden");
  assert.equal(territories.territories, true, "the territories still show where the roads hide");
  // Drawn back until a step of the wheel moves the eye no further: its floor.
  let before = Infinity;
  const floor = await wheel(240, now => { const still = now.zoom >= before * 0.999; before = now.zoom; return still; }, "its floor");
  assert.ok(floor.zoom < territories.zoom && territories.zoom < near.zoom, "the eye drew back past the roads' threshold to the floor");
  assert.equal(floor.territories, true, "the territories still show at the wheel's floor");
  const back = await wheel(-240, now => now.roads === true && now.territories === true, "everything shown again, near");
  for (const seen of [territories, floor, back]) assert.deepEqual(seen.borders, near.borders, "the territories' borders keep their shape at every zoom");
});

test("3.73 · roads that arrive hidden, after the map opened, have their shader programs too, so the zoom that first shows them stops to compile none", async t => {
  // A window small enough that the map opens below the near marks' zoom, so every island's roads arrive hidden.
  const { page } = await openedMap(t, true, { width: 400, height: 300 });
  type Drawn = { name: string; visible: boolean; parent: Drawn | null; material?: object | object[]; isMesh?: boolean; isLine?: boolean };
  type Globe = { gl: { properties: { get(material: object): { currentProgram?: unknown } } }; scene: { getObjectByName(name: string): { traverse(visit: (object: Drawn) => void): void; visible: boolean } | undefined } };
  await waitUntil(() => page.evaluate(() => {
    const roads = (window as unknown as { __globe: Globe }).__globe.scene.getObjectByName("island-roads");
    return roads !== undefined && !roads.visible;
  }), 30_000, "the roads to arrive hidden");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const uncompiled = await page.evaluate(() => {
    const { __globe: globe } = window as unknown as { __globe: Globe };
    const missing: string[] = [];
    globe.scene.getObjectByName("island-roads")!.traverse(object => {
      if (!(object.isMesh || object.isLine)) return;
      for (const material of [object.material ?? []].flat()) if (globe.gl.properties.get(material).currentProgram === undefined) missing.push(object.name);
    });
    return missing;
  });
  assert.deepEqual(uncompiled, []);
});
