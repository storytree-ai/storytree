// Real desktop renderer and snapshot reads; only update results are simulated here.
// Run after desktop build under flock /tmp/storytree-heavy.lock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@storytree/library';
import { pageReads, projectSelection, smokeProblems } from '@storytree/app';
import { start } from '@storytree/local-postgres';

const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(output, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-gear-updates-capture-'));
const snapshotPath = process.env.GEAR_SNAPSHOT ?? '/home/mickh/storytree-lanes/snapshots/2026-09-28T07-26-00-491Z.json';
let pg, store, reads, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'gear updates capture' });
  store = await connect({ url: pg.url });
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  await store.restore('storytree', snapshot);
  reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: path.join(temporary, 'choice.json'), listProjects: () => store.listProjects() });
  await selection.choose('storytree');
  const runningBuild = 'main c867d70';
  let update = { phase: 'up-to-date', runningBuild };
  const actions = [];
  let rejectCheck;
  const bridge = { ...reads, projectSelection: () => selection.read(), chooseProject: name => selection.choose(name), checkForUpdates: async action => {
    actions.push(action);
    if (rejectCheck) { const message = rejectCheck; rejectCheck = undefined; throw new Error(message); }
    return update;
  } };
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'styles.css', 'app-setup.css', 'arc-surface.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.STORYTREE_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.exposeFunction('gearUpdateRead', (method, args) => { assert.ok(Object.hasOwn(bridge, method)); return bridge[method](...args); });
  await page.addInitScript(methods => {
    window.storytree = Object.fromEntries(methods.map(method => [method, (...args) => window.gearUpdateRead(method, args)]));
    try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
  }, Object.keys(bridge));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  const gear = page.getByRole('button', { name: 'App menu', exact: true });
  const menu = page.locator('#app-menu');
  const button = page.locator('[data-app-updates]');
  const status = page.locator('#app-update-status');
  const waitPhase = phase => page.waitForFunction(expected => document.querySelector('#app-update-status').dataset.phase === expected, phase);
  await gear.click();
  assert.equal(await button.isEnabled(), true, 'Check for updates is enabled');
  assert.equal(await status.isVisible(), false, 'no status until requested');
  const menuBox = await menu.boundingBox();
  await button.click();
  await waitPhase('up-to-date');
  assert.equal(actions[0], 'check', 'click requests a check immediately');
  assert.match(await status.innerText(), /Up to date/);
  assert.ok((await status.innerText()).includes(runningBuild), 'up-to-date identifies running build');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  update = { phase: 'building', runningBuild, nextBuild: 'main f21aa04' };
  await button.click(); await waitPhase('building');
  assert.equal(await button.isDisabled(), true, 'busy update cannot be requested twice');
  await page.waitForFunction(() => document.querySelector('#app-update-status').textContent.includes('f21aa04'));
  await gear.click();
  assert.equal(await menu.isVisible(), false);
  update = { ...update, phase: 'ready' };
  await waitPhase('ready');
  await gear.click();
  assert.ok((await status.innerText()).includes('library finishes writing'), 'ready explains the seed-write wait');
  assert.ok(actions.includes('status'), 'status polling continues while menu is closed');
  update = { ...update, phase: 'restarting' };
  await waitPhase('restarting');
  assert.match(await status.innerText(), /Restarting/);
  const longReason = 'Build failed: <img src=x onerror="window.injected=true"> ' + 'x'.repeat(220);
  update = { phase: 'failed', runningBuild, reason: longReason };
  await waitPhase('failed');
  assert.ok((await status.innerText()).includes(longReason), 'failure reason is preserved');
  assert.equal(await status.locator('img').count(), 0, 'failure text cannot inject markup');
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await button.isEnabled(), true, 'failed update can be retried');
  await page.setViewportSize({ width: 360, height: 640 });
  const narrowBox = await menu.boundingBox();
  assert.ok(narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 360, 'menu fits narrow window');
  assert.equal(await menu.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'long failure wraps without horizontal scrolling');
  update = { phase: 'up-to-date', runningBuild };
  const beforeRetry = actions.filter(action => action === 'check').length;
  await button.click(); await waitPhase('up-to-date');
  assert.equal(actions.filter(action => action === 'check').length, beforeRetry + 1, 'retry starts another check');
  rejectCheck = 'Update service disconnected';
  await button.click(); await waitPhase('failed');
  assert.match(await status.innerText(), /Update service disconnected/);
  update = { phase: 'unavailable', runningBuild: 'development' };
  await button.click(); await waitPhase('unavailable');
  assert.match(await status.innerText(), /does not update itself/);
  await page.keyboard.press('Escape');
  assert.equal(await menu.isVisible(), false);
  assert.equal(await gear.evaluate(node => node === document.activeElement), true, 'Escape returns focus to gear');
  await page.setViewportSize({ width: 1440, height: 960 });
  const closeArcs = page.getByRole('button', { name: 'Close arc surface', exact: true });
  if (await closeArcs.count()) await closeArcs.click();
  await page.locator('canvas').evaluate(canvas => {
    window.pointerCount = 0;
    canvas.addEventListener('pointerdown', () => window.pointerCount++);
  });
  await gear.click();
  // Main's full-width arc bar now owns the top strip; dismiss onto visible forest.
  await page.mouse.click(400, 760);
  assert.equal(await menu.isVisible(), false, 'outside click closes menu after an update');
  assert.equal(await page.evaluate(() => window.pointerCount), 1, 'outside dismissal preserves forest pointer input');
  const tree = await reads.projectTree('storytree');
  assert.deepEqual(smokeProblems('ready', tree, await page.getAttribute('body', 'data-drew')), [], 'real snapshot census remains intact');
  assert.deepEqual(errors, []);
  const result = { snapshot: snapshotPath, records: snapshot.records.length, updateProvenance: 'Simulated update states through test-only bridge; renderer and project reads are production code.', viewport: { width: 1440, height: 960 }, menuBox, narrowBox, stories: tree.stories.length, capabilities: tree.stories.reduce((sum, story) => sum + story.capabilities.length, 0), errors, actions,
    passed: ['enabled menu entry', 'click checks now', 'up-to-date running build', 'live status semantics', 'busy request disabled', 'building to ready to restarting via polling', 'status survives menu close/reopen', 'seed-write wait explanation', 'failure reason is plain text', 'long failure wraps at 360px', 'retry checks again', 'IPC rejection shown', 'non-runtime explanation', 'Escape returns focus', 'outside dismissal preserves forest pointer input', 'real snapshot smoke census'] };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await pg?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
