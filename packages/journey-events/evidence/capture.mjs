// Real desktop renderer, fixed state/viewport, bridge intercepted locally. No service credentials or sends.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { buildCapture, withCapture, fakeBridge } from '../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const dist = path.join(root, '.pgtest/windows-health-successor/journey-renderer');
await buildCapture({ dist, root });
await withCapture({ folder: here, dist, softwareGL: false }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  let state = { consent: 'pending', available: false, installId: 'installation-capture-example', queued: 0 };
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: [] }),
    readJourney: async () => state,
    chooseJourney: async on => state = { ...state, consent: on ? 'on' : 'off', queued: 0 },
    prepareJourneyDeletion: async () => { state = { ...state, consent: 'off', queued: 0 }; return { installId: state.installId, ...(state.deletionContact ? { contact: state.deletionContact } : {}) }; },
  });
  await bridge.install(page);
  await page.addInitScript(() => localStorage.setItem("storytree:setup:guide-seen:v1", "yes"));
  await page.goto(origin);
  await page.waitForSelector('.journey-consent:not([hidden])');
  await settle(page);
  const closeMenu = page.getByRole("button", { name: "Close app menu", exact: true });
  if (await closeMenu.isVisible()) await closeMenu.click();
  const measures = [];
  async function capture(name) {
    const measurement = await page.locator('.journey-panel:visible').evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      return { viewport: { width: innerWidth, height: innerHeight }, panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, frameFraction: rect.width * rect.height / (innerWidth * innerHeight), controls: [...panel.querySelectorAll('button')].map(button => { const b = button.getBoundingClientRect(); return { label: button.textContent, disabled: button.disabled, width: b.width, height: b.height, fontSize: getComputedStyle(button).fontSize }; }), overflow: panel.scrollWidth > panel.clientWidth };
    });
    assert.equal(measurement.overflow, false);
    assert.ok(measurement.controls.every(button => button.height >= 38), JSON.stringify(measurement));
    measures.push({ name, ...measurement });
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  }
  await capture('first-launch-unavailable');
  await page.getByRole('button', { name: 'No thanks', exact: true }).click();
  await page.getByRole('button', { name: 'App menu', exact: true }).click();
  await page.getByRole('button', { name: 'Sharing', exact: true }).click();
  await page.waitForSelector('#app-sharing .journey-panel:not([hidden])');
  await capture('settings-unavailable');
  await page.getByRole('button', { name: 'Prepare deletion request', exact: true }).click();
  await page.waitForSelector('[data-journey-deletion]:not([hidden])');
  assert.match(await page.locator('[data-journey-deletion]').innerText(), /has not been sent/);
  await capture('deletion-unavailable');
  // Configured appearance only: this bridge remains intercepted and never sends a real event.
  state = { ...state, consent: 'on', available: true, retention: '30 days (capture example)', deletionContact: 'privacy@example.test' };
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Sharing', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app-sharing [data-journey-status]')?.textContent === 'Sharing is on.');
  await capture('settings-configured-example');
  await page.setViewportSize({ width: 560, height: 820 });
  await capture('settings-narrow');
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ browser: await browser.version(), intercepted: true, liveSends: 0, errors, measures }, null, 2) + '\n');
});
