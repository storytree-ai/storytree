// Run under the heavy lock with DISPLAY pointing at Xvfb and STORYTREE_HOME at the restored copy.
// Drives the real desktop and settings IPC through CDP, capturing the same smoke window.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, '../../../..');
assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
assert.ok(process.env.DISPLAY, 'a temporary X display is required');
const results = [];
for (const mode of (process.env.SETTINGS_CAPTURE_MODE ? [process.env.SETTINGS_CAPTURE_MODE] : ['menu-open', 'panel-default', 'panel-set', 'panel-refused'])) {
  rmSync(path.join(process.env.STORYTREE_HOME, 'settings.json'), { force: true });
  if (mode === 'panel-refused') writeFileSync(path.join(process.env.STORYTREE_HOME, 'settings.json'), JSON.stringify({ 'context-guidance': 420000 }));
  let log = '', browser, captureHold;
  const screenshot = path.join(output, `${mode}.png`);
  const child = spawn('pnpm', ['desktop:smoke', '--project', 'storytree', '--remote-debugging-port=0', '--no-sandbox', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--screenshot', screenshot], { cwd: root, env: process.env });
  const exited = once(child, 'exit');
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const read = chunk => {
        log += String(chunk);
        const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) resolve(match[1]);
      };
      child.stdout.on('data', read); child.stderr.on('data', read);
      exited.then(([code]) => reject(new Error(`smoke exited ${code} before CDP: ${log}`)));
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent('page');
    await page.waitForSelector('.app-gear', { timeout: 60000 });
    await page.evaluate(() => {
      window.settingsCaptureScopes = [];
      document.addEventListener('click', event => {
        const scope = event.target.closest?.('[data-arc-scope]')?.dataset.arcScope;
        if (scope) window.settingsCaptureScopes.push(scope);
      }, true);
      document.querySelector('#setup-help-panel:not([hidden]) [data-close-help]')?.click();
    });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 60000 });
    const port = readFileSync(path.join(process.env.STORYTREE_HOME, 'pgdata', 'postmaster.pid'), 'utf8').split('\n')[3];
    captureHold = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${port}/storytree_storytree` });
    await captureHold.connect();
    // Observe smoke's active → parked → closed → active exercise; visibility alone can
    // already read "visible" for Electron's not-yet-shown window under Xvfb.
    await page.waitForFunction(() => window.settingsCaptureScopes.includes('closed') && window.settingsCaptureScopes.at(-1) === 'active', undefined, { timeout: 60000 });
    await page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: 60000 });
    // Smoke has exercised the arc drawer. Hold only its final census read long enough to
    // capture the requested settings state; this changes no record in the throwaway copy.
    await captureHold.query('BEGIN');
    await captureHold.query('LOCK TABLE record IN ACCESS EXCLUSIVE MODE');
    await page.bringToFront();
    await page.evaluate(() => document.querySelector('[data-close-arcs]')?.click());
    await page.evaluate(() => document.querySelector('.app-gear').click());
    if (mode !== 'menu-open') {
      await page.evaluate(() => document.querySelector('[data-app-settings] button').click());
      await page.waitForSelector('[data-setting="context-guidance"] input', { state: 'attached' });
      if (mode !== 'panel-default') {
        await page.evaluate(value => {
          const form = document.querySelector('[data-setting="context-guidance"]');
          const input = form.querySelector('input');
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          form.requestSubmit();
        }, mode === 'panel-set' ? '420000' : '0');
        await page.waitForFunction(refused => {
          const row = document.querySelector('[data-setting="context-guidance"]');
          return refused ? row.querySelector('[role="alert"]').textContent.includes('positive whole number') : row.querySelector('[role="status"]').textContent === 'Saved';
        }, mode === 'panel-refused');
      }
    }
    const state = await page.evaluate(() => ({
      state: document.body.dataset.state, drew: JSON.parse(document.body.dataset.drew),
      menuOpen: document.querySelector('#app-menu').matches(':popover-open'),
      settingsEnabled: !document.querySelector('[data-app-settings] button').disabled,
      updatesEnabled: !document.querySelector('[data-app-updates]').disabled,
      panelOpen: document.querySelector('#settings-panel').open,
      value: document.querySelector('[data-setting="context-guidance"] input')?.value,
      source: document.querySelector('[data-setting="context-guidance"] .settings-source')?.textContent,
      refusal: document.querySelector('[data-setting="context-guidance"] [role="alert"]')?.textContent,
      viewport: { width: innerWidth, height: innerHeight },
    }));
    assert.equal(state.menuOpen, mode === 'menu-open');
    assert.equal(state.settingsEnabled, true);
    assert.equal(state.updatesEnabled, true);
    assert.equal(state.panelOpen, mode !== 'menu-open');
    if (mode === 'panel-default') { assert.equal(state.value, '700000'); assert.equal(state.source, 'default'); }
    if (mode === 'panel-set') { assert.equal(state.value, '420000'); assert.equal(state.source, 'set by you'); }
    if (mode === 'panel-refused') { assert.equal(state.value, '0'); assert.match(state.refusal, /positive whole number/); }
    console.log(`${mode}: capturing the visible window`);
    // Like the gear lane's native picker capture, CDP captures this same Electron window.
    // capturePage can return an earlier compositor frame (default value after a successful
    // save); screenshot forces a fresh composited frame without editing any pixels.
    const cdp = await context.newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await captureHold.query('ROLLBACK');
    await captureHold.end(); captureHold = undefined;
    const [code] = await exited;
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    assert.equal(code, 0, log);
    writeFileSync(screenshot, Buffer.from(data, 'base64'));
    assert.ok(readFileSync(screenshot).length > 10000);
    results.push({ mode, capture: 'CDP screenshot of the same desktop:smoke Electron window after the requested state', ...state, screenshot: path.basename(screenshot) });
    console.log(`${mode}: Electron smoke passed`);
  } finally {
    await captureHold?.end().catch(() => {});
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    if (child.exitCode === null) child.kill('SIGTERM');
    await browser?.close().catch(() => {});
  }
}
writeFileSync(path.join(output, 'electron-capture.json'), JSON.stringify(results, null, 2) + '\n');
