/**
 * The page's frame under the app bar (capability 2 · Storytree projects, contract 2.8): the real renderer, on a stand-in bridge,
 * measured in a browser at a wide and a narrow window. The left rail and the forest beside it start directly below the 48 px app
 * bar, the rail runs to the window's bottom, and the forest takes the rest of the width, never under the rail; resized, collapsed and
 * shown again (2.46), the forest and its drawing follow it. `RAIL_PICTURES=<folder>` keeps a picture of each of those states.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { buildCapture, captureSeed, fakeBridge, withCapture, type CaptureContext, type FakeBridge } from "../capture/index.js";

type Box = { left: number; top: number; right: number; bottom: number };

type Served = { browser: CaptureContext["browser"]; origin: string; bridge: FakeBridge };
/** The renderer built once for the file, on a stand-in bridge serving the forest capture's seed, with one browser and server
 * kept open for its tests to open pages on until they end: the file pays one build and one launch, not one a test. */
let served: Promise<Served> | undefined;
let closed: Promise<void> | undefined;
let finish: () => void = () => {};
const finished = new Promise<void>((resolve) => { finish = resolve; });
after(async () => { finish(); await closed; });
function onRenderer(): Promise<Served> {
  return served ??= (async () => {
    const dist = mkdtempSync(path.join(tmpdir(), "storytree-left-rail-"));
    await buildCapture({ dist, entryPoints: [new URL("./renderer.ts", import.meta.url)] });
    const { seed } = captureSeed("forest");
    const bridge = fakeBridge({
      projectSelection: async () => ({ projects: seed.projects, current: seed.projects[0] }),
      listProjects: async () => seed.projects,
      projectTree: async () => seed.tree,
      changesSince: async (_, cursor) => cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
      frontCovers: async (_, id) => seed.covers[id] ?? [],
    });
    // The runner images carry Chrome, not the Chromium Playwright downloads for itself.
    process.env.CAPTURE_CHANNEL ??= "chrome";
    return await new Promise<Served>((resolve, reject) => {
      closed = withCapture({ folder: dist, dist }, async ({ browser, origin }) => { resolve({ browser, origin: origin!, bridge }); await finished; })
        .finally(() => removeTemp(dist));
      closed.catch(reject);
    });
  })();
}

test("2.8 · the left rail and the forest beside it start directly below the 48 px app bar, the rail to the window's bottom and the forest never under it", { timeout: 600_000 }, async () => {
  const { browser, origin, bridge } = await onRenderer();
  for (const viewport of [{ width: 1440, height: 960 }, { width: 900, height: 700 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: "dark" });
    await bridge.install(page);
    await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 180_000 });
    await page.locator(".side-rail").waitFor();
    const boxes = await page.evaluate(() => Object.fromEntries([".app-bar", ".side-rail", "main > .forest"].map((selector) => {
      const { left, top, right, bottom } = document.querySelector(selector)!.getBoundingClientRect();
      return [selector, { left, top, right, bottom }];
    }))) as Record<string, Box>;
    const bar = boxes[".app-bar"]!, rail = boxes[".side-rail"]!, forest = boxes["main > .forest"]!;
    const at = `at ${viewport.width}×${viewport.height}`;
    assert.equal(bar.bottom, 48, `the app bar is 48 px ${at}`);
    assert.deepEqual([rail.left, rail.top, rail.bottom], [0, 48, viewport.height], `the rail runs down the left from below the bar to the bottom ${at}`);
    assert.ok(rail.right > 0 && rail.right < viewport.width / 2, `the rail is a column, not the page ${at}`);
    assert.deepEqual([forest.left, forest.top, forest.right], [rail.right, 48, viewport.width], `the forest fills the rest beside the rail ${at}`);
    await page.close();
  }
});

test("2.46 · while the left rail is resized, collapsed or shown again, the map fills exactly the space beside it, with no gap and no overlap", { timeout: 600_000 }, async () => {
  const pictures = process.env.RAIL_PICTURES;
  if (pictures) mkdirSync(pictures, { recursive: true });
  const { browser, origin, bridge } = await onRenderer();
  const viewport = { width: 1440, height: 960 };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: "dark" });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 180_000 });
  await page.locator(".side-rail").waitFor();
  /** The rail's right edge (0 when it is collapsed), and the forest's and its drawing's boxes, once the drawing has followed. */
  const beside = async (state: string) => {
    await page.waitForFunction(() => {
      // The drawing's own pixels (one per CSS pixel here) follow the forest's width: the map redrew, not only stretched.
      const forest = document.querySelector<HTMLElement>("main > .forest")!;
      const canvas = forest.querySelector("canvas");
      return canvas !== null && canvas.width === forest.clientWidth && canvas.getBoundingClientRect().left === forest.getBoundingClientRect().left;
    }, undefined, { timeout: 30_000 });
    if (pictures) await page.screenshot({ path: path.join(pictures, `rail-${state}.png`) });
    // No function is named inside: the test's loader would name it with a helper the page does not have.
    return page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>(".side-rail")!;
      const [forest, canvas] = ["main > .forest", "main > .forest canvas"].map((selector) => document.querySelector(selector)!.getBoundingClientRect());
      return { rail: rail.hidden ? 0 : rail.getBoundingClientRect().right, forest: { left: forest!.left, right: forest!.right }, canvas: { left: canvas!.left, right: canvas!.right } };
    });
  };
  const fills = (at: Awaited<ReturnType<typeof beside>>, state: string) => {
    assert.equal(at.forest.left, at.rail, `the forest starts at the rail's edge, ${state}`);
    assert.equal(at.forest.right, viewport.width, `and runs to the window's right, ${state}`);
    assert.deepEqual([at.canvas.left, at.canvas.right], [at.forest.left, at.forest.right], `its drawing fills it, ${state}`);
  };
  const first = await beside("default");
  fills(first, "at the default width");
  const handle = page.locator(".side-rail-handle");
  const drag = async (to: number) => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, 300);
    await page.mouse.down();
    await page.mouse.move(to, 300, { steps: 6 });
    await page.mouse.up();
  };
  await drag(260);
  const narrowed = await beside("narrowed");
  assert.ok(narrowed.rail < first.rail, "the rail is narrower");
  fills(narrowed, "narrowed");
  await drag(20);
  const collapsed = await beside("collapsed");
  assert.equal(collapsed.rail, 0, "the rail is gone");
  fills(collapsed, "collapsed");
  assert.ok(await page.locator(".app-bar .side-rail-toggle[aria-expanded=false]").isVisible(), "its toggle is still in the bar");
  await page.click(".app-bar .side-rail-toggle");
  const restored = await beside("restored");
  assert.equal(restored.rail, narrowed.rail, "shown again at the width it was dragged to before it was pushed away");
  fills(restored, "shown again");
  await page.close();
});
