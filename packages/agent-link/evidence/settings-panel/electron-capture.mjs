// Run under the heavy lock with DISPLAY pointing at Xvfb and STORYTREE_HOME at the restored copy.
// Drives the real desktop and settings IPC through CDP, leaving capture to desktop:smoke.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, '../../../..');
assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
assert.ok(process.env.DISPLAY, 'a temporary X display is required');
const results = [];
for (const mode of (process.env.SETTINGS_CAPTURE_MODE ? [process.env.SETTINGS_CAPTURE_MODE] : ['menu-open', 'panel-default', 'panel-set', 'panel-refused'])) {
  rmSync(path.join(process.env.STORYTREE_HOME, 'settings.json'), { force: true });
  if (mode === 'panel-refused') writeFileSync(path.join(process.env.STORYTREE_HOME, 'settings.json'), JSON.stringify({ 'context-guidance': 420000 }));
  let log = '', browser;
  const screenshot = path.join(output, `${mode}.png`);
  const child = spawn('pnpm', ['desktop:smoke', '--project', 'storytree', '--remote-debugging-port=0', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--screenshot', screenshot], { cwd: root, env: process.env });
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
      document.querySelector('#setup-help-panel:not([hidden]) [data-close-help]')?.click();
    });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 60000 });
    await page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: 60000 });
    await page.evaluate(() => document.querySelector('.app-gear').click());
    if (mode !== 'menu-open') {
      await page.evaluate(() => document.querySelector('[data-app-settings] button').click());
      const input = page.locator('[data-setting="context-guidance"] input');
      await input.waitFor();
      if (mode !== 'panel-default') {
        await input.fill(mode === 'panel-set' ? '420000' : '0');
        await page.evaluate(() => document.querySelector('[data-setting="context-guidance"]').requestSubmit());
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
      panelOpen: document.querySelector('#settings-panel').open,
      value: document.querySelector('[data-setting="context-guidance"] input')?.value,
      source: document.querySelector('[data-setting="context-guidance"] .settings-source')?.textContent,
      refusal: document.querySelector('[data-setting="context-guidance"] [role="alert"]')?.textContent,
      viewport: { width: innerWidth, height: innerHeight },
    }));
    assert.equal(state.menuOpen, mode === 'menu-open');
    assert.equal(state.settingsEnabled, true);
    assert.equal(state.panelOpen, mode !== 'menu-open');
    if (mode === 'panel-default') { assert.equal(state.value, '700000'); assert.equal(state.source, 'default'); }
    if (mode === 'panel-set') { assert.equal(state.value, '420000'); assert.equal(state.source, 'set by you'); }
    if (mode === 'panel-refused') { assert.equal(state.value, '0'); assert.match(state.refusal, /positive whole number/); }
    const [code] = await exited;
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    assert.equal(code, 0, log);
    assert.ok(readFileSync(screenshot).length > 10000);
    results.push({ mode, capture: 'desktop:smoke capturePage', ...state, screenshot: path.basename(screenshot) });
    console.log(`${mode}: Electron smoke passed`);
  } finally {
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    if (child.exitCode === null) child.kill('SIGTERM');
    await browser?.close().catch(() => {});
  }
}
writeFileSync(path.join(output, 'electron-capture.json'), JSON.stringify(results, null, 2) + '\n');
