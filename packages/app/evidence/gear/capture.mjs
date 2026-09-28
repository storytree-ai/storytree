// Gear contracts: real desktop renderer and app reads, isolated snapshot and explicit switch fixture.
// Reuses packages/app/evidence/project-switch-smoke.mjs's headless renderer route.
// Run after build, under flock /tmp/storytree-heavy.lock. Never opens the live library.
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
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-gear-capture-'));
let pg, store, reads, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'gear capture' });
  store = await connect({ url: pg.url });
  const snapshotPath = process.env.GEAR_SNAPSHOT ?? '/home/mickh/storytree-lanes/snapshots/2026-09-28T07-26-00-491Z.json';
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  await store.restore('storytree', snapshot);
  reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: path.join(temporary, 'choice.json'), listProjects: () => store.listProjects() });
  await selection.choose('storytree');
  let failChoice = false;
  const bridge = { ...reads, projectSelection: () => selection.read(), chooseProject: async name => {
    if (failChoice) { failChoice = false; throw new Error('temporary project choice failure'); }
    return selection.choose(name);
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
  await page.exposeFunction('gearRead', (method, args) => { assert.ok(Object.hasOwn(bridge, method)); return bridge[method](...args); });
  await page.addInitScript(methods => {
    window.storytree = Object.fromEntries(methods.map(method => [method, (...args) => window.gearRead(method, args)]));
    try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
  }, Object.keys(bridge));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  assert.equal(await page.locator('.app-bar').count(), 0, 'the page draws no app bar');
  const gear = page.getByRole('button', { name: 'App menu', exact: true });
  const menu = page.locator('#app-menu');
  const gearBox = await gear.boundingBox();
  assert.ok(gearBox.y <= 16 && gearBox.x + gearBox.width >= 1424 && gearBox.width <= 40 && gearBox.height <= 40, 'one small gear in the top-right corner');
  assert.equal((await page.locator('.forest').boundingBox()).y, 0, 'forest reaches the top edge');
  assert.equal(await menu.isVisible(), false);
  const tree = await reads.projectTree('storytree');
  const census = await page.getAttribute('body', 'data-drew');
  assert.deepEqual(smokeProblems('ready', tree, census), [], 'existing data-state/data-drew smoke readings remain valid');
  await page.screenshot({ path: path.join(output, 'menu-closed.png') });
  await gear.click();
  assert.equal(await menu.isVisible(), true);
  assert.equal(await gear.getAttribute('aria-expanded'), 'true');
  const menuBox = await menu.boundingBox();
  assert.ok(menuBox.width <= 288 && menuBox.x + menuBox.width <= 1440 && menuBox.y >= gearBox.y + gearBox.height, 'compact menu below gear');
  await page.screenshot({ path: path.join(output, 'menu-open.png') });
  await page.locator('#project').click();
  await page.screenshot({ path: path.join(output, 'project-switcher-open.png') });
  await page.keyboard.press('Escape'); // dismiss select, preserving the app menu
  assert.equal(await menu.isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await menu.isVisible(), false);
  assert.equal(await gear.evaluate(node => node === document.activeElement), true, 'Escape returns focus to gear');
  await gear.click(); await gear.click();
  assert.equal(await menu.isVisible(), false, 'clicking gear again closes it');
  // Close the independent arc drawer so the newly freed top strip is observable too.
  const closeArcs = page.getByRole('button', { name: 'Close arc surface', exact: true });
  if (await closeArcs.count()) await closeArcs.click();
  await page.locator('canvas').evaluate(canvas => {
    window.pointerCount = 0;
    canvas.addEventListener('pointerdown', () => window.pointerCount++);
  });
  await gear.click();
  await page.mouse.click(400, 16);
  assert.equal(await menu.isVisible(), false, 'outside click closes menu');
  assert.equal(await page.evaluate(() => window.pointerCount), 1, 'the same outside click reaches the forest in the freed top strip');
  await gear.click(); await page.mouse.click(720, 800);
  assert.equal(await page.evaluate(() => window.pointerCount), 2, 'forest receives input below open menu');
  await gear.click();
  await menu.getByRole('button', { name: 'Help', exact: true }).click();
  assert.equal(await page.locator('#setup-help-panel').isVisible(), true, 'help opens from menu');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#setup-help-panel').isVisible(), false);
  assert.equal(await gear.evaluate(node => node === document.activeElement), true, 'help returns focus to gear');
  // Explicit fixture for switching; all three captures above contain only the supplied snapshot.
  await (await store.openProject('gear-switch-check')).close();
  await page.waitForFunction(() => document.querySelectorAll('#project option').length === 2, undefined, { timeout: 15000 });
  await page.evaluate(() => { window.previousCanvas = document.querySelector('canvas'); });
  await gear.click(); await page.selectOption('#project', 'gear-switch-check');
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'gear-switch-check');
  assert.equal(await page.evaluate(() => window.previousCanvas === document.querySelector('canvas')), false, 'selection switches the forest');
  assert.equal(await menu.isVisible(), false);
  failChoice = true;
  await gear.click(); await page.selectOption('#project', 'storytree');
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.querySelector('#project').value === 'gear-switch-check');
  await page.selectOption('#project', 'storytree');
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'storytree');
  assert.deepEqual(smokeProblems('ready', tree, await page.getAttribute('body', 'data-drew')), []);
  await page.setViewportSize({ width: 360, height: 640 });
  await gear.click();
  const narrowBox = await menu.boundingBox();
  assert.ok(narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 360, 'menu fits a narrow window');
  assert.deepEqual(errors, []);
  const result = { snapshot: snapshotPath, records: snapshot.records.length, viewport: { width: 1440, height: 960 }, gearBox, menuBox, narrowBox, stories: tree.stories.length, capabilities: tree.stories.reduce((sum, story) => sum + story.capabilities.length, 0), errors,
    passed: ['no app bar', 'gear geometry', 'click toggle', 'Escape and focus', 'outside dismissal preserves forest pointer input', 'project switch changes forest', 'failed choice recovers and retries', 'help opens and returns focus', 'smoke census', 'narrow viewport'] };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await pg?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
