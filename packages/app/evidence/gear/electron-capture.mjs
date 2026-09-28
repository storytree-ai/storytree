// Run under the heavy lock with DISPLAY pointing at Xvfb and STORYTREE_HOME at the restored copy.
// Drives the existing pnpm desktop:smoke through CDP; that command writes each screenshot itself.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, '../../../..');
assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
assert.ok(process.env.DISPLAY, 'a temporary X display is required');
const results = [];
for (const mode of ['menu-closed', 'menu-open', 'project-switcher-open']) {
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
    if (mode !== 'menu-closed') await page.getByRole('button', { name: 'App menu', exact: true }).click();
    if (mode === 'project-switcher-open') await page.locator('#project').click();
    const state = await page.evaluate(() => ({
      state: document.body.dataset.state, drew: JSON.parse(document.body.dataset.drew),
      menuOpen: document.querySelector('#app-menu').matches(':popover-open'),
      pickerOpen: document.querySelector('#project').matches(':open'),
      viewport: { width: innerWidth, height: innerHeight },
    }));
    assert.equal(state.menuOpen, mode !== 'menu-closed');
    assert.equal(state.pickerOpen, mode === 'project-switcher-open');
    const [code] = await exited;
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    assert.equal(code, 0, log);
    assert.ok(readFileSync(screenshot).length > 10000);
    results.push({ mode, ...state, screenshot: path.basename(screenshot) });
    console.log(`${mode}: Electron smoke passed`);
  } finally {
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    if (child.exitCode === null) child.kill('SIGTERM');
    await browser?.close().catch(() => {});
  }
}
writeFileSync(path.join(output, 'electron-capture.json'), JSON.stringify(results, null, 2) + '\n');
