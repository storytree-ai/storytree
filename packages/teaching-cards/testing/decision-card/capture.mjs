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
    expect: found => name === 'before' || assert.ok(found.buttons.every(one => one.drawnAtCentre), `Next and End tour show without scrolling: ${JSON.stringify(found.buttons)}`),
  }, {
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
