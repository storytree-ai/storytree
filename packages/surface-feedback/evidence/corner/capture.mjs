// The feedback corner in the real renderer, over the forest seed: closed, open over the globe, open over the gear
// menu, and a failed send. Run with `node --import tsx capture.mjs`; --retake replaces the committed pictures.
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
const open = async page => {
  await page.keyboard.press('Control+Shift+F');
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
    captureForFeedback: async () => 'picture',
    sendFeedback: async () => { sends++; throw new Error('the library is not open'); },
  },
  views: [
    { name: 'closed', prepare: ({ page }) => page.locator('[data-corner-button]').waitFor() },
    {
      name: 'over-globe',
      prepare: async ({ page }) => { await open(page); await page.fill('[data-corner-text]', 'The island labels overlap the roads at this zoom.'); },
      measure: ({ page }) => page.inputValue('[data-corner-surface]'),
      expect: surface => assert.equal(surface, 'globe'),
    },
    {
      name: 'over-gear-menu',
      prepare: async ({ page }) => {
        await close(page);
        await page.click('.app-gear');
        await page.click('[data-app-section="surfaces"]');
        await open(page);
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
