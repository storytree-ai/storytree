// The Surfaces menu (ADR-0750): the real desktop renderer bundle, its real settings and surfaces
// actions on a throwaway home, and a real snapshot restored into a throwaway Postgres. Never opens
// the live library or the owner's home. Run after `node apps/desktop/build.mjs`, under the heavy lock:
//   flock /tmp/storytree-heavy.lock node --import tsx packages/app/evidence/surfaces-menu/capture.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const desktopRequire = createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url));
const { pageReads, projectSelection, smokeProblems, surfacesActions } = await import(desktopRequire.resolve('@storytree/app'));
const { settingsActions } = await import(desktopRequire.resolve('@storytree/agent-link/settings'));
const { forestSurfaces } = await import(desktopRequire.resolve('@storytree/forest/surfaces'));
const { arcSurfaces } = await import(desktopRequire.resolve('@storytree/arc-surface/surfaces'));
const { connect } = await import(desktopRequire.resolve('@storytree/library'));
const { start } = await import(desktopRequire.resolve('@storytree/local-postgres'));
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');

const output = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(output, '../../../../apps/desktop/dist/renderer');
const snapshots = '/home/mickh/storytree-lanes/snapshots';
const snapshotPath = process.env.SURFACES_SNAPSHOT ?? path.join(snapshots, readdirSync(snapshots).filter((name) => name.endsWith('.json')).sort().at(-1));
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-surfaces-capture-'));
const STORY = process.env.SURFACES_STORY ?? 'story_f9fb5136c28f'; // The command line
const record = { snapshot: path.basename(snapshotPath), shots: [] };
let pg, store, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'surfaces capture' });
  store = await connect({ url: pg.url });
  await store.restore('storytree', JSON.parse(readFileSync(snapshotPath, 'utf8')));
  const reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: path.join(temporary, 'choice.json'), listProjects: () => store.listProjects() });
  await selection.choose('storytree');
  const surfaces = surfacesActions([...forestSurfaces, ...arcSurfaces], temporary);
  const bridge = { ...reads, ...settingsActions(temporary), ...surfaces, projectSelection: () => selection.read(), chooseProject: (name) => selection.choose(name) };
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'styles.css', 'app-setup.css', 'arc-surface.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.STORYTREE_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (error) => errors.push(String(error)));
  await page.exposeFunction('bridgeCall', (method, args) => { assert.ok(Object.hasOwn(bridge, method), method); return bridge[method](...args); });
  await page.addInitScript((methods) => {
    window.storytree = Object.fromEntries(methods.map((method) => [method, (...args) => window.bridgeCall(method, args)]));
    try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
  }, Object.keys(bridge));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  const ready = () => page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({ state: document.body.dataset.state, text: document.body.innerText.slice(0, 400) }));
    throw new Error(`the page did not get ready: ${JSON.stringify(state)}; page errors: ${JSON.stringify(errors)}`, { cause: error });
  });
  await ready();
  const tree = await reads.projectTree('storytree');
  const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const census = async () => smokeProblems('ready', tree, await page.getAttribute('body', 'data-drew'));
  const on = async () => page.evaluate(() => ({
    arcs: document.querySelector('.arc-surface-mount') !== null,
    sessions: document.querySelector('.sessions-list, [class*="sessions"]') !== null,
    forestViews: document.querySelector('.forest-views') !== null,
    panelTree: document.querySelector('.story-panel .panel-tree') !== null,
    panelDetail: document.querySelector('.story-panel .panel-detail') !== null,
  }));
  const shoot = async (shot, extra = {}) => {
    await frame(); await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(output, `${shot}.png`) });
    record.shots.push({ shot, census: await census(), mounted: await on(), ...extra });
    console.log('shot', shot);
  };
  const gear = page.getByRole('button', { name: 'App menu', exact: true });
  const openSurfaces = async () => {
    await gear.click();
    await page.locator('#app-menu').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('[data-surfaces] .surface').first().waitFor();
    await page.locator('#surfaces-title').scrollIntoViewIfNeeded();
  };
  const closeMenu = async () => { await page.locator('[data-app-close]').click(); };
  const saved = () => page.waitForFunction(() => document.querySelector('[data-surfaces-status]')?.textContent === 'Saved');

  await shoot('0-default-app');
  assert.deepEqual(await census(), [], 'the census holds with every surface on');

  await openSurfaces();
  await page.evaluate(() => { const content = document.querySelector('.app-menu-content'); content.scrollTop = document.querySelector('#surfaces-title').offsetTop - 24; });
  await shoot('1-menu-default');
  await page.evaluate(() => { const content = document.querySelector('.app-menu-content'); content.scrollTop = content.scrollHeight; });
  await shoot('2-menu-default-lower');

  // Sessions and Arcs off, the tree opening at full size: saved at once, and the page redraws.
  for (const id of ['sessions', 'arcs']) { await page.locator(`[data-switch="${id}"]`).click(); await saved(); }
  await page.locator('[data-setting="capability-tree opening-zoom"]').selectOption('full-size'); await saved();
  await page.evaluate(() => { const content = document.querySelector('.app-menu-content'); content.scrollTop = content.scrollHeight; });
  await shoot('3-menu-changed');
  const file = JSON.parse(readFileSync(path.join(temporary, 'settings.json'), 'utf8'));
  record.settingsFile = file;
  assert.deepEqual(file.surfaces, { sessions: { on: false }, arcs: { on: false }, 'capability-tree': { 'opening-zoom': 'full-size' } });
  await closeMenu(); await ready();
  await shoot('4-quiet-globe');
  const quiet = await on();
  assert.equal(quiet.arcs, false, 'Arcs off: no bar');
  assert.deepEqual(await census(), [], 'the forest census holds with Sessions and Arcs off');

  // Library and the capability tree off: a solid globe with no view buttons, and a panel of the story's words alone.
  await openSurfaces();
  for (const id of ['library', 'capability-tree']) { await page.locator(`[data-switch="${id}"]`).click(); await saved(); }
  await closeMenu(); await ready();
  assert.equal((await on()).forestViews, false, 'Library off: no Forest / Library buttons');
  for (let attempt = 0; attempt < 16; attempt++) {
    const label = await page.evaluate((story) => {
      const node = document.querySelector(`.forest-label[data-story-id="${story}"]`);
      if (node === null) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x: x + width / 2, y: y + height + 14, visible: width > 0 && Number(node.style.opacity || 1) > 0.5 };
    }, STORY);
    if (label?.visible) {
      for (const dy of [0, -20]) {
        await page.mouse.click(label.x, label.y + dy); await frame();
        if (await page.evaluate(() => document.body.dataset.selected) === STORY) break;
      }
      if (await page.evaluate(() => document.body.dataset.selected) === STORY) break;
    }
    const box = await page.evaluate(() => { const { x, y, width, height } = document.querySelector('.forest').getBoundingClientRect(); return { x, y, width, height }; });
    const cx = box.x + box.width * 0.4, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 140, cy, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(600);
  }
  assert.equal(await page.evaluate(() => document.body.dataset.selected), STORY, 'the story is selected');
  await page.mouse.move(4, 4);
  await shoot('5-library-and-tree-off');
  const panel = await on();
  assert.equal(panel.panelTree, false, 'Capability tree off: no tree in the panel');
  assert.equal(panel.panelDetail, false, 'and no capability details');
  assert.deepEqual(await census(), [], 'the forest census holds with Library and the tree off');
  record.pageErrors = errors;
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'capture.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log('capture: PASS');
} finally {
  await browser?.close();
  server?.close();
  await store?.close?.();
  await pg?.stop?.();
  rmSync(temporary, { recursive: true, force: true });
}
