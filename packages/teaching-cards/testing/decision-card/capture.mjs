// The decision card with More open shows Next and End tour without scrolling inside it (increment_5f1681367e8c; contract 3.1):
// the real desktop page on the eight-story forest snapshot at 1440 x 960, the tour taken, Next pressed until the decision's card
// shows, then More, then its text scrolled to its end. Measures the card and its two buttons, and whether each button is the thing drawn at its own centre.
// `node --import tsx capture.mjs [before|after]` (append --retake to write into src/view/evidence/decision-card).
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureSeed, runCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../src/view/evidence', 'decision-card');
const name = process.argv.find(arg => arg === 'before' || arg === 'after') ?? 'after';
const { seed } = captureSeed('forest');
const dist = buildFolder(here, name);
await buildCapture({ dist });

const until = (page, predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 180_000, polling: 200 });

await runCapture({
  folder: pictures, dist, seed, teaching: 'shown',
  prepare: async ({ page, settle }) => {
    await until(page, () => document.body.dataset.state === 'ready' && window.storytreeGlobe?.still());
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, () => document.querySelector('.teaching-card') !== null);
    await page.getByRole('button', { name: 'Show me', exact: true }).click();
    for (let step = 0; step < 12; step++) {
      await until(page, () => document.querySelector('.teaching-card:not([data-kind="tour"])') !== null);
      if (await page.evaluate(() => document.querySelector('.teaching-card')?.dataset.kind) === 'decision') break;
      await page.locator('.teaching-card [data-dismiss]').click();
    }
    assert.equal(await page.evaluate(() => document.querySelector('.teaching-card')?.dataset.kind), 'decision', "the decision's card shows");
    await page.locator('.teaching-card [data-more]').click();
    await settle(page);
  },
  views: [{
    name: `decision-card-more-open-${name}`,
    measure: ({ page }) => page.evaluate(() => {
      const box = one => { const { left, top, right, bottom } = one.getBoundingClientRect(); return { left, top, right, bottom }; };
      const card = document.querySelector('.teaching-card');
      const buttons = ['[data-dismiss]', '[data-end]'].map(selector => {
        const button = card.querySelector(selector);
        const { left, top, right, bottom } = box(button);
        const drawn = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return { label: button.textContent, box: { left, top, right, bottom }, drawnAtCentre: drawn === button || button.contains(drawn) };
      });
      return { window: { width: innerWidth, height: innerHeight }, card: box(card), buttons };
    }),
    // Main's card before this increment ran past the window's bottom: its picture is taken, its reading kept, not asserted.
    expect: found => name === 'before' || assert.ok(found.buttons.every(one => one.drawnAtCentre), `Next and End tour show without scrolling: ${JSON.stringify(found.buttons)}`),
  }, {
    // A card with More open is at most 24rem tall (increment_d0639d5f51b3), but not one that draws: scrolled to its end, the drawing shows whole.
    name: `decision-card-scrolled-to-its-end-${name}`,
    prepare: async ({ page, settle }) => {
      await page.locator('.teaching-card .teaching-card-text').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await settle(page);
    },
    measure: ({ page }) => page.evaluate(() => {
      const box = one => { const { left, top, right, bottom } = one.getBoundingClientRect(); return { left, top, right, bottom }; };
      const text = document.querySelector('.teaching-card .teaching-card-text');
      return { text: box(text), drawing: box(text.querySelector('.tour-diagram')), next: box(document.querySelector('.teaching-card [data-dismiss]')) };
    }),
    expect: found => name === 'before' || assert.ok(found.drawing.top >= found.text.top - 1 && found.drawing.bottom <= found.text.bottom + 1 && found.text.bottom <= found.next.top,
      `scrolled to its end, the drawing shows whole inside the text, above the buttons: ${JSON.stringify(found)}`),
  }],
});
