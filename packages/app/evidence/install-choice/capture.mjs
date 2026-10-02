// The gear's When updates install choice (updates 4.13–4.14): the real desktop renderer with a
// stand-in bridge whose install choice lives in this script; the rows capture's seed draws the forest.
// Run: node --import tsx packages/app/evidence/install-choice/capture.mjs [--retake]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(gunzipSync(readFileSync(path.resolve(here, '../../../forest/src/view/evidence/rows/seed.json.gz'))).toString('utf8'));
// The desktop app's own build of the page (the capture kit's globe-observing build is not needed here).
execFileSync(process.execPath, [path.resolve(here, '../../../../apps/desktop/build.mjs')], { stdio: 'inherit' });
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
let choice = { mode: 'hours', from: '01:00', to: '06:00' };
const update = { phase: 'pending', runningBuild: '0.3.412 (abc1234)', nextBuild: '0.3.415' };
const open = async ({ page }) => {
  const menu = page.locator('#app-menu');
  if (!await menu.isVisible()) await page.getByRole('button', { name: /^App menu/ }).click();
  await page.locator('[data-app-section="updates"]').click();
  await page.locator('[data-app-install-choice]:not([hidden])').waitFor();
};
const fits = async ({ page }) => page.locator('#app-menu').evaluate(node => ({ width: innerWidth, scrollsSideways: node.scrollWidth > node.clientWidth, next: node.querySelector('[data-app-install-next]').textContent, status: node.querySelector('#app-update-status').textContent }));
await runCapture({
  folder: here, dist, seed,
  answers: {
    checkForUpdates: async () => update,
    readInstallChoice: async () => ({ available: true, choice }),
    setInstallChoice: async wanted => ({ available: true, choice: choice = wanted }),
  },
  prepare: async ({ page }) => {
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
    for (const name of ['Close help']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  },
  views: [
    { name: 'desktop-quiet-hours', prepare: open, measure: fits, expect: value => { assert.match(value.next, /01:00/); assert.match(value.status, /quiet hours, 01:00 to 06:00/); } },
    { name: 'desktop-manual-only', prepare: async context => { await open(context); await context.page.locator('input[value="manual"]').check(); await context.page.waitForFunction(() => /only when you say/.test(document.querySelector('#app-update-status').textContent)); }, measure: fits, expect: value => { assert.match(value.next, /download in the background/); assert.match(value.status, /only when you say/); } },
    { name: 'narrow-quiet-hours', prepare: async context => { await context.page.setViewportSize({ width: 360, height: 760 }); await open(context); await context.page.locator('input[value="hours"]').check(); await context.page.waitForFunction(() => /01:00/.test(document.querySelector('[data-app-install-next]').textContent)); await context.page.locator('[data-app-install-choice]').scrollIntoViewIfNeeded(); }, measure: fits, expect: value => assert.equal(value.scrollsSideways, false) },
  ],
});
