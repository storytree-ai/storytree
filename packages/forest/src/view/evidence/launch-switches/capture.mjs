// The app at launch, laptop size (ADR-1002 D1, 2026-10-12): Stories on and Library off, then Library pressed on.
// Run with node --import tsx capture.mjs [--retake].
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, captureSeed, runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const { seed, survey } = captureSeed('forest');
const switches = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.forest-views [data-globe-switch]')]
  .map(button => [button.dataset.globeSwitch, button.getAttribute('aria-pressed')])));

await buildCapture({ dist });
await runCapture({
  folder: here, dist, seed, survey, viewport: { width: 1366, height: 768 },
  prepare: async ({ page }) => {
    await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe, undefined, { timeout: 120000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: [
    { name: 'launch', measure: async ({ page }) => switches(page),
      expect: value => assert.deepEqual(value, { stories: 'true', library: 'false' }, '3.10 a launch of the app opens with Stories on and Library off') },
    { name: 'library-pressed', prepare: async ({ page }) => { await page.click('.forest-views button[data-globe-switch="library"]'); },
      measure: async ({ page }) => switches(page),
      expect: value => assert.deepEqual(value, { stories: 'true', library: 'true' }, '3.10 one press turns Library on') },
  ],
});
