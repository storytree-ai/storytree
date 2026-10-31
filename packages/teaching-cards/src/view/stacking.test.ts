import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

/** The real card code, bundled for the browser: `window.teach()` shows the story's card. */
async function teachingBundle(): Promise<string> {
  const entry = `import { mountTeaching } from ${JSON.stringify(path.join(import.meta.dirname, "index.ts"))};
    import { journal } from ${JSON.stringify(path.join(import.meta.dirname, "../journal.ts"))};
    const kept = new Map();
    window.teach = () => mountTeaching(document.querySelector("#content"), { journal: journal({ getItem: key => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) }), locate: () => ({ x: 100, y: 20, visible: true }) })
      .take({ tree: { stories: [{ id: "story_a", capabilities: [] }], arcs: [] }, changes: [], lines: [] });`;
  const result = await build({ stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "js" }, bundle: true, write: false, format: "iife" });
  return result.outputFiles[0]!.text;
}

test("3.4 · an open popover or modal dialog draws over the card on show: the card hides while it is open and comes back when it closes", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  // A menu like the gear's: a popover below a bar the card may overlap, and a modal dialog.
  await page.setContent(`<header style="position:fixed;inset:0 0 auto;height:48px;z-index:7;background:#101418"></header>
    <div id="menu" popover="auto" style="position:fixed;inset:48px 0 0;margin:0;width:100%;height:auto;background:rgb(0 0 0 / .25)">menu</div>
    <dialog id="ask">ask</dialog><main id="content"></main>`);
  await page.addScriptTag({ content: await teachingBundle() });
  await page.evaluate(() => (window as unknown as { teach(): void }).teach());
  const card = page.locator(".teaching-card");
  assert.equal(await card.isVisible(), true, "the card shows over the map");

  await page.evaluate(() => document.querySelector<HTMLElement>("#menu")!.showPopover());
  assert.equal(await card.isVisible(), false, "with the menu open, no part of the card is drawn, not even over the bar above it");
  await page.evaluate(() => document.querySelector<HTMLElement>("#menu")!.hidePopover());
  assert.equal(await card.isVisible(), true, "the card comes back when the menu closes");

  await page.evaluate(() => document.querySelector<HTMLDialogElement>("#ask")!.showModal());
  assert.equal(await card.isVisible(), false, "a modal dialog hides it too");
  await page.evaluate(() => document.querySelector<HTMLDialogElement>("#ask")!.close());
  assert.equal(await card.isVisible(), true);
});
