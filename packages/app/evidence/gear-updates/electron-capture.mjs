// Run under the heavy lock with DISPLAY and an isolated, restored STORYTREE_HOME.
// Every picture is pnpm desktop:smoke's unedited Electron capturePage image.
// Menu/unavailable use the real IPC. Other update outcomes are test simulations:
// re-mount the production update view with a fixture request on cloned controls.
// The surrounding renderer, project reads, forest and smoke census remain real.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUpdatesView } from './build.mjs';
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, '../../../..');
const viewCode = await buildUpdatesView();
assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
assert.ok(process.env.DISPLAY, 'a temporary X display is required');
const snapshotPath = process.env.GEAR_SNAPSHOT ?? '/home/mickh/storytree-lanes/snapshots/2026-09-28T07-26-00-491Z.json';
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const results = [];
const modes = ['menu-enabled', 'up-to-date', 'checking', 'building', 'ready', 'restarting', 'failed', 'unavailable'];
for (const mode of (process.env.GEAR_CAPTURE_MODE ? [process.env.GEAR_CAPTURE_MODE] : modes)) {
  let log = '', browser;
  const screenshot = path.join(output, `${mode}.png`);
  const child = spawn('pnpm', ['desktop:smoke', '--project', 'storytree', '--remote-debugging-port=0', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--screenshot', screenshot], { cwd: root, env: process.env, detached: true });
  const exited = once(child, 'exit');
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const read = chunk => { log += String(chunk); const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); };
      child.stdout.on('data', read); child.stderr.on('data', read);
      exited.then(([code]) => reject(new Error(`smoke exited ${code} before CDP: ${log}`)));
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent('page');
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.waitForSelector('.app-gear', { timeout: 60000 });
    await page.evaluate(() => document.querySelector('#setup-help-panel:not([hidden]) [data-close-help]')?.click());
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 60000 });
    const simulated = !['menu-enabled', 'unavailable'].includes(mode);
    const fixture = { phase: mode, runningBuild: 'main c867d70', nextBuild: 'main f21aa04', reason: 'Build failed: TypeScript compilation did not finish successfully.' };
    if (simulated) {
      await page.evaluate(`${viewCode}\nglobalThis.gearUpdateCapture = gearUpdateCapture;`);
      await page.evaluate(state => {
        for (const selector of ['[data-app-updates]', '#app-update-status']) {
          const original = document.querySelector(selector);
          original.replaceWith(original.cloneNode(true));
        }
        window.gearCaptureCalls = [];
        window.gearUpdateCapture.mountUpdates(document.querySelector('#app-menu'), async action => { window.gearCaptureCalls.push(action); return state; });
      }, fixture);
    }
    await page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: 60000 });
    await page.evaluate(selected => {
      document.querySelector('.app-gear').click();
      if (selected !== 'menu-enabled') document.querySelector('[data-app-updates]').click();
    }, mode);
    if (mode !== 'menu-enabled') await page.waitForFunction(expected => document.querySelector('#app-update-status').dataset.phase === expected, mode, { timeout: 5000 });
    const state = await page.evaluate(() => ({
      state: document.body.dataset.state, drew: JSON.parse(document.body.dataset.drew),
      menuOpen: document.querySelector('#app-menu').matches(':popover-open'),
      updatePhase: document.querySelector('#app-update-status').dataset.phase ?? 'idle',
      updateText: document.querySelector('#app-update-status').innerText,
      buttonEnabled: !document.querySelector('[data-app-updates]').disabled,
      viewport: { width: innerWidth, height: innerHeight },
      calls: window.gearCaptureCalls ?? null,
    }));
    assert.equal(state.menuOpen, true);
    assert.equal(state.updatePhase, mode === 'menu-enabled' ? 'idle' : mode);
    assert.deepEqual(errors, []);
    const [code] = await exited;
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    assert.equal(code, 0, log);
    assert.ok(readFileSync(screenshot).length > 10000);
    results.push({ mode, capture: 'pnpm desktop:smoke capturePage, unedited', updateProvenance: simulated ? 'Production mountUpdates remounted in capture harness with simulated update response; project data and surrounding app use real IPC.' : 'Unmodified production view and real checkForUpdates IPC.', snapshot: snapshotPath, records: snapshot.records.length, ...state, errors, screenshot: path.basename(screenshot) });
    console.log(`${mode}: Electron smoke passed`);
  } finally {
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    // Even a harness assertion must let the smoke's finally close its Postgres.
    // desktop:smoke has its own bounded timeout; don't abruptly kill its owner.
    if (child.exitCode === null) await exited;
    await browser?.close().catch(() => {});
  }
}
writeFileSync(path.join(output, 'electron-capture.json'), JSON.stringify(results, null, 2) + '\n');
