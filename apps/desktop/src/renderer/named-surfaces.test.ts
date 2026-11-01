/**
 * The frame's canvases, named (capability 3 · Surfaces, with Surface feedback): the real renderer, on a stand-in bridge,
 * opens each canvas, gear menu tab and dialog the app has, and the feedback corner, pointed at a control on it, names a
 * surface the stories declare (its own, or the one in front). A canvas with no declared id leaves the corner's surface unchosen, and fails here.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Browser, Page } from "playwright-core";

import { MENU_TABS } from "@storytree/app/surfaces/named";

import namedSurfaces from "../main/parts/named-surfaces.js";
import surfaces from "../main/parts/surfaces.js";
import { buildCapture, captureSeed, fakeBridge, visibleGlobeTargets, withCapture } from "../capture/index.js";
import type { StorytreeBridge } from "../bridge.js";
import { declaredSurfaces } from "../page-operations.js";

const declared = declaredSurfaces([surfaces, namedSurfaces]);
const ids = new Set(declared.map(({ id }) => id));

/** The renderer at `origin` on a stand-in bridge with `answers`, the corner offered over every declared surface. */
async function opened(browser: Browser, origin: string, answers: Partial<StorytreeBridge>, ready: (page: Page) => Promise<unknown>): Promise<Page> {
  const bridge = fakeBridge({
    feedbackSetup: async () => ({ offered: true, surfaces: declared }),
    captureForFeedback: async () => "picture",
    ...answers,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await ready(page);
  await page.locator("[data-corner-button]").waitFor();
  return page;
}

/**
 * The surface the corner names for the element at `pick` (a control the owner would point at on what is on show now);
 * every surface marked on the page is a declared one.
 */
async function named(page: Page, pick: string): Promise<string> {
  const marked = await page.evaluate("[...document.querySelectorAll('[data-surface-id]')].map(node => node.dataset.surfaceId)") as string[];
  assert.deepEqual(marked.filter((id) => !ids.has(id)), [], "every surface marked on the page is declared");
  await page.keyboard.press("Control+Shift+F");
  await page.waitForFunction(() => !document.querySelector<HTMLElement>("[data-corner-picker]")!.hidden);
  const box = (await page.locator(pick).first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => !document.querySelector<HTMLElement>("[data-corner-composer]")!.hidden);
  const surface = await page.inputValue("[data-corner-surface]");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector<HTMLElement>("[data-corner-composer]")!.hidden);
  return surface;
}

test("3.15 · every canvas, gear menu tab and dialog the app opens carries a declared surface id, and the corner names it", { timeout: 600_000 }, async (t) => {
  const dist = mkdtempSync(path.join(tmpdir(), "storytree-named-surfaces-"));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  await buildCapture({ dist, entryPoints: [new URL("./renderer.ts", import.meta.url)] });
  const { seed } = captureSeed("forest");
  let current = seed.projects[0];
  const seeded: Partial<StorytreeBridge> = {
    projectSelection: async () => ({ projects: seed.projects, current }),
    chooseProject: async (name) => ({ projects: seed.projects, current: current = name }),
    listProjects: async () => seed.projects,
    projectTree: async () => seed.tree,
    changesSince: async (_, cursor) => cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => seed.covers[id] ?? [],
  };
  const ready = (page: Page) => page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 180_000 });
  // The runner images carry Chrome, not the Chromium Playwright downloads for itself.
  process.env.CAPTURE_CHANNEL ??= "chrome";

  await withCapture({ folder: dist, dist }, async ({ browser, origin, settle }) => {
    const page = await opened(browser, origin!, seeded, ready);
    await settle(page);
    // The globe marks its canvas once it has measured a size to draw at, which a loaded Windows runner had not by the
    // page's ready (run 41206023912): the corner names what is marked, so it is asked once the globe is.
    await page.locator("[data-surface-id=globe]").waitFor();
    assert.equal(await named(page, ".app-gear"), "globe");

    // Open at its usual height, the sessions list is a strip under the globe; expanded, it is a canvas of its own.
    if (await page.locator("#sessions-body[hidden]").count() > 0) await page.click(".sessions-handle");
    await page.locator("#sessions-body:not([hidden])").waitFor();
    assert.equal(await named(page, ".app-gear"), "globe", "the open strip leaves the globe in front");
    await page.click(".sessions-size");
    assert.equal(await named(page, ".app-gear"), "sessions");
    await page.click(".sessions-size");

    await page.click(".arc-surface-mount [data-open-arcs]");
    await page.locator("#arc-drawer:not([hidden])").waitFor();
    assert.equal(await named(page, "#arc-drawer [data-close-arcs]"), "arcs");
    await page.click("#arc-drawer [data-close-arcs]");
    await page.locator("#arc-drawer").waitFor({ state: "hidden" });

    const { islands } = await visibleGlobeTargets(page, { x: 0.6, y: 0.6 });
    assert.ok(islands.length > 0, "the seed's forest shows an island to open");
    await page.mouse.click(islands[0]!.x, islands[0]!.y);
    await page.locator("aside.story-panel:not([hidden])").waitFor();
    assert.equal(await named(page, ".panel-close"), "story-panel");
    await page.click("[data-open-tree]");
    await page.locator(".tree-space:not([hidden])").waitFor();
    assert.equal(await named(page, ".tree-space-close"), "capability-tree");
    await page.click(".tree-space-close");
    await page.click(".panel-close");
    await page.locator("aside.story-panel").waitFor({ state: "hidden" });

    await page.click("[data-globe-switch=library]");
    await settle(page);
    const [dot] = (await visibleGlobeTargets(page, { x: 0.6, y: 0.6 })).dots;
    assert.ok(dot !== undefined, "the seed's library shows a note to open");
    await page.mouse.click(dot.x, dot.y);
    await page.waitForFunction(() => document.body.dataset.note !== undefined);
    assert.equal(await named(page, ".app-gear"), "library");

    await page.click(".app-gear");
    for (const tab of MENU_TABS.map((label) => label.toLowerCase())) {
      await page.click(`[data-app-section="${tab}"]`);
      assert.equal(await named(page, `#app-${tab}`), `menu:${tab}`, `the gear menu's ${tab} tab`);
    }
    await page.close();

    const consent = await opened(browser, origin!, { ...seeded, readJourney: async () => ({ consent: "pending", available: true, installId: "00000000-0000-4000-8000-000000000000", queued: 0 }) }, ready);
    await consent.locator(".journey-consent:not([hidden])").waitFor();
    assert.equal(await named(consent, ".journey-consent"), "journey-consent", "the first launch's consent, over the globe");
    await consent.close();

    const empty = await opened(browser, origin!, { projectSelection: async () => ({ projects: [], current: undefined }) }, (page) => page.waitForFunction(() => document.body.dataset.state === "empty"));
    assert.equal(await named(empty, ".empty"), "no-projects");
    await empty.close();

    const missing = await opened(browser, origin!, { projectSelection: async () => ({ projects: ["site"], current: "gone" }) }, (page) => page.waitForFunction(() => document.body.dataset.state === "missing"));
    assert.equal(await named(missing, "[data-surface-id=app-message]"), "app-message");
    await missing.close();
  });
});
