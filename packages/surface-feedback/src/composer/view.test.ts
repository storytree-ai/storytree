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
  <main data-surface-id="globe" style="height: 90vh"><button id="press" onclick="window.pressed = (window.pressed ?? 0) + 1">Press</button><canvas id="drawn" width="300" height="200" style="display: block"></canvas></main>
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
      captureForFeedback: async (box) => {
        const composer = document.querySelector("[data-corner-composer]");
        const picker = document.querySelector("[data-corner-picker]");
        const shown = (composer === null || composer.hidden) && (picker === null || picker.hidden) ? "corner not on show" : "corner on show";
        calls.push(box === undefined ? { capture: shown } : { crop: box, shown });
        // A test holding the crop sets holdCrop, then lets it go with releaseCrop().
        if (box !== undefined && window.holdCrop) return new Promise((resolve) => { window.releaseCrop = () => resolve("crop-1"); });
        return box === undefined ? "picture-1" : "crop-1";
      },
      sendFeedback: (note, screenshot, crop) => new Promise((resolve, reject) => { calls.push({ note, screenshot, crop }); sends.push({ resolve, reject }); }),
    };
    window.mountedCorner = corner.mountFeedbackCorner(document, bridge, { shown: () => ({ project: document.body.dataset.project, selection: document.body.dataset.selected }) });
  })()`);
  await page.locator("[data-corner-button]").waitFor();
  return page;
}

const composerOnShow = (page: Page) => page.evaluate("!document.querySelector('[data-corner-composer]').hidden");
const pickerOnShow = (page: Page) => page.evaluate("!document.querySelector('[data-corner-picker]').hidden");
/** Click at the middle of `selector`'s box: what the owner does to pick it. */
async function pickAt(page: Page, selector: string): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction("!document.querySelector('[data-corner-composer]').hidden");
}
const status = (page: Page) => page.locator("[data-corner-status]").textContent();

test("1.1 · the corner button, or Ctrl+Shift+F, starts a pick above whatever is open, and the composer opens on the picked element's surface, which can be corrected from the declared list", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await mounted(browser);

  assert.equal(await page.evaluate("document.adoptedStyleSheets.length"), 1, "the corner brings its own styles");
  const box = (await page.locator("[data-corner-button]").boundingBox())!;
  assert.deepEqual([Math.round(box.width), Math.round(box.height)], [22, 22], "a 22px button");
  assert.ok(box.x + box.width > 1200 - 24 && box.y + box.height > 800 - 24, `in the bottom-right corner, at ${box.x}, ${box.y}`);

  await page.click("[data-corner-button]");
  assert.equal(await pickerOnShow(page), true, "every note starts with a pick");
  assert.equal(await composerOnShow(page), false);
  assert.deepEqual(await page.evaluate("calls"), [{ capture: "corner not on show" }], "the picture is taken before anything of the corner's is on show");
  await pickAt(page, "#press");
  assert.equal(await pickerOnShow(page), false);
  assert.equal(await page.inputValue("[data-corner-surface]"), "globe", "the composer opens on the picked element's surface");
  assert.equal(await page.locator("[data-corner-anchor]").textContent(), "button “Press”", "the element picked is named");
  assert.equal(await page.evaluate("document.activeElement?.matches('[data-corner-text]')"), true, "the text is ready to type");
  await page.keyboard.press("Escape");
  assert.equal(await composerOnShow(page), false, "Escape closes it");

  await page.evaluate("document.getElementById('menu').showPopover()");
  await page.locator("#menu [data-corner-button]").waitFor();
  await page.click("[data-corner-button]");
  await pickAt(page, "#menu section");
  assert.equal(await page.evaluate("document.getElementById('menu').matches(':popover-open')"), true, "pressing the corner and picking leave the gear menu open");
  assert.equal(await page.inputValue("[data-corner-surface]"), "menu:projects", "the menu's tab is the picked element's surface");
  const over = await page.evaluate("(() => { const b = document.querySelector('[data-corner-text]').getBoundingClientRect(); return document.elementFromPoint(b.x + 5, b.y + 5)?.matches('[data-corner-text]'); })()");
  assert.equal(over, true, "the composer is drawn above the open menu");
  await page.keyboard.press("Escape");
  assert.equal(await composerOnShow(page), false);
  assert.equal(await page.evaluate("document.getElementById('menu').matches(':popover-open')"), true, "Escape closes the composer, not the menu under it");

  await page.evaluate("document.getElementById('menu').hidePopover()");
  await page.keyboard.press("Control+Shift+F");
  await page.waitForFunction("!document.querySelector('[data-corner-picker]').hidden");
  await pickAt(page, "#press");
  assert.equal(await page.inputValue("[data-corner-surface]"), "globe", "Ctrl+Shift+F starts it too, with the corner back on the page");
  assert.deepEqual(await page.locator("[data-corner-surface] option").allTextContents(), ["Choose the surface…", "Forest globe", "App menu: Projects"], "every declared surface can be chosen");
  await page.selectOption("[data-corner-surface]", "menu:projects");
  assert.equal(await page.inputValue("[data-corner-surface]"), "menu:projects", "a wrong guess is corrected");
});

test("1.2 · Send needs text, a picked element and a surface, and says Sent only after the write returns, with the element and its picture", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await mounted(browser);
  await page.evaluate("for (const named of document.querySelectorAll('[data-surface-id]')) named.removeAttribute('data-surface-id')");
  await page.click("[data-corner-button]");
  await pickAt(page, "#press");
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
  const calls = await page.evaluate("calls") as { crop?: { x: number }; shown?: string; note?: { anchor: { selector: string; box: unknown } }; screenshot?: string }[];
  const box = await page.evaluate("(() => { const b = document.getElementById('press').getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; })()");
  assert.deepEqual(calls[1], { crop: box, shown: "corner not on show" }, "the element's own picture is taken once it is picked, with the corner off the screen");
  const { anchor, ...rest } = calls[2]!.note!;
  assert.equal(anchor.selector, "#press", "the note carries the element picked");
  assert.deepEqual({ ...calls[2], note: rest }, {
    note: { text: "The drawer hides the island", surface: "globe", project: "site", selection: "story_000000000001", window: { width: 1200, height: 800 }, theme: "light" },
    screenshot: "picture-1",
    crop: "crop-1",
  });
  await page.evaluate("sends[0].resolve({ id: 'feedback_000000000001' })");
  await page.waitForFunction("document.querySelector('[data-corner-status]').textContent === 'Sent'");
  assert.equal(await page.inputValue("[data-corner-text]"), "", "a sent note is cleared");

  await page.keyboard.press("Escape");
  await page.click("[data-corner-button]");
  await pickAt(page, "#press");
  await page.fill("[data-corner-text]", "Without the picture");
  await page.selectOption("[data-corner-surface]", "globe");
  await page.uncheck("[data-corner-picture]");
  await send.click();
  await page.waitForFunction("sends.length === 2");
  const last = (await page.evaluate("calls") as { screenshot?: string; crop?: string }[]).at(-1);
  assert.deepEqual([last?.screenshot, last?.crop], [undefined, undefined], "dropped pictures are not sent");
});

test("1.3 · a failed write keeps the text and offers Retry and Copy", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await mounted(browser);
  await page.click("[data-corner-button]");
  await pickAt(page, "#press");
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

test("1.4 · while picking, the element under the pointer is outlined with its tag and size, a click attaches it without pressing it, Escape before the first pick leaves nothing open and Escape from Pick again returns to the note, and neither the corner nor a drawn canvas is picked", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await mounted(browser);
  await page.click("[data-corner-button]");
  const outline = page.locator("[data-corner-outline]");

  const press = (await page.locator("#press").boundingBox())!;
  await page.mouse.move(press.x + 4, press.y + 4);
  assert.equal(await outline.isVisible(), true);
  const drawn = (await outline.boundingBox())!;
  assert.ok(Math.abs(drawn.x - press.x) < 1 && Math.abs(drawn.width - press.width) < 1, "the outline is drawn round the element");
  assert.equal(await page.locator("[data-corner-label]").textContent(), `button · ${Math.round(press.width)}×${Math.round(press.height)}`);
  const canvas = (await page.locator("#drawn").boundingBox())!;
  await page.mouse.move(canvas.x + 20, canvas.y + 20);
  assert.equal(await outline.isVisible(), false, "a drawn canvas is not picked");
  await page.mouse.click(canvas.x + 20, canvas.y + 20);
  assert.equal(await pickerOnShow(page), true, "a click on it attaches nothing");
  const corner = (await page.locator("[data-corner-button]").boundingBox())!;
  await page.mouse.move(corner.x + 5, corner.y + 5);
  assert.notEqual(await page.locator("[data-corner-label]").textContent().then((label) => label?.startsWith("button")), true, "the corner's own button is looked through");

  await page.keyboard.press("Escape");
  assert.deepEqual([await pickerOnShow(page), await composerOnShow(page)], [false, false], "Escape before any pick leaves nothing open");

  await page.click("[data-corner-button]");
  await pickAt(page, "#press");
  assert.equal(await page.evaluate("window.pressed ?? 0"), 0, "the click picks the button and does not press it");
  await page.fill("[data-corner-text]", "Too bright");
  await page.click("[data-corner-repick]");
  assert.equal(await pickerOnShow(page), true, "Pick again goes back to the highlighter");
  await page.keyboard.press("Escape");
  assert.equal(await composerOnShow(page), true, "Escape cancels the pick, not the note");
  assert.equal(await page.inputValue("[data-corner-text]"), "Too bright");
  await page.click("[data-corner-repick]");
  await pickAt(page, "main");
  assert.equal(await page.locator("[data-corner-anchor]").textContent(), "main", "the new pick replaces the old");

  // While the element's picture is being taken, a second press of the button or Ctrl+Shift+F starts nothing.
  await page.keyboard.press("Escape");
  await page.evaluate("window.holdCrop = true");
  await page.click("[data-corner-button]");
  const held = (await page.locator("#press").boundingBox())!;
  await page.mouse.click(held.x + 4, held.y + 4);
  await page.waitForFunction("typeof window.releaseCrop === 'function'");
  await page.click("[data-corner-button]");
  await page.keyboard.press("Control+Shift+F");
  assert.deepEqual([await pickerOnShow(page), await composerOnShow(page)], [false, false], "no second pick starts");
  await page.evaluate("window.releaseCrop()");
  await page.waitForFunction("!document.querySelector('[data-corner-composer]').hidden");
  assert.equal(await pickerOnShow(page), false);
  assert.equal(await page.locator("[data-corner-anchor]").textContent(), "button “Press”", "the pick in flight is the note's");
});
