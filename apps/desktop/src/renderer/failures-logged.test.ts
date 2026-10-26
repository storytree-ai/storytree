/**
 * Capability 2 · Storytree projects: the real renderer, on a stand-in bridge whose reads fail, writes each failure it catches to
 * the console, which lifecycle 1.19 carries to app.log, so a failure inside the window leaves a trace even where the page goes on
 * showing what it had.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Browser } from "playwright-core";

import { waitUntil } from "@storytree/test-waits";

import { buildCapture, captureSeed, fakeBridge, withCapture } from "../capture/index.js";
import type { StorytreeBridge } from "../bridge.js";

/** The renderer at `origin` on a stand-in bridge with `answers`, once its state reads `state`, and every console error it writes. */
async function opened(browser: Browser, origin: string, answers: Partial<StorytreeBridge>, state: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await fakeBridge(answers).install(page);
  await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction((wanted) => document.body.dataset.state === wanted, state, { timeout: 180_000 });
  /** Wait for a console error matching `pattern`: the page's reads answer in turn, so one may still be on its way. */
  const logged = (pattern: RegExp) => waitUntil(() => errors.some((text) => pattern.test(text)) || undefined, 15_000, `a console error matching ${pattern}; seen: ${errors.join(" | ")}`);
  return { page, logged };
}

test("2.20 · the renderer writes a failed surfaces read, a failed projects poll or forest read, a failed project choice and a failed start mark to the console", { timeout: 600_000 }, async (t) => {
  const dist = mkdtempSync(path.join(tmpdir(), "storytree-failures-logged-"));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  await buildCapture({ dist });
  const { seed } = captureSeed("forest");
  const projects = [...seed.projects, "elsewhere"];
  let pollFails = false;
  const seeded: Partial<StorytreeBridge> = {
    projectSelection: async () => {
      if (pollFails) throw new Error("the library stopped answering");
      return { projects, current: seed.projects[0] };
    },
    listProjects: async () => projects,
    projectTree: async () => seed.tree,
    changesSince: async (_, cursor) => cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => seed.covers[id] ?? [],
    readSurfaces: async () => ({ ok: false, error: "settings.json is not JSON" }),
    startMark: async () => { throw new Error("app.log is not writable"); },
    chooseProject: async () => { throw new Error("that project's library is not reachable"); },
  };
  // The runner images carry Chrome, not the Chromium Playwright downloads for itself.
  process.env.CAPTURE_CHANNEL ??= "chrome";

  await withCapture({ folder: dist, dist }, async ({ browser, origin }) => {
    const { page, logged } = await opened(browser, origin!, seeded, "ready");
    await logged(/desktop renderer: .*surfaces.*settings\.json is not JSON/s);
    await logged(/desktop renderer: .*start mark.*app\.log is not writable/s);

    // A failed poll once the forest is drawn leaves it on show, and is written all the same.
    pollFails = true;
    await logged(/desktop renderer: .*projects could not be read.*the library stopped answering/s);
    assert.equal(await page.evaluate(() => document.body.dataset.state), "ready");
    pollFails = false;

    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>("[data-app-switcher] select")!;
      select.value = "elsewhere";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await logged(/desktop renderer: .*project could not be selected.*not reachable/s);
    await page.close();

    // A forest whose first read fails says so over the page, and writes the failure; so is a surfaces read the bridge refuses.
    const unread = await opened(browser, origin!, {
      ...seeded,
      projectTree: async () => { throw new Error("the tree could not be read"); },
      readSurfaces: async () => { throw new Error("the main process did not answer"); },
    }, "error");
    await unread.logged(/desktop renderer: .*forest.*the tree could not be read/s);
    await unread.logged(/desktop renderer: .*surfaces.*the main process did not answer/s);
    await unread.page.close();
  });
});
