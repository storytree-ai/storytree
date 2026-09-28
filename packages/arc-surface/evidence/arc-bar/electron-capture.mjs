// Run under the heavy lock with DISPLAY pointing at Xvfb and STORYTREE_HOME at the restored copy.
// Reuses the gear lane route: two actual Electron smoke window captures, no pixel edits.
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
for (const mode of (process.env.ARC_CAPTURE_MODE ? [process.env.ARC_CAPTURE_MODE] : ['bar-closed', 'bar-open'])) {
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
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForSelector('.app-gear', { timeout: 60000 });
    await page.evaluate(() => {
      document.querySelector('#setup-help-panel:not([hidden]) [data-close-help]')?.click();
    });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 60000 });
    await page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: 60000 });
    if (mode === 'bar-closed') await page.getByRole('button', { name: 'Close arc surface', exact: true }).click();
    // Resting pointer state, after smoke's programmatic controls took keyboard focus.
    await page.mouse.click(24, await page.evaluate(() => innerHeight - 180));
    const state = await page.evaluate(() => {
      const drawer = document.querySelector('#arc-drawer');
      const bar = document.querySelector(drawer.hidden ? '[data-open-arcs]' : '[data-close-arcs]');
      const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
      return {
        colorScheme: 'dark', state: document.body.dataset.state, drew: JSON.parse(document.body.dataset.drew),
        drawerOpen: !drawer.hidden, bar: rect(bar), gear: rect(document.querySelector('.app-gear')),
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    assert.equal(state.drawerOpen, mode === 'bar-open');
    assert.equal(state.bar.x, 0);
    assert.equal(state.gear.x - state.bar.width, 12);
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
