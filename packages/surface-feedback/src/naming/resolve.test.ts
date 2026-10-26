import assert from "node:assert/strict";
import { test } from "node:test";

import { bundled, launchChrome, pageWith } from "../testing/page.js";

const PAGE = `
  <style>[data-surface-id] { min-width: 10px; min-height: 10px; }</style>
  <dialog id="consent"><section data-surface-id="journey-consent">consent</section></dialog>
  <div id="menu" popover="auto"><section data-surface-id="menu:projects">projects</section><section data-surface-id="menu:help" hidden>help</section></div>
  <section data-surface-id="arcs" data-surface-layer="overlay" hidden>arcs</section>
  <aside data-surface-id="story-panel" data-surface-layer="panel" hidden>story</aside>
  <div id="closed" style="display: none"><section data-surface-id="never">never</section></div>
  <main data-surface-id="globe"><div class="forest">globe</div></main>
`;

test("2.1 · the top-most named surface on show is recorded: an open popover or dialog, then an overlay, then a side panel, then the main view; none on show names none", async (t) => {
  const browser = await launchChrome();
  t.after(() => browser.close());
  const page = await pageWith(browser, PAGE, [await bundled({ entryPoints: [new URL("./resolve.ts", import.meta.url)] }, "naming")]);
  const front = () => page.evaluate("naming.surfaceInFront(document)");
  const show = (selector: string) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).hidden = false`);

  assert.equal(await front(), "globe", "the main view, when nothing is over it");
  await show("[data-surface-id=story-panel]");
  assert.equal(await front(), "story-panel", "a side panel is above the main view");
  await show("[data-surface-id=arcs]");
  assert.equal(await front(), "arcs", "an overlay is above a side panel and the main view, though both come later in the page");
  await page.evaluate("document.getElementById('menu').showPopover()");
  assert.equal(await front(), "menu:projects", "an open popover is above every overlay, and its hidden tab is not on show");
  await page.evaluate("document.querySelector('[data-surface-id=\"menu:projects\"]').hidden = true; document.querySelector('[data-surface-id=\"menu:help\"]').hidden = false");
  assert.equal(await front(), "menu:help", "the tab on show is the one named");
  await page.evaluate("document.getElementById('consent').showModal()");
  assert.equal(await front(), "journey-consent", "a dialog opened over the popover is above it");
  await page.evaluate("document.getElementById('consent').close(); document.getElementById('menu').hidePopover()");
  assert.equal(await front(), "arcs", "closed again, the overlay is in front");

  await page.evaluate("for (const named of document.querySelectorAll('[data-surface-id]')) named.hidden = true");
  assert.equal(await front(), undefined, "nothing named on show names nothing");
});
