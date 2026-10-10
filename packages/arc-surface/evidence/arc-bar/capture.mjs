// Arc surface contract 3.1: geometry and interaction on the real renderer and supplied snapshot.
// Its fake bridge and Chromium come from the capture kit (apps/desktop/src/capture).
// Run after build, under flock /tmp/storytree-heavy.lock. Never opens the live library.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from '@storytree/library';
// The frame is reached through the desktop app, which mounts this surface: arc-surface itself never depends on it (ADR-0847).
const { pageReads, projectSelection, smokeProblems } = await import(pathToFileURL(createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url)).resolve('@storytree/app')).href);
import { start } from '@storytree/local-postgres';
import { captureOutput, fakeBridge, launch } from '../../../../apps/desktop/src/capture/index.ts';
// The snapshot to restore is the first argument (or ARC_SNAPSHOT): no machine's folder is assumed.
const snapshotPath = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? process.env.ARC_SNAPSHOT;
if (!snapshotPath) throw new Error('usage: node capture.mjs <snapshot.json> (or set ARC_SNAPSHOT)');
const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-arc-bar-capture-'));
let pg, store, reads, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'arc bar capture' });
  store = await connect({ url: pg.url });
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  await store.restore('storytree', snapshot);
  reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: path.join(temporary, 'choice.json'), listProjects: () => store.listProjects() });
  await selection.choose('storytree');
  // The renderer's own reads (surfaces, setup, updates) are answered as idle by the capture kit; they are not under test.
  const bridge = fakeBridge({ ...reads, projectSelection: () => selection.read(), chooseProject: name => selection.choose(name), readSurfaces: async () => undefined });
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'styles.css', 'app-setup.css', 'arc-surface.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await bridge.install(page);
  await page.addInitScript(() => { try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await bridge.ready(page, 120000);
  // The app menu opens itself when the app's own reads are not carried here; it is not under test.
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  const gear = page.getByRole('button', { name: 'App menu', exact: true });
  const bar = page.getByRole('button', { name: 'Open arc surface', exact: true });
  const drawer = page.locator('#arc-drawer');
  // Two bars (top-bars): the app's bar, holding the gear, runs along the top; the arc bar spans the window directly below it.
  const appBarBox = await page.locator('.app-bar').boundingBox();
  const gearBox = await gear.boundingBox();
  const barBox = await bar.boundingBox();
  assert.deepEqual([appBarBox.x, appBarBox.y, appBarBox.width], [0, 0, 1440], 'the app bar runs along the top window edge');
  assert.ok(gearBox.y >= appBarBox.y && gearBox.y + gearBox.height <= appBarBox.y + appBarBox.height, 'the gear sits in the app bar');
  assert.equal(barBox.x, 0, '3.1 the bar starts at the left window edge');
  assert.equal(barBox.y, appBarBox.y + appBarBox.height, '3.1 the bar starts directly below the app bar');
  assert.equal(barBox.width, 1440, '3.1 the bar spans the window');
  assert.ok(barBox.height >= 36 && barBox.height <= 60, '3.1 a usable, quiet top strip');
  const controls = await page.locator('.forest-views').boundingBox();
  assert.ok(controls.y >= barBox.y + barBox.height, 'forest view controls remain below the bar');
  const tree = await reads.projectTree('storytree');
  const census = await page.getAttribute('body', 'data-drew');
  assert.deepEqual(smokeProblems('ready', tree, census), []);
  const library = await store.openProject('storytree');
  const history = await library.history();
  await page.locator('canvas').evaluate(canvas => {
    window.pointerCount = 0;
    canvas.addEventListener('pointerdown', () => window.pointerCount++);
  });
  await page.mouse.click(720, barBox.y + barBox.height + 24);
  assert.equal(await page.evaluate(() => window.pointerCount), 1, 'forest receives pointer input immediately below the closed bar');
  if (await page.locator('.panel-close').isVisible()) await page.locator('.panel-close').click();
  await page.screenshot({ path: path.join(output, 'bar-closed.png') });
  await bar.click({ position: { x: 20, y: barBox.height / 2 } });
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  const close = page.getByRole('button', { name: 'Close arc surface', exact: true });
  assert.equal(await close.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await close.boundingBox(), barBox, 'the same bar position closes the drawer');
  const drawerBox = await drawer.boundingBox();
  assert.equal(drawerBox.width, 1440);
  assert.ok(drawerBox.height <= 500 && drawerBox.y === barBox.y + barBox.height, 'half-height drawer opens below the top strip');
  await page.mouse.click(720, drawerBox.y + drawerBox.height + 24);
  assert.equal(await page.evaluate(() => window.pointerCount), 2, 'forest receives input below the open drawer');
  await gear.click();
  assert.equal(await page.locator('#app-menu').isVisible(), true, 'gear is reachable with the drawer open');
  await gear.click();
  if (await page.locator('.panel-close').isVisible()) await page.locator('.panel-close').evaluate(button => button.click());
  assert.ok(await page.locator('.arc-row').count() > 0, 'the board has rows: an empty board is not pictured');
  await page.screenshot({ path: path.join(output, 'bar-open.png') });
  await close.click({ position: { x: barBox.width - 20, y: barBox.height / 2 } });
  assert.equal(await drawer.isVisible(), false, 'clicking the bar again closes it');
  await bar.focus(); await page.keyboard.press('Enter');
  assert.equal(await drawer.isVisible(), true, 'keyboard opens the drawer');
  await page.keyboard.press('Escape');
  assert.equal(await drawer.isVisible(), false);
  assert.equal(await bar.evaluate(node => node === document.activeElement), true, 'Escape returns focus to the bar');
  await bar.click();
  await page.locator('[data-arc-scope="parked"]').click();
  await page.reload();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  assert.equal(await page.locator('[data-arc-scope="parked"]').getAttribute('aria-pressed'), 'true', 'open and scope persist');
  await page.getByRole('button', { name: 'Close arc surface', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.state === 'ready');
  assert.equal(await drawer.isVisible(), false, 'closed state persists');
  await page.setViewportSize({ width: 360, height: 640 });
  const narrowBar = await bar.boundingBox();
  const narrowGear = await gear.boundingBox();
  assert.deepEqual([narrowBar.x, narrowBar.width], [0, 360], 'narrow bar spans the window');
  assert.ok(narrowGear.x + narrowGear.width <= 360 && narrowGear.y + narrowGear.height <= narrowBar.y, 'narrow gear stays in the app bar above the arc bar');
  await bar.click();
  assert.equal(await drawer.isVisible(), true);
  await page.getByRole('button', { name: 'Close arc surface', exact: true }).click();
  assert.deepEqual(await library.history(), history, 'all bar and drawer interactions are read-only');
  await library.close();
  assert.deepEqual(errors, []);
  const result = { snapshot: snapshotPath, records: snapshot.records.length, viewport: { width: 1440, height: 960 }, appBarBox, barBox, gearBox, drawerBox, controls, narrowBar, narrowGear,
    stories: tree.stories.length, capabilities: tree.stories.reduce((sum, story) => sum + story.capabilities.length, 0), errors,
    passed: ['bar spans the window below the app bar', 'gear in the app bar', 'forest controls below strip', 'click toggle at both ends', 'keyboard and Escape focus', 'forest pointer input below closed bar and open drawer', 'gear reachable', 'open/scope and closed persistence', 'read-only UI', 'smoke census', 'narrow viewport'] };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await pg?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
