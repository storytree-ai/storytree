// Capability 2 · Storytree projects
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Browser } from "playwright-core";

import { waitUntil } from "@storytree/test-waits";

import { buildCapture, captureSeed, fakeBridge, withCapture } from "../capture/index.js";
import type { StorytreeBridge } from "../bridge.js";

async function opened(browser: Browser, origin: string, answers: Partial<StorytreeBridge>, state: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await fakeBridge(answers).install(page);
  await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction((wanted) => document.body.dataset.state === wanted, state, { timeout: 180_000 });
  const logged = (pattern: RegExp) => waitUntil(() => errors.some((text) => pattern.test(text)) || undefined, 15_000, `a console error matching ${pattern}; seen: ${errors.join(" | ")}`);
  return { page, logged };
}

test("2.20 · the renderer writes a failed surfaces read, a failed projects poll or forest read, a failed project choice and a failed start mark to the console", { timeout: 600_000 }, async (t) => {
  const dist = mkdtempSync(path.join(tmpdir(), "storytree-failures-logged-"));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  await buildCapture({ dist, entryPoints: [new URL("./renderer.ts", import.meta.url)] });
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
  process.env.CAPTURE_CHANNEL ??= "chrome";

  await withCapture({ folder: dist, dist }, async ({ browser, origin }) => {
    const { page, logged } = await opened(browser, origin!, seeded, "ready");
    await logged(/desktop renderer: .*surfaces.*settings\.json is not JSON/s);
    await logged(/desktop renderer: .*start mark.*app\.log is not writable/s);

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
