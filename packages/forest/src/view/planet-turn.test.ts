import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserServer, type Page } from "playwright-core";
import { endChrome } from "./end-chrome.js";
import { waitUntil } from "@storytree/test-waits";

/** Each bundle is built once for the file, and its tests each mount it on a fresh page. */
const bundles = new Map<string, Promise<string>>();

/** The real map view, bundled for the browser and mounted on a two-story plan: the capture seam counts its renders.
 * `__show(titles)` hands it the plan again, a live update, with the stories' titles as given. `linked` gives each story a
 * second capability its first depends on, and story one's first depends on story two's, so each island has roads.
 * `__show(titles, story, more)` shows it with that story selected, and the map view's other props `more` gives (an arc's rings, a pick), `__core` is its knowledge core, and `__flushSync` commits the map's scene at once. `__zoom()` reads the eye's zoom the map shows its detail by. */
function mapBundle(linked = false, { late = false }: { late?: boolean } = {}): Promise<string> {
  const key = JSON.stringify([linked, late]);
  if (!bundles.has(key)) bundles.set(key, bundleMap(linked, late));
  return bundles.get(key)!;
}
/** Counts, as `__pending`, the page's work still to come: the frames asked for and the turns handed to the next task (a
 * zero-delay timeout: the islands' builds in steps, their roads' routing, the notes' roots). The map draws on demand, so a
 * page with none pending has drawn all it was asked to, and will draw nothing more until something changes. */
const PENDING_WORK = `globalThis.__pending = 0; {
  const frames = new Set(), turns = new Set(), frame = requestAnimationFrame.bind(globalThis), unframe = cancelAnimationFrame.bind(globalThis);
  const later = setTimeout.bind(globalThis), unlater = clearTimeout.bind(globalThis), count = () => { globalThis.__pending = frames.size + turns.size; };
  globalThis.requestAnimationFrame = run => { const id = frame(at => { frames.delete(id); count(); run(at); }); frames.add(id); count(); return id; };
  globalThis.cancelAnimationFrame = id => { frames.delete(id); count(); unframe(id); };
  globalThis.setTimeout = (run, ms, ...rest) => {
    if (ms) return later(run, ms, ...rest);
    const id = later(() => { turns.delete(id); count(); run(...rest); }); turns.add(id); count(); return id;
  };
  globalThis.clearTimeout = id => { turns.delete(id); count(); unlater(id); };
}
`;
async function bundleMap(linked: boolean, late: boolean): Promise<string> {
  const entry = `import { createElement } from "react";
    import { createRoot } from "react-dom/client";
    import { flushSync } from "@react-three/fiber";
    import { workStates } from "@storytree/arc-surface";
    import { createKnowledgeCore } from "@storytree/knowledge-core/view";
    import { forestScene, storyNodes } from ${JSON.stringify(path.join(import.meta.dirname, "../index.ts"))};
    import { PlanetView } from ${JSON.stringify(path.join(import.meta.dirname, "planet-view.tsx"))};
    import { LayoutProgress } from ${JSON.stringify(path.join(import.meta.dirname, "layout-progress.tsx"))};
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
    const core = globalThis.__core = createKnowledgeCore("app"), root = createRoot(document.querySelector("#map"));
    // The map's top-left mark over the same islands, as the forest view mounts it (3.96, 3.98, 3.101).
    const mark = createRoot(document.body.appendChild(document.createElement("div")));
    globalThis.__show = (titles, selected, more = {}) => {
      const scene = forestScene(plan(titles), history, workStates([]));
      root.render(createElement(PlanetView, { core, scene, places, wisps: [], selected, onPick: () => {}, onNote: () => {}, ...more }));
      mark.render(createElement(LayoutProgress, { islands: scene.islands.map(island => ({ story: island.story, territories: island.land?.territories })) }));
    };
    globalThis.__flushSync = flushSync;
    globalThis.__zoom = () => sheetEyeZoom(globalThis.__globe.camera, globalThis.__globe.size);
    if (${JSON.stringify(late)}) {
      root.render(createElement(PlanetView, { core, scene: forestScene({ arcs: [], stories: [] }, [], workStates([])), places: new Map(), wisps: [],
        selected: undefined, onPick: () => {}, onNote: () => {} }));
      setTimeout(() => globalThis.__show(["one", "two"]), 1500);
    } else globalThis.__show(["one", "two"]);`;
  const result = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "js" }, bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".glb": "binary" },
    banner: { js: PENDING_WORK + "globalThis.__renders = 0; globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__renders++; globalThis.__nav = nav; };" },
  });
  return result.outputFiles[0]!.text;
}

/** One browser for the file, launched on first use: each test opens its own page in a context of its own, so none sees another's
 * state, and the file pays one launch rather than one a test. */
let server: Promise<BrowserServer> | undefined;
let launched: Promise<Browser> | undefined;
// Ended without waiting on Chrome's pipes, which a loaded Windows runner left open after the last test, so the file never exited
// (PR #695, then PR #720 when awaiting the server's kill hung the same way; 3.100).
after(async () => { endChrome(await server, await launched); });
async function freshPage(t: { after(run: () => Promise<void>): void }, viewport: { width: number; height: number }): Promise<Page> {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  server ??= chromium.launchServer({ channel: "chrome", headless: true });
  launched ??= server.then(running => chromium.connect(running.wsEndpoint()));
  const page = await (await launched).newPage({ viewport });
  t.after(() => page.context().close());
  return page;
}

/** A page with the map mounted, once it has opened and stopped rendering. */
async function openedMap(t: { after(run: () => Promise<void>): void }, linked = false, viewport = { width: 800, height: 600 }) {
  const page = await freshPage(t, viewport);
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  await page.addScriptTag({ content: await mapBundle(linked) });
  await page.waitForFunction(() => {
    const { __globe: globe, __nav: nav } = window as unknown as { __globe?: { scene: { getObjectByName(name: string): unknown } }; __nav?: unknown };
    return nav !== undefined && globe?.scene.getObjectByName("planet:two") !== undefined;
  }, undefined, { timeout: 60_000 });
  const renders = () => page.evaluate(() => (window as unknown as { __renders: number }).__renders);
  // The opening settles: the sheet opens framed and the islands report their places, then the view stops rendering, and
  // each island's land, built in its turn (3.87), stands built again with its roads and relief, its borders whole, and no
  // build or frame is still to come. Every island is routed, linked or not, and its first land, built before its roads
  // arrive, stands meanwhile: a slow computer can leave it unchanged across two reads (macOS, 2026-11-10).
  const built = () => page.evaluate(() => {
    type Part = { uuid: string; geometry?: { drawRange: { count: number } } };
    const { __globe: globe, __renders: renders, __pending: pending } = window as unknown as { __renders: number; __pending: number; __globe: { scene: { getObjectByName(name: string): { getObjectByName(name: string): Part | undefined } | undefined } } };
    const lands = ["one", "two"].map(story => globe.scene.getObjectByName(`planet:${story}`));
    const drawn = lands.map(island => island?.getObjectByName("territory-land")?.uuid);
    const routed = lands.every(island => island?.getObjectByName("island-roads") !== undefined);
    const whole = lands.every(island => (island?.getObjectByName("territory-borders")?.geometry?.drawRange.count ?? Infinity) === Infinity);
    return pending === 0 && drawn.every(uuid => uuid !== undefined) && routed && whole ? JSON.stringify([renders, drawn]) : undefined;
  });
  let last: string | undefined;
  await waitUntil(async () => { const now = await built(); const still = now !== undefined && now === last; last = now; return still; }, 30_000, "the map view to stop rendering after it opens, its islands' land built");
  // A land built last compiles its shaders on the frame after.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return { page, renders };
}

test("3.87 · an island on the map as it opens has its land stand when it is built, however late its turn comes, never traced on", async t => {
  const page = await freshPage(t, { width: 800, height: 600 });
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
    if (lines === undefined) { if (window.__globe?.gl.info.render.frame > 0) window.__drewBefore = true; requestAnimationFrame(look); return; }
    window.__first = { whole: lines.geometry.drawRange.count === Infinity, drewBefore: window.__drewBefore === true };
  })();` });
  await waitUntil(() => page.evaluate(() => (window as unknown as { __first?: unknown }).__first !== undefined), 60_000, "island one's land to be built");
  const borders = await page.evaluate(() => (window as unknown as { __first: { whole: boolean; drewBefore: boolean } }).__first);
  assert.ok(borders.drewBefore, "the map drew a frame before the land was built");
  assert.ok(borders.whole, "its borders stand whole on the first frame they are drawn");
});

test("3.87 · islands that arrive as the map opens, after it first drew, have their land stand, built again with their roads too, never traced on", async t => {
  const page = await freshPage(t, { width: 800, height: 600 });
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  // The map opens empty and its plan comes 1.5 s later, as the app's does; linked, so each island has roads, routed after
  // its land is first built, which build it again.
  await page.addScriptTag({ content: await mapBundle(true, { late: true }) });
  // Each frame, island one's borders are read the first time its land is drawn, and the first time its roads are.
  await page.addScriptTag({ content: `(function look() {
    const island = window.__globe?.scene.getObjectByName("planet:one");
    const lines = island?.getObjectByName("territory-borders");
    const whole = () => lines.geometry.drawRange.count === Infinity;
    if (lines === undefined && window.__globe?.gl.info.render.frame > 0) window.__drewBefore = true;
    if (lines !== undefined && window.__land === undefined) window.__land = { whole: whole(), roads: island.getObjectByName("island-roads") !== undefined, drewBefore: window.__drewBefore === true };
    if (lines !== undefined && island.getObjectByName("island-roads") !== undefined) { window.__roads = { whole: whole() }; return; }
    requestAnimationFrame(look);
  })();` });
  await waitUntil(() => page.evaluate(() => (window as unknown as { __roads?: unknown }).__roads !== undefined), 60_000, "island one's roads to be built");
  const seen = await page.evaluate(() => { const at = window as unknown as { __land: { whole: boolean; roads: boolean; drewBefore: boolean }; __roads: { whole: boolean } }; return { land: at.__land, roads: at.__roads }; });
  assert.ok(seen.land.drewBefore, "the map drew a frame before the land was built");
  assert.ok(!seen.land.roads, "its land was first drawn before its roads came");
  assert.ok(seen.land.whole, "its borders stand whole on the first frame its land is drawn");
  assert.ok(seen.roads.whole, "and on the first frame its roads are drawn");
});

test("3.101 · once its islands are on the map, it says it has settled only on a frame where each one's land is drawn with its roads", async t => {
  const page = await freshPage(t, { width: 800, height: 600 });
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  // Every turn the page hands on comes 300 ms late, so each island stands on the sheet many frames before it is laid out.
  await page.evaluate(() => {
    const later = window.setTimeout.bind(window);
    window.setTimeout = ((run: () => void, ms?: number) => later(run, ms ? ms : 300)) as typeof window.setTimeout;
  });
  // Linked, so each island is laid out by its docks and has roads.
  await page.addScriptTag({ content: await mapBundle(true) });
  // Each frame both islands stand on the sheet, until the mark first reads settled: whose land and roads are drawn then.
  await page.addScriptTag({ content: `(function look() {
    const islands = ["one", "two"].map(story => window.__globe?.scene.getObjectByName("planet:" + story));
    const shown = islands.every(island => island?.visible === true);
    if (!shown || document.querySelector('[data-layout="settled"]') === null) { requestAnimationFrame(look); return; }
    window.__settled = islands.map(island => ({ land: island.getObjectByName("territory-land") !== undefined, roads: island.getObjectByName("island-roads") !== undefined }));
  })();` });
  await waitUntil(() => page.evaluate(() => (window as unknown as { __settled?: unknown }).__settled !== undefined), 60_000, "the mark to say the map has settled");
  const drawn = await page.evaluate(() => (window as unknown as { __settled: unknown }).__settled);
  assert.deepEqual(drawn, [{ land: true, roads: true }, { land: true, roads: true }], "each island's land and roads drawn on the first frame the map says it has settled");
});

test("3.71 · a drag that turns the glass sheet renders the map view a fixed few times, however many steps it takes, and the sheet still turns", async t => {
  const { page, renders } = await openedMap(t);
  const turn = () => page.evaluate(() => (window as unknown as { __globe: { scene: { getObjectByName(name: string): { quaternion: { toArray(): number[] } } } } })
    .__globe.scene.getObjectByName("globe").quaternion.toArray());
  const before = await turn();
  await page.evaluate(() => { (window as unknown as { __renders: number }).__renders = 0; });

  // A Ctrl+drag spins and tilts the sheet; twenty steps, each drawn on the next frame.
  await page.keyboard.down("Control");
  await page.mouse.move(400, 300);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(400 + step * 12, 300 + step * 3);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  await page.keyboard.up("Control");
  // The drag's last step is drawn on the frame after it.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const rendered = await renders();
  assert.ok(rendered <= 3, `a 20-step drag rendered the map view ${rendered} times`);
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

test("3.73 · the notes' roots drawn anew after the map opened, as the core's shown kinds change, have their shader program before a frame draws them", async t => {
  const { page } = await openedMap(t);
  type Drawn = { uuid: string; material: object };
  type Globe = { gl: { properties: { get(material: object): { currentProgram?: unknown } } }; scene: { getObjectByName(name: string): Drawn | undefined } };
  type Page = { __show(titles: string[], selected: string): void; __core: { showKind(kind: string, shown: boolean): void } };
  const roots = () => page.evaluate(() => {
    const { __globe: globe } = window as unknown as { __globe: Globe };
    const drawn = globe.scene.getObjectByName("knowledge-roots");
    return drawn && { uuid: drawn.uuid, compiled: globe.gl.properties.get(drawn.material).currentProgram !== undefined };
  });
  // A selected story's roots, compiled with the map as the selection draws them.
  await page.evaluate(() => (window as unknown as Page).__show(["one", "two"], "one"));
  await waitUntil(async () => (await roots())?.compiled === true, 10_000, "the selected story's roots to be drawn and compiled");
  const before = (await roots())!;
  // A kind switched off changes the notes shown, and so the roots, while the map's sheet stays as it was; the change is
  // committed at once and the roots read in the same task, before a frame draws them (drawing compiles what it draws).
  const after = await page.evaluate(before => {
    const { __globe: globe, __core: core, __flushSync: flushSync } = window as unknown as { __globe: Globe; __flushSync(run: () => void): void } & Page;
    flushSync(() => core.showKind("principle", false));
    const drawn = globe.scene.getObjectByName("knowledge-roots")!;
    return drawn.uuid === before ? "the roots were not drawn anew" : globe.gl.properties.get(drawn.material).currentProgram !== undefined;
  }, before.uuid);
  assert.equal(after, true);
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

test("3.90 · a panel opened beside the map, narrowing it from the left, never lowers how far the wheel zooms out, though the view was zoomed in when it opened", async t => {
  const { page } = await openedMap(t, false, { width: 1000, height: 600 });
  const zoom = () => page.evaluate(() => (window as unknown as { __zoom(): number }).__zoom());
  // Wheeled `by` until a step moves the eye no further, or for `steps` steps when they are given. Each notch moves the eye
  // as it turns, so the zoom is read on the frame after it; every notch zooms by one factor, whatever its size.
  const wheel = async (by: number, at: number, steps?: number): Promise<number> => {
    await page.mouse.move(at, 300);
    let before = await zoom();
    for (let step = 0; step < (steps ?? 80); step++) {
      await page.mouse.wheel(0, by);
      const now = await page.evaluate(() => new Promise<number>(read => requestAnimationFrame(() => read((window as unknown as { __zoom(): number }).__zoom()))));
      if (steps === undefined && Math.abs(now - before) <= before * 0.001) return now;
      before = now;
    }
    return before;
  };
  const floor = await wheel(240, 500);
  const near = await wheel(-240, 500, 15);
  assert.ok(near > floor * 2, `the wheel drew the eye well in from its floor (${floor} to ${near})`);
  // The arcs panel opens on the left, as the rail does: the map's frame loses its left 300 CSS pixels, its short side kept.
  await page.evaluate(() => { document.querySelector<HTMLElement>("#map")!.style.left = "300px"; });
  await waitUntil(() => page.evaluate(() => (window as unknown as { __globe: { size: { width: number } } }).__globe.size.width === 700), 10_000, "the map's frame to narrow");
  const after = await wheel(240, 650);
  assert.ok(Math.abs(after - floor) <= floor * 0.01, `the wheel zooms out as far with the panel open (${after}) as before it (${floor})`);
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

test("3.102 · the first pick after an arc is selected draws its gold ring alone, its shader built before it draws, and builds the island's land no more", async t => {
  const { page } = await openedMap(t, true);
  type Drawn = { uuid: string; name: string; material?: object; traverse(visit: (object: Drawn) => void): void };
  type Globe = { gl: { compile(object: Drawn, ...rest: unknown[]): unknown; properties: { get(material: object): { currentProgram?: unknown } } }; scene: Drawn };
  type Page = { __globe: Globe; __pending: number; __compiled: string[][]; __flushSync(run: () => void): void; __show(titles: string[], selected: string, more: object): void };
  const arc = { circled: ["one-cap", "one-b-cap"] };
  const rings = () => page.evaluate(() => {
    const { __globe: globe, __pending: pending } = window as unknown as Page, found: Record<string, { uuid: string; compiled: boolean }> = {};
    globe.scene.traverse(object => { if (/^(open-work|picked)-ring:/.test(object.name)) found[object.name] = { uuid: object.uuid, compiled: globe.gl.properties.get(object.material!).currentProgram !== undefined }; });
    return pending === 0 ? found : undefined;
  });
  await page.evaluate(arc => (window as unknown as Page).__show(["one", "two"], "one", arc), arc);
  await waitUntil(async () => Object.values(await rings() ?? {}).filter(({ compiled }) => compiled).length === 2, 10_000, "the arc's two rings drawn and compiled");
  const before = (await rings())!;
  // What is compiled from here on, by the names it holds; the pick committed at once and its rings read before a frame draws.
  await page.evaluate(arc => {
    const page = window as unknown as Page, gl = page.__globe.gl, compile = gl.compile.bind(gl), compiled: string[][] = page.__compiled = [];
    gl.compile = (object, ...rest) => { const names: string[] = []; object.traverse(({ name }) => { if (name !== "") names.push(name); }); compiled.push(names); return compile(object, ...rest); };
    page.__flushSync(() => page.__show(["one", "two"], "one", { ...arc, selectedCapability: "one-b-cap" }));
  }, arc);
  await waitUntil(async () => (await rings())?.["picked-ring:one-b-cap"]?.compiled === true, 10_000, "the pick's gold ring drawn and compiled");
  const after = (await rings())!;
  for (const name of Object.keys(before)) assert.equal(after[name]?.uuid, before[name]!.uuid, `${name} stands, not drawn anew`);
  const compiled = await page.evaluate(() => (window as unknown as Page).__compiled);
  assert.ok(compiled.some(names => names.includes("picked-ring:one-b-cap")), "the gold ring's shader built as it is drawn");
  assert.deepEqual(compiled.filter(names => names.includes("territory-land") && !names.includes("knowledge-roots")), [], "the island's land not compiled again");
});

/** The sheet's turn as drawn: its group's quaternion and position. */
const sheetTurn = (page: Page) => page.evaluate(() => {
  const globe = (window as unknown as { __globe: { scene: { getObjectByName(name: string): { quaternion: { toArray(): number[] }; position: { toArray(): number[] } } } } }).__globe.scene.getObjectByName("globe");
  return [...globe.quaternion.toArray(), ...globe.position.toArray()];
});

test("3.104 · a click on a story's name on the map selects that story, and a drag that starts on the name pans", async t => {
  const { page } = await openedMap(t);
  // As script text: a function written here would be named by the bundler's helper, which the page lacks.
  await page.evaluate(`globalThis.__picks = []; globalThis.__show(["one", "two"], undefined, { onPick: (...pick) => globalThis.__picks.push(pick) });`);
  const picks = () => page.evaluate(() => (window as unknown as { __picks: unknown[][] }).__picks);
  const name = await page.locator('.planet-nameplate[data-story-id="two"]').boundingBox();
  assert.ok(name !== null, "story two's name is drawn");
  const middle = { x: name.x + name.width / 2, y: name.y + name.height / 2 };
  await page.mouse.click(middle.x, middle.y);
  assert.deepEqual((await picks()).at(-1)?.[0], "two", "the click on the name picked its story");

  const before = await sheetTurn(page), picked = (await picks()).length;
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step++) await page.mouse.move(middle.x + step * 12, middle.y + step * 6);
  await page.mouse.up();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.notDeepEqual(await sheetTurn(page), before, "the drag from the name panned the sheet");
  assert.equal((await picks()).length, picked, "the drag picked nothing");
});

test("3.106 · the Whole map button shows once the view is moved, returns it to its opening, and goes", async t => {
  const { page } = await openedMap(t);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The map's own styles, as the app loads them: they let the button take the pointer the overlay's layer does not.
  await page.addStyleTag({ path: path.join(import.meta.dirname, "styles.css") });
  const button = page.locator("button.whole-map");
  assert.equal(await button.count(), 0, "no button at the opening");
  const opening = await sheetTurn(page);
  await page.mouse.move(400, 300);
  await page.mouse.down();
  for (let step = 1; step <= 5; step++) await page.mouse.move(400 + step * 20, 300 + step * 10);
  await page.mouse.up();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.notDeepEqual(await sheetTurn(page), opening, "the drag moved the sheet");
  await button.waitFor({ state: "visible", timeout: 5_000 });
  await button.click();
  const near = (a: number[], b: number[]) => a.every((value, i) => Math.abs(value - b[i]!) < 1e-3);
  let now: number[] = [];
  await waitUntil(async () => near(now = await sheetTurn(page), opening), 10_000, "the sheet back at its opening");
  assert.ok(near(now, opening));
  await button.waitFor({ state: "detached", timeout: 5_000 });
});
