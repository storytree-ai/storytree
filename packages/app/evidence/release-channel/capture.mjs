// The gear's Update channel choice (updates 4.24): the real desktop renderer with a stand-in bridge
// whose channel lives in this script; the rows capture's seed draws the forest.
// Run: node --import tsx packages/app/evidence/release-channel/capture.mjs [--retake]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(gunzipSync(readFileSync(path.resolve(here, '../../../forest/src/view/evidence/rows/seed.json.gz'))).toString('utf8'));
execFileSync(process.execPath, ['--import', 'tsx', path.resolve(here, '../../../../apps/desktop/build.mjs')], { stdio: 'inherit' });
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
let channel = 'stable';
const open = async ({ page }) => {
  const menu = page.locator('#app-menu');
  if (!await menu.isVisible()) await page.getByRole('button', { name: /^App menu/ }).click();
  await page.locator('[data-app-section="updates"]').click();
  await page.locator('[data-app-release-channel]:not([hidden])').waitFor();
  await page.locator('[data-app-release-channel]').scrollIntoViewIfNeeded();
};
const shows = async ({ page }) => page.locator('#app-menu').evaluate(node => ({ scrollsSideways: node.scrollWidth > node.clientWidth, checked: node.querySelector('input[name="app-release-channel"]:checked')?.value }));
await runCapture({
  folder: here, dist, seed,
  answers: {
    checkForUpdates: async () => ({ phase: 'up-to-date', runningBuild: '0.3.412 (abc1234)' }),
    readInstallChoice: async () => ({ available: true, choice: { mode: 'quiet' } }),
    readReleaseChannel: async () => ({ available: true, channel }),
    setReleaseChannel: async wanted => ({ available: true, channel: channel = wanted }),
  },
  prepare: async ({ page }) => {
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
    for (const name of ['Close help']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  },
  views: [
    { name: 'desktop-stable-default', prepare: open, measure: shows, expect: value => assert.equal(value.checked, 'stable') },
    { name: 'desktop-alpha-chosen', prepare: async context => { await open(context); await context.page.locator('input[value="alpha"]').check(); await context.page.waitForFunction(() => !document.querySelector('input[value="alpha"]').disabled); }, measure: shows, expect: value => { assert.equal(value.checked, 'alpha'); assert.equal(channel, 'alpha'); } },
    { name: 'narrow-stable', prepare: async context => { channel = 'stable'; await context.page.setViewportSize({ width: 360, height: 760 }); await context.page.reload(); await context.page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 }); await open(context); }, measure: shows, expect: value => assert.equal(value.scrollsSideways, false) },
  ],
});
