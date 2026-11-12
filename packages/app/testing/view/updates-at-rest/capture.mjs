// The gear's Updates section at rest (4.48, contract_78913488b399), as an installed user sees it: the real desktop page on the
// eight-story forest snapshot, its stand-in bridge answering as an installed copy (the capture kit's installedUpdates, 2.60),
// once with the updater idle and once with a build waiting to install. Each run opens the gear, picks Updates and presses
// nothing else; the waiting run also pictures the gear's dot before the menu opens. `node --import tsx capture.mjs` (append
// --retake to write into src/view/evidence/updates-at-rest). Measures what the section shows, in order, and what it hides.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, installedUpdates, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(here, '../../../src/view/evidence/updates-at-rest');
const folder = captureOutput(evidence);
const dist = buildFolder(here);
await buildCapture({ dist });

/** What the Updates section shows, top to bottom, with each hidden part left out; and the gear's dot and its first row. */
const section = page => page.evaluate(() => {
  const shown = element => element !== null && !element.hidden && element.closest('[hidden]') === null && getComputedStyle(element).display !== 'none';
  const updates = document.querySelector('#app-updates');
  const parts = [...updates.querySelectorAll('h2, .app-section-description, [data-app-updates], #app-update-status, fieldset, [data-app-sign-in]')].filter(shown);
  const gear = document.querySelector('.app-gear');
  const ready = document.querySelector('[data-app-update-ready]');
  return {
    open: shown(updates),
    order: parts.map(part => part.matches('fieldset') ? `${part.querySelector('legend').textContent}: ${[...part.querySelectorAll('input[type="radio"]')].find(radio => radio.checked)?.value ?? 'none'}` : part.matches('[data-app-sign-in]') ? `Open at sign-in: ${part.querySelector('input').checked ? 'on' : 'off'}` : part.textContent.trim()),
    errors: [...updates.querySelectorAll('[role="alert"]')].filter(shown).map(error => error.textContent),
    dot: gear.hasAttribute('data-update-pending'),
    gearTitle: gear.title,
    firstRow: shown(ready) ? ready.textContent : undefined,
    installNext: [...updates.querySelectorAll('[data-app-install-next]')].filter(shown).map(line => line.textContent),
  };
});

const openUpdates = async ({ page, settle }) => {
  await page.getByRole('button', { name: 'App menu', exact: true }).first().click();
  await page.locator('[data-app-section="updates"]').click();
  await page.waitForFunction(() => document.querySelector('[data-app-install-choice]')?.hidden === false && document.querySelector('[data-app-release-channel]')?.hidden === false, undefined, { timeout: 30_000 });
  await settle(page, 6);
};

const prepare = async ({ page, settle }) => {
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180_000 });
  await settle(page, 30);
};

for (const state of ['idle', 'waiting']) {
  const { seed } = captureSeed('forest');
  await runCapture({
    folder: evidence, dist, seed,
    answers: installedUpdates(state),
    prepare,
    views: [
      ...(state === 'waiting' ? [{
        name: 'gear-with-update-waiting',
        prepare: async ({ page, settle }) => { await page.locator('.app-gear').hover(); await settle(page, 6); },
        measure: async ({ page }) => section(page),
        expect: found => { assert.equal(found.dot, true, 'the gear carries the dot'); assert.match(found.gearTitle, /Update ready/); },
      }] : []),
      {
        name: `updates-at-rest-${state}`,
        prepare: openUpdates,
        measure: async ({ page }) => section(page),
        expect: found => {
          assert.equal(found.open, true, 'the Updates section is on show');
          assert.deepEqual(found.errors, [], 'no error line at rest');
          assert.equal(found.order[2], state === 'idle' ? 'Check for updates' : 'Restart to update');
          assert.equal(found.order.some(part => part.startsWith('When updates install: quiet')), true, JSON.stringify(found.order));
          assert.equal(found.firstRow, undefined, 'with Updates on show the menu has no update row above it: the status line names the build');
          assert.deepEqual(found.installNext, [], 'the quiet option says when an update installs, and a waiting build\'s status line does');
        },
      },
    ],
  });
}
console.log(`pictures in ${folder}`);
