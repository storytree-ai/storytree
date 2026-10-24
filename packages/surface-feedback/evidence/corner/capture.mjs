// The feedback corner in the real renderer, over the forest seed: closed, picking (the gear button outlined over the
// globe), open on the picked gear button, open on a switch picked in the gear menu, and a failed send. Run with `node --import tsx capture.mjs`; --retake replaces the committed pictures.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, captureSeed, runCapture } from '../../../../apps/desktop/src/capture/index.ts';
import namedSurfaces from '../../../../apps/desktop/src/main/parts/named-surfaces.ts';
import surfaces from '../../../../apps/desktop/src/main/parts/surfaces.ts';
import { declaredSurfaces } from '../../../../apps/desktop/src/page-operations.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
await buildCapture({ dist });
const { seed } = captureSeed('forest');
let sends = 0;
const startPick = async page => {
  await page.keyboard.press('Control+Shift+F');
  await page.waitForFunction(() => !document.querySelector('[data-corner-picker]').hidden);
};
const hover = async (page, selector) => {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return box;
};
const pick = async (page, selector) => {
  const box = await hover(page, selector);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => !document.querySelector('[data-corner-composer]').hidden);
};
const close = async page => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-corner-composer]').hidden);
};

await runCapture({
  folder: here, dist, seed,
  answers: {
    feedbackSetup: async () => ({ offered: true, surfaces: declaredSurfaces([surfaces, namedSurfaces]) }),
    captureForFeedback: async box => (box === undefined ? 'picture' : 'crop'),
    sendFeedback: async () => { sends++; throw new Error('the library is not open'); },
  },
  views: [
    { name: 'closed', prepare: ({ page }) => page.locator('[data-corner-button]').waitFor() },
    {
      name: 'picking',
      prepare: async ({ page }) => { await startPick(page); await hover(page, '.app-gear'); },
      measure: ({ page }) => page.locator('[data-corner-label]').textContent(),
      expect: label => assert.match(label, /^button · \d+×\d+$/),
    },
    {
      name: 'picked',
      prepare: async ({ page }) => { await pick(page, '.app-gear'); await page.fill('[data-corner-text]', 'The gear is hard to see against the globe.'); },
      measure: ({ page }) => page.locator('[data-corner-anchor]').textContent(),
      expect: named => assert.match(named, /^button/),
    },
    {
      name: 'over-gear-menu',
      prepare: async ({ page }) => {
        await close(page);
        await page.click('.app-gear');
        await page.click('[data-app-section="surfaces"]');
        await startPick(page);
        await pick(page, '#surfaces-title');
        await page.fill('[data-corner-text]', 'Say what each switch hides.');
      },
      measure: ({ page }) => page.inputValue('[data-corner-surface]'),
      expect: surface => assert.equal(surface, 'menu:surfaces'),
    },
    {
      name: 'failed',
      prepare: async ({ page }) => { await page.click('[data-corner-send]'); await page.locator('[data-corner-retry]').waitFor(); },
      measure: ({ page }) => page.locator('[data-corner-status]').textContent(),
      expect: words => { assert.match(words, /^Not sent: /); assert.equal(sends, 1); },
    },
  ],
});
