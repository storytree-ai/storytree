// Reuses the gear lane's real pnpm desktop:smoke + CDP route. No pixel editing.
// Run with the heavy lock, an isolated restored STORYTREE_HOME and a temporary DISPLAY.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, '../../../..');
assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
assert.ok(process.env.DISPLAY, 'a temporary X display is required');
const modes = process.env.TOP_BARS_CAPTURE_MODE?.split(',') ?? ['bars-closed', 'arcs-open', 'overlay-projects', 'overlay-settings', 'overlay-updates', 'overlay-help', 'narrow-settings'];
const record = path.join(output, 'electron-capture.json');
// Only the smoke command's one 800 ms screenshot delay is extended; no product files
// or app actions change. Its short default can expire during a software GPU capture.
async function giveCaptureTime(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  try {
    await new Promise((resolve, reject) => {
      socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
        else resolve();
      };
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(() => {
        const original = globalThis.setTimeout;
        globalThis.setTimeout = function(callback, delay, ...args) {
          if (delay === 800) { globalThis.setTimeout = original; console.log("top-bars: capture window visible"); return original(callback, 6000, ...args); }
          return original(callback, delay, ...args);
        };
      })()` } }));
    });
  } finally { socket.close(); }
}
const results = process.env.TOP_BARS_CAPTURE_MODE && existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')).filter(result => !modes.includes(result.mode)) : [];
for (const mode of modes) {
  let log = '', browser, windowVisible;
  const visible = new Promise(resolve => { windowVisible = resolve; });
  const screenshot = path.join(output, `${mode}.png`);
  const child = spawn('pnpm', ['desktop:smoke', '--project', 'storytree', '--remote-debugging-port=0', '--inspect=0', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--screenshot', screenshot], { cwd: root, env: process.env });
  const exited = once(child, 'exit');
  try {
    const endpoints = await new Promise((resolve, reject) => {
      const read = chunk => {
        log += String(chunk);
        if (log.includes('top-bars: capture window visible')) windowVisible();
        const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        const inspector = log.match(/Debugger listening on (ws:\/\/[^\s]+)/);
        if (match && inspector) resolve({ browser: match[1], inspector: inspector[1] });
      };
      child.stdout.on('data', read); child.stderr.on('data', read);
      exited.then(([code]) => reject(new Error(`smoke exited ${code} before CDP: ${log}`)));
    });
    await giveCaptureTime(endpoints.inspector);
    browser = await chromium.connectOverCDP(endpoints.browser);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent('page');
    const cdp = await context.newCDPSession(page);
    // Set the requested view immediately after smoke's final scope sweep. Doing this
    // inside its click event avoids racing its 800 ms capture-and-exit window over CDP.
    const observeSmoke = mode => {
      if (window.topBarsObserving) return;
      window.topBarsObserving = true;
      document.addEventListener('click', event => {
        const scope = event.target.closest?.('[data-arc-scope]')?.dataset.arcScope;
        if (scope === 'closed') window.topBarsSawClosed = true;
        if (scope !== 'active' || !window.topBarsSawClosed || window.topBarsSmokeReady) return;
        queueMicrotask(() => {
          if (mode !== 'arcs-open') document.querySelector('[data-close-arcs]')?.click();
          if (mode.startsWith('overlay-') || mode === 'narrow-settings') {
            document.querySelector('.app-gear').click();
            const section = mode === 'narrow-settings' ? 'settings' : mode.slice('overlay-'.length);
            document.querySelector(`[data-app-section="${section}"]`).click();
            if (section === 'updates') document.querySelector('[data-app-updates]').click();
          }
          document.activeElement?.blur();
          window.topBarsSmokeReady = true;
        });
      }, true);
    };
    await page.addInitScript(observeSmoke, mode);
    await page.evaluate(observeSmoke, mode);
    await page.emulateMedia({ colorScheme: 'dark' });
    // Electron's devtools protocol does not expose Browser.setWindowBounds. A narrow
    // CSS viewport on this same smoke window exercises its actual renderer at 360 px.
    await page.waitForSelector('.app-gear', { timeout: 60000 });
    await page.evaluate(() => { if (document.querySelector('#app-menu').matches(':popover-open')) document.querySelector('[data-app-close]').click(); });
    await page.waitForFunction(() => window.topBarsSmokeReady, undefined, { timeout: 60000 });
    await Promise.race([visible, exited.then(() => { throw new Error('smoke exited before showing its capture window'); })]);
    // Smoke has now set the native window size; apply narrow emulation after that resize.
    if (mode === 'narrow-settings') await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (mode.endsWith('settings')) await page.waitForSelector('#settings-panel [data-setting="context-guidance"]');
    if (mode === 'overlay-updates') await page.waitForFunction(() => document.querySelector('#app-update-status').dataset.phase === 'unavailable');
    await page.mouse.move(4, 4); // A resting pointer must not leave a forest tooltip in the capture.
    const state = await page.evaluate(() => {
      const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
      return {
        state: document.body.dataset.state, drew: JSON.parse(document.body.dataset.drew),
        overlayOpen: document.querySelector('#app-menu').matches(':popover-open'),
        section: document.querySelector('[data-app-section][aria-pressed=true]').dataset.appSection,
        drawerOpen: !document.querySelector('#arc-drawer').hidden,
        appBar: rect(document.querySelector('.app-bar')), arcBar: rect(document.querySelector('.arc-handle:not([hidden])')),
        gear: rect(document.querySelector('.app-gear')), overlay: rect(document.querySelector('.app-menu-window')),
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    assert.equal(state.overlayOpen, mode.startsWith('overlay-') || mode === 'narrow-settings');
    assert.equal(state.drawerOpen, mode === 'arcs-open');
    assert.equal(state.appBar.height, 48);
    assert.equal(state.arcBar.y, 48);
    assert.equal(state.arcBar.height, 48);
    assert.equal(state.arcBar.width, state.viewport.width);
    // Capture the same Electron viewport through CDP: capturePage can retain an older
    // composited frame and includes unused pixels outside an emulated narrow viewport.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: 0, y: 0, ...state.viewport, scale: 1 } });
    const pixels = Buffer.from(data, 'base64');
    const [code] = await exited;
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    assert.equal(code, 0, log);
    writeFileSync(screenshot, pixels);
    assert.ok(readFileSync(screenshot).length > 10000);
    results.push({ mode, capture: 'CDP screenshot of the same pnpm desktop:smoke Electron window' , ...state, screenshot: path.basename(screenshot) });
    writeFileSync(record, JSON.stringify(results, null, 2) + '\n');
    console.log(`${mode}: Electron smoke passed`);
  } finally {
    writeFileSync(path.join(output, `${mode}-smoke.txt`), log);
    if (child.exitCode === null) child.kill('SIGTERM');
    await browser?.close().catch(() => {});
  }
}
writeFileSync(path.join(output, 'electron-capture.json'), JSON.stringify(results, null, 2) + '\n');
