// Top bars contracts: real desktop renderer and app reads, isolated snapshot and explicit switch fixture.
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
import { settingsActions } from '@storytree/agent-link/settings';
import { start } from '@storytree/local-postgres';

const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(output, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-top-bars-'));
let pg, store, reads, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'top bars capture' });
  store = await connect({ url: pg.url });
  const snapshotPath = process.env.GEAR_SNAPSHOT ?? '/home/mickh/storytree-lanes/snapshots/2026-09-28T09-15-09-235Z.json';
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  await store.restore('storytree', snapshot);
  reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: path.join(temporary, 'choice.json'), listProjects: () => store.listProjects() });
  await selection.choose('storytree');
  let failChoice = false;
  const bridge = { ...reads, ...settingsActions(temporary),
    checkForUpdates: async () => ({ phase: 'unavailable', runningBuild: 'capture' }),
    readSetupLicense: async () => readFileSync(path.resolve(output, '../../../../LICENSE'), 'utf8'), projectSelection: () => selection.read(), chooseProject: async name => {
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
  const capture = async name => { if (!process.env.TOP_BARS_NO_IMAGES) await page.screenshot({ path: path.join(output, name) }); };
  await page.exposeFunction('gearRead', (method, args) => { assert.ok(Object.hasOwn(bridge, method)); return bridge[method](...args); });
  await page.addInitScript(methods => {
    window.storytree = Object.fromEntries(methods.map(method => [method, (...args) => window.gearRead(method, args)]));
    try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
  }, Object.keys(bridge));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  const gear = page.getByRole('button', { name: 'App menu', exact: true });
  const menu = page.locator('#app-menu');
  const panel = page.locator('.app-menu-window');
  const closeArcs = page.getByRole('button', { name: 'Close arc surface', exact: true });
  if (await closeArcs.isVisible()) await closeArcs.click();
  assert.equal(await page.locator('.app-bar').count(), 1, 'one full-width app bar');
  assert.equal(await page.locator('.app-bar button').count(), 1, 'only the gear on the app bar');
  assert.equal(await page.locator('.app-bar').innerText(), '');
  const appBox = await page.locator('.app-bar').boundingBox();
  const arcBox = await page.locator('.arc-handle:visible').boundingBox();
  const gearBox = await gear.boundingBox();
  assert.deepEqual(appBox, { x: 0, y: 0, width: 1440, height: 48 });
  assert.deepEqual(arcBox, { x: 0, y: 48, width: 1440, height: 48 });
  assert.ok(gearBox.x >= 1380 && gearBox.y >= 0 && gearBox.y + gearBox.height <= 48);
  assert.doesNotMatch(await page.locator('.arc-handle:visible').innerText(), /storytree/);
  assert.equal((await page.locator('.forest').boundingBox()).y, 96, 'forest starts below both bars');
  assert.equal(await menu.isVisible(), false);
  const tree = await reads.projectTree('storytree');
  const census = await page.getAttribute('body', 'data-drew');
  assert.deepEqual(smokeProblems('ready', tree, census), []);
  await capture('bars-closed.png');
  await page.locator('[data-open-arcs]').click();
  await page.waitForFunction(() => document.querySelector('#arc-drawer').dataset.arcState === 'ready');
  assert.equal((await page.locator('#arc-drawer').boundingBox()).y, 96);
  assert.deepEqual(await page.locator('.arc-handle:visible').boundingBox(), arcBox);
  await capture('arcs-open.png');
  await page.locator('canvas').evaluate(canvas => { window.drawerPointers = 0; canvas.addEventListener('pointerdown', () => window.drawerPointers++); });
  await page.mouse.click(720, 800);
  assert.equal(await page.evaluate(() => window.drawerPointers), 1, 'forest input below the open drawer');
  await gear.click();
  assert.equal(await menu.isVisible(), true);
  assert.equal(await gear.getAttribute('aria-expanded'), 'true');
  const menuBox = await panel.boundingBox();
  assert.ok(menuBox.width >= 1300 && menuBox.height >= 800, 'full-size overlay');
  assert.equal(menuBox.x, (1440 - menuBox.width) / 2, 'horizontally centred');
  assert.equal(menuBox.y - 48, (960 - 48 - menuBox.height) / 2, 'centred below always-visible app bar');
  assert.equal(await page.locator('#content').getAttribute('inert'), '', 'background does not receive overlay input');
  await page.keyboard.press('Escape');
  assert.equal(await menu.isVisible(), false);
  assert.equal(await closeArcs.isVisible(), true, 'overlay Escape leaves drawer open');
  assert.equal(await gear.evaluate(node => node === document.activeElement), true);
  await closeArcs.click();
  await gear.click(); await gear.click();
  assert.equal(await menu.isVisible(), false, 'gear toggles closed');
  await gear.click(); await page.getByRole('button', { name: 'Close app menu' }).click();
  assert.equal(await menu.isVisible(), false, 'close button dismisses overlay');
  await page.locator('canvas').evaluate(canvas => {
    window.pointerCount = 0;
    canvas.addEventListener('pointerdown', () => window.pointerCount++);
  });
  await gear.click(); await page.mouse.click(4, 400);
  assert.equal(await menu.isVisible(), false, 'backdrop dismisses overlay');
  assert.equal(await page.evaluate(() => window.pointerCount), 0, 'backdrop click is not a forest gesture');
  await page.mouse.click(400, 200);
  assert.equal(await page.evaluate(() => window.pointerCount), 1, 'forest below bars receives input after dismissal');
  await gear.click();
  for (const section of ['projects', 'settings', 'updates', 'help']) {
    await page.locator(`[data-app-section="${section}"]`).click();
    assert.equal(await page.locator(`#app-${section}`).isVisible(), true);
    assert.equal(await page.locator('.app-menu-content > section:visible').count(), 1);
    if (section === 'settings') {
      await page.waitForSelector('#settings-panel [data-setting="context-guidance"]');
      assert.equal(await page.locator('#app-menu #settings-panel').count(), 1, 'settings mounted inside overlay');
      const row = page.locator('[data-setting="context-guidance"]');
      await row.locator('input').fill('710000');
      await row.getByRole('button', { name: 'Save' }).click();
      await page.waitForFunction(() => document.querySelector('[data-setting="context-guidance"] .settings-saved').textContent === 'Saved');
      assert.equal((await bridge.readSettings()).value['context-guidance'].value, 710000);
    }
    if (section === 'updates') {
      await page.locator('[data-app-updates]').click();
      await page.waitForFunction(() => document.querySelector('#app-update-status').dataset.phase === 'unavailable');
    }
    if (section === 'help') {
      assert.equal(await page.locator('#app-menu #setup-help-panel').count(), 1, 'help mounted inside overlay');
      await page.getByRole('button', { name: 'License', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-license]').textContent.length > 100);
      await page.getByRole('button', { name: 'First-run guide' }).click();
    }
    await capture(`overlay-${section}.png`);
  }
  // Focus never escapes to the inert forest, including reverse traversal from the gear.
  await gear.focus(); await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#app-menu').evaluate(node => node.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await gear.click(); await page.locator('[data-app-section="projects"]').click();
  await page.locator('#project').click(); await page.keyboard.press('Escape');
  assert.equal(await menu.isVisible(), true, 'native picker Escape leaves overlay open');
  await page.keyboard.press('Escape');
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
  assert.equal(await page.locator('#app-projects [role=alert]').isVisible(), true, 'failed selection explains its reason inside the overlay');
  assert.match(await page.locator('#app-projects [role=alert]').innerText(), /temporary project choice failure/);
  await page.selectOption('#project', 'storytree');
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'storytree');
  assert.deepEqual(smokeProblems('ready', tree, await page.getAttribute('body', 'data-drew')), []);
  await page.setViewportSize({ width: 360, height: 640 });
  await gear.click();
  await page.locator('[data-app-section="settings"]').click();
  const narrowBox = await panel.boundingBox();
  assert.ok(narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 360);
  assert.ok(narrowBox.y >= 48 && narrowBox.y + narrowBox.height <= 640);
  assert.equal(await panel.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'no horizontal overflow');
  await capture('narrow-settings.png');
  // Explicit empty-project fixture after all real-data captures: first-run Help belongs
  // inside the overlay even before a forest or arc bar exists.
  const firstRun = await browser.newPage({ viewport: { width: 360, height: 640 }, colorScheme: 'dark' });
  firstRun.on('pageerror', error => errors.push(String(error)));
  await firstRun.exposeFunction('firstRunRead', (method, args) => method === 'projectSelection' ? { projects: [] } : bridge[method](...args));
  await firstRun.addInitScript(methods => {
    window.storytree = Object.fromEntries(methods.map(method => [method, (...args) => window.firstRunRead(method, args)]));
  }, Object.keys(bridge));
  await firstRun.goto(`http://127.0.0.1:${server.address().port}/`);
  await firstRun.waitForFunction(() => document.body.dataset.state === 'empty');
  assert.equal(await firstRun.locator('#app-menu').isVisible(), true, 'first-run Help is offered without a project');
  assert.equal(await firstRun.locator('#app-menu #setup-help-panel').isVisible(), true);
  await firstRun.getByRole('button', { name: 'Close app menu' }).click();
  assert.ok((await firstRun.locator('main').boundingBox()).y >= 48, 'empty page clears the app bar');
  await firstRun.getByRole('button', { name: 'App menu', exact: true }).click();
  assert.equal(await firstRun.locator('#setup-help-panel').isVisible(), true, 'Help can be reopened');
  await firstRun.close();
  assert.deepEqual(errors, []);
  const result = { snapshot: snapshotPath, records: snapshot.records.length, viewport: { width: 1440, height: 960 }, appBox, arcBox, gearBox, menuBox, narrowBox, stories: tree.stories.length, capabilities: tree.stories.reduce((sum, story) => sum + story.capabilities.length, 0), errors,
    passed: ['bar order and heights', 'gear only on app bar', 'arc bar omits project', 'drawer below bars', 'centred full-size overlay', 'four dismissal routes', 'focus restoration and containment', 'forest input below bars', 'every section mounted', 'settings save via existing bridge', 'Help license', 'updates action', 'project switch and recovery', 'smoke census', 'narrow fit', 'first-run Help without a project'] };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await pg?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
