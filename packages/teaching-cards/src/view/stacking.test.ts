import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

/** The real card code, bundled for the browser: `window.teach()` shows the story's card, or the decision's once the story's is seen. */
async function teachingBundle({ seen = [] as string[], at = { x: 100, y: 20 } } = {}): Promise<string> {
  const entry = `import { mountTeaching } from ${JSON.stringify(path.join(import.meta.dirname, "index.ts"))};
    import { journal } from ${JSON.stringify(path.join(import.meta.dirname, "../journal.ts"))};
    const kept = new Map([["storytree.teaching.tour.v1", "yes"]]);
    const told = journal({ getItem: key => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) });
    for (const kind of ${JSON.stringify(seen)}) told.mark(kind);
    window.teach = () => mountTeaching(document.querySelector("#content"), { journal: told, locate: () => ({ ...${JSON.stringify(at)}, visible: true }) })
      .take({ tree: { stories: [{ id: "story_a", capabilities: [] }], arcs: [] }, lines: [],
        changes: [{ type: "decision", recordId: "decision_1", action: "created", record: { fields: {} } }] });`;
  const result = await build({ stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "js" }, bundle: true, write: false, format: "iife" });
  return result.outputFiles[0]!.text;
}

test("3.4 · an open popover, modal dialog or overlay surface draws over the card on show: the card hides while it is open and comes back when it closes", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  // A menu like the gear's: a popover below a bar the card may overlap, and a modal dialog.
  await page.setContent(`<header style="position:fixed;inset:0 0 auto;height:48px;z-index:7;background:#101418"></header>
    <div id="menu" popover="auto" style="position:fixed;inset:48px 0 0;margin:0;width:100%;height:auto;background:rgb(0 0 0 / .25)">menu</div>
    <dialog id="ask">ask</dialog><section id="consent" data-surface-layer="overlay" hidden>consent</section><main id="content"></main>`);
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

  // An overlay surface on show, like the first launch's sharing consent, which is neither a popover nor a dialog.
  await page.evaluate(() => { document.querySelector<HTMLElement>("#consent")!.hidden = false; });
  assert.equal(await card.isVisible(), false, "an overlay surface on show hides it too");
  await page.evaluate(() => { document.querySelector<HTMLElement>("#consent")!.hidden = true; });
  assert.equal(await card.isVisible(), true, "and it comes back when the overlay is answered");
});

test("3.1 · the decision card with More open, drawing and all, keeps Next and End tour on show inside a 1440 x 960 window, with no scrolling inside the card", async t => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.setContent(`<main id="content"></main>`);
  await page.addScriptTag({ content: await teachingBundle({ seen: ["story"], at: { x: 1000, y: 480 } }) });
  await page.evaluate(() => (window as unknown as { teach(): void }).teach());
  assert.equal(await page.locator(".teaching-card").getAttribute("data-kind"), "decision");
  await page.locator(".teaching-card [data-more]").click();
  assert.ok(await page.locator(".teaching-card .tour-diagram").isVisible(), "its depth draws the decision");
  // Taller than a 24rem card's text could show, the drawing still shows whole: a card that draws is not held to 24rem.
  const drawing = (await page.locator(".teaching-card .tour-diagram").boundingBox())!, text = (await page.locator(".teaching-card .teaching-card-text").boundingBox())!;
  assert.ok(drawing.y >= text.y && drawing.y + drawing.height <= text.y + text.height, `the drawing whole inside the card's text: ${JSON.stringify({ drawing, text })}`);
  for (const name of ["Next", "End tour"]) {
    const button = page.getByRole("button", { name, exact: true });
    const box = (await button.boundingBox())!;
    assert.ok(box.y >= 0 && box.y + box.height <= 960 && box.x >= 0 && box.x + box.width <= 1440, `${name} is inside the window: ${JSON.stringify(box)}`);
    // Drawn at its own centre: not cut off by the card's scrolling part, nor reached only by scrolling it.
    const drawn = await button.evaluate(one => { const { left, top, right, bottom } = one.getBoundingClientRect(); const at = document.elementFromPoint((left + right) / 2, (top + bottom) / 2); return at !== null && one.contains(at); });
    assert.ok(drawn, `${name} shows without scrolling inside the card`);
  }
});

test("3.5 · with More open a card stays short enough to find a place clear of the map's islands: its text scrolls above its buttons, which stay on show", async t => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.setContent(`<main id="content"></main>`);
  await page.addScriptTag({ content: await teachingBundle() });
  await page.evaluate(() => (window as unknown as { teach(): void }).teach());
  await page.getByRole("button", { name: "More", exact: true }).click();
  const card = (await page.locator(".teaching-card").boundingBox())!;
  const buttons = (await page.locator(".teaching-card-actions").boundingBox())!;
  assert.ok(card.height <= 384, `no taller than 24rem in a tall window, where the story's depth alone is taller (${card.height}px)`);
  assert.ok(buttons.y >= card.y && buttons.y + buttons.height <= card.y + card.height, "its buttons inside the card, on show");
  const text = page.locator(".teaching-card .teaching-card-text");
  assert.equal(await text.evaluate(element => element.scrollHeight > element.clientHeight), true, "its text scrolls within it");
  const fades = () => text.evaluate(element => getComputedStyle(element).maskImage !== "none");
  assert.equal(await fades(), true, "and its foot fades while more of it lies below");
  await text.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => !document.querySelector(".teaching-card .teaching-card-text")!.hasAttribute("data-more-below"));
  assert.equal(await fades(), false, "scrolled to its end, nothing fades");
});
