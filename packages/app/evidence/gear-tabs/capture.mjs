// The gear menu's tabs (Sessions, Library and Surfaces replace the Settings catch-all): the real
// desktop renderer bundle, its real settings and surfaces actions on a throwaway home, and a real
// snapshot restored into a throwaway Postgres. Never opens the live library or the owner's home.
// Run after `node apps/desktop/build.mjs`, under the heavy lock:
//   flock /tmp/storytree-heavy.lock node --import tsx packages/app/evidence/gear-tabs/capture.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-gear-tabs-capture-'));
const record = { snapshot: path.basename(snapshotPath), shots: [] };
let pg, store, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'gear tabs capture' });
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
  const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const tabs = () => page.locator('#app-menu [data-app-section]').allTextContents();
  const shoot = async (shot, extra = {}) => {
    await frame(); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, `${shot}.png`) });
    record.shots.push({ shot, tabs: await tabs(), ...extra });
    console.log('shot', shot);
  };
  const rows = () => page.locator('#app-menu .app-menu-content > section:not([hidden]) [data-setting]').evaluateAll((forms) => forms.map((form) => form.dataset.setting));
  const tab = async (name) => {
    await page.locator('#app-menu').getByRole('button', { name, exact: true }).click();
    await page.locator(`#app-menu .app-menu-content > section:not([hidden]) :is([data-setting], .surface)`).first().waitFor();
  };

  await page.getByRole('button', { name: 'App menu', exact: true }).click();
  assert.deepEqual(await tabs(), ['Projects', 'Sessions', 'Library', 'Surfaces', 'Updates', 'Help']);
  assert.equal(await page.locator('#app-menu h1').count(), 0, 'no App title: the tab on show is the heading');
  assert.equal(await page.getByRole('dialog', { name: 'App menu' }).count(), 1, 'the dialog keeps its accessible name');
  assert.equal(await page.locator('#app-menu nav').getByRole('button', { name: 'Close app menu' }).count(), 1, 'Close ends the tab row, with no strip of its own');

  await tab('Sessions');
  assert.deepEqual(await rows(), ['context-guidance', 'idle-after', 'leave-after']);
  await shoot('1-sessions', { rows: await rows() });

  await tab('Library');
  assert.deepEqual(await rows(), ['library']);
  assert.equal(await page.locator('[data-setting="library"] label').first().textContent(), 'Where the library lives');
  await shoot('2-library', { rows: await rows() });
  await page.locator('[data-setting="library"] select').selectOption('cloudsql');
  await page.locator('[data-setting="library"] .settings-cloud').waitFor();
  await shoot('3-library-cloud-sql-fields', { note: 'Google Cloud SQL chosen, not saved: its connection fields show' });

  await tab('Surfaces');
  const switches = await page.locator('#app-menu [data-switch]').evaluateAll((inputs) => inputs.map((input) => input.dataset.switch));
  assert.ok(switches.includes('sessions') && switches.includes('library'), 'the Sessions and Library switches stay under Surfaces');
  await shoot('4-surfaces', { switches });

  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app-menu').evaluate((menu) => menu.matches(':popover-open')), false, 'Escape still closes the menu');
  assert.equal(existsSync(path.join(temporary, 'settings.json')), false, 'looking through the tabs saves nothing');
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
