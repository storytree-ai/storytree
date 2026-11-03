/**
 * The page's frame under the app bar (capability 2 · Storytree projects, contract 2.8): the real renderer, on a stand-in bridge,
 * measured in a browser at a wide and a narrow window. The left rail and the forest beside it start directly below the 48 px app
 * bar, the rail runs to the window's bottom, and the forest takes the rest of the width, never under the rail.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { buildCapture, captureSeed, fakeBridge, withCapture } from "../capture/index.js";

type Box = { left: number; top: number; right: number; bottom: number };

test("2.8 · the left rail and the forest beside it start directly below the 48 px app bar, the rail to the window's bottom and the forest never under it", { timeout: 600_000 }, async (t) => {
  const dist = mkdtempSync(path.join(tmpdir(), "storytree-left-rail-"));
  t.after(() => removeTemp(dist));
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

  await withCapture({ folder: dist, dist }, async ({ browser, origin }) => {
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
});
