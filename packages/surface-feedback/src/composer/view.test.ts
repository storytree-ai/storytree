import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser, Page } from "playwright-core";

import { bundled, launchChrome } from "../testing/page.js";

const SURFACES = [
  { id: "globe", name: "Forest globe", story: "forest" },
  { id: "menu:projects", name: "App menu: Projects", story: "app" },
];

/** A page like the app's: a main view, and a gear menu popover with a tab, both named. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body data-project="site" data-selected="story_000000000001">
  <main data-surface-id="globe" style="height: 90vh">globe</main>
  <div id="menu" popover="auto" style="inset: 0; width: 100vw; height: 100vh; margin: 0"><section data-surface-id="menu:projects">projects</section></div>
</body></html>`;

/**
 * The corner mounted on PAGE over a stand-in bridge kept in the page: each call is recorded in `window.calls`, a capture
 * notes whether the composer was on show when it was taken, and each send waits for the test to settle it.
 */
async function mounted(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: "light", permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  // Served from localhost, a secure context, as the app's own file is: the clipboard is there.
  await page.route("http://localhost/corner", (route) => route.fulfill({ contentType: "text/html", body: PAGE }));
  await page.goto("http://localhost/corner");
  await page.addScriptTag({ content: await bundled({ entryPoints: [new URL("./view.ts", import.meta.url)] }, "corner") });
  await page.evaluate(`(() => {
    window.calls = [];
    window.sends = [];
    const bridge = {
      feedbackSetup: async () => ({ offered: true, surfaces: ${JSON.stringify(SURFACES)} }),
      captureForFeedback: async () => {
        const composer = document.querySelector("[data-corner-composer]");
        calls.push({ capture: composer === null || composer.hidden ? "composer not on show" : "composer on show" });
        return "picture-1";
      },
      sendFeedback: (note, screenshot) => new Promise((resolve, reject) => { calls.push({ note, screenshot }); sends.push({ resolve, reject }); }),
    };
    window.mountedCorner = corner.mountFeedbackCorner(document, bridge, { shown: () => ({ project: document.body.dataset.project, selection: document.body.dataset.selected }) });
  })()`);
  await page.locator("[data-corner-button]").waitFor();
  return page;
}

const composerOnShow = (page: Page) => page.evaluate("!document.querySelector('[data-corner-composer]').hidden");
const status = (page: Page) => page.locator("[data-corner-status]").textContent();

test("1.1 · the corner button, or Ctrl+Shift+F, opens the composer above whatever is open, on the surface in front, and the surface can be corrected from the declared list", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await mounted(browser);

  assert.equal(await page.evaluate("document.adoptedStyleSheets.length"), 1, "the corner brings its own styles");
  const box = (await page.locator("[data-corner-button]").boundingBox())!;
  assert.deepEqual([Math.round(box.width), Math.round(box.height)], [22, 22], "a 22px button");
  assert.ok(box.x + box.width > 1200 - 24 && box.y + box.height > 800 - 24, `in the bottom-right corner, at ${box.x}, ${box.y}`);

  await page.click("[data-corner-button]");
  assert.equal(await composerOnShow(page), true);
  assert.equal(await page.inputValue("[data-corner-surface]"), "globe", "the composer opens on the surface in front");
  assert.deepEqual(await page.evaluate("calls"), [{ capture: "composer not on show" }], "the picture is taken before the composer is on show");
  assert.equal(await page.evaluate("document.activeElement?.matches('[data-corner-text]')"), true, "the text is ready to type");
  await page.keyboard.press("Escape");
  assert.equal(await composerOnShow(page), false, "Escape closes it");

  await page.evaluate("document.getElementById('menu').showPopover()");
  await page.locator("#menu [data-corner-button]").waitFor();
  await page.click("[data-corner-button]");
  assert.equal(await page.evaluate("document.getElementById('menu').matches(':popover-open')"), true, "pressing the corner leaves the gear menu open");
  assert.equal(await page.inputValue("[data-corner-surface]"), "menu:projects", "the menu's tab is the surface in front");
  const over = await page.evaluate("(() => { const b = document.querySelector('[data-corner-text]').getBoundingClientRect(); return document.elementFromPoint(b.x + 5, b.y + 5)?.matches('[data-corner-text]'); })()");
  assert.equal(over, true, "the composer is drawn above the open menu");
  await page.keyboard.press("Escape");
  assert.equal(await composerOnShow(page), false);
  assert.equal(await page.evaluate("document.getElementById('menu').matches(':popover-open')"), true, "Escape closes the composer, not the menu under it");

  await page.evaluate("document.getElementById('menu').hidePopover()");
  await page.keyboard.press("Control+Shift+F");
  await page.waitForFunction("!document.querySelector('[data-corner-composer]').hidden");
  assert.equal(await page.inputValue("[data-corner-surface]"), "globe", "Ctrl+Shift+F opens it too, with the corner back on the page");
  assert.deepEqual(await page.locator("[data-corner-surface] option").allTextContents(), ["Choose the surface…", "Forest globe", "App menu: Projects"], "every declared surface can be chosen");
  await page.selectOption("[data-corner-surface]", "menu:projects");
  assert.equal(await page.inputValue("[data-corner-surface]"), "menu:projects", "a wrong guess is corrected");
});

test("1.2 · Send needs text and a surface, and says Sent only after the write returns", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await mounted(browser);
  await page.evaluate("for (const named of document.querySelectorAll('[data-surface-id]')) named.removeAttribute('data-surface-id')");
  await page.click("[data-corner-button]");
  const send = page.locator("[data-corner-send]");
  assert.equal(await page.inputValue("[data-corner-surface]"), "", "with nothing named on show, no surface is guessed");
  assert.equal(await send.isDisabled(), true, "nothing to send yet");
  await page.fill("[data-corner-text]", "   ");
  assert.equal(await send.isDisabled(), true, "blank text is no note");
  await page.fill("[data-corner-text]", "The drawer hides the island");
  assert.equal(await send.isDisabled(), true, "a note needs a surface");
  await page.selectOption("[data-corner-surface]", "globe");
  assert.equal(await send.isDisabled(), false);

  await send.click();
  await page.waitForFunction("sends.length === 1");
  assert.notEqual(await status(page), "Sent", "not Sent while the write is still out");
  assert.deepEqual((await page.evaluate("calls") as { note: { text: string }; screenshot?: string }[])[1], {
    note: { text: "The drawer hides the island", surface: "globe", project: "site", selection: "story_000000000001", window: { width: 1200, height: 800 }, theme: "light" },
    screenshot: "picture-1",
  });
  await page.evaluate("sends[0].resolve({ id: 'feedback_000000000001' })");
  await page.waitForFunction("document.querySelector('[data-corner-status]').textContent === 'Sent'");
  assert.equal(await page.inputValue("[data-corner-text]"), "", "a sent note is cleared");

  await page.keyboard.press("Escape");
  await page.click("[data-corner-button]");
  await page.fill("[data-corner-text]", "Without the picture");
  await page.selectOption("[data-corner-surface]", "globe");
  await page.uncheck("[data-corner-picture]");
  await send.click();
  await page.waitForFunction("sends.length === 2");
  assert.equal((await page.evaluate("calls") as { note: { text: string }; screenshot?: string }[]).at(-1)?.screenshot, undefined, "a dropped picture is not sent");
});

test("1.3 · a failed write keeps the text and offers Retry and Copy", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await mounted(browser);
  await page.click("[data-corner-button]");
  await page.fill("[data-corner-text]", "Keep me if it fails");
  await page.click("[data-corner-send]");
  await page.waitForFunction("sends.length === 1");
  await page.evaluate("sends[0].reject(new Error('the library is not open'))");
  await page.locator("[data-corner-retry]").waitFor();
  assert.match((await status(page))!, /Not sent: the library is not open/);
  assert.equal(await page.inputValue("[data-corner-text]"), "Keep me if it fails", "the text is kept");
  assert.equal(await page.locator("[data-corner-copy]").isVisible(), true);

  await page.click("[data-corner-copy]");
  assert.equal(await page.evaluate("navigator.clipboard.readText()"), "Keep me if it fails", "Copy puts the text on the clipboard");
  await page.click("[data-corner-retry]");
  await page.waitForFunction("sends.length === 2");
  assert.equal((await page.evaluate("calls") as { note: { text: string }; screenshot?: string }[]).at(-1)?.note.text, "Keep me if it fails", "Retry sends the same note again");
  await page.evaluate("sends[1].resolve({ id: 'feedback_000000000002' })");
  await page.waitForFunction("document.querySelector('[data-corner-status]').textContent === 'Sent'");
  assert.equal(await page.locator("[data-corner-retry]").isVisible(), false);
});
