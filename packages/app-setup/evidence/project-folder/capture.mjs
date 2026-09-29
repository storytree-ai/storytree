// Add project (ADR-0752 D2, increment_14f177725450): the real desktop renderer, the app setup's real
// add-project action on a throwaway local Postgres, and a scripted folder in place of the native picker.
// Borrowed from packages/app/evidence/gear/capture.mjs. Run after `node apps/desktop/build.mjs`, under
// flock /tmp/storytree-heavy.lock. Never opens the live library.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// The frame's packages, resolved as the desktop resolves them (app-setup itself depends on none of them).
const desktop = createRequire(fileURLToPath(new URL('../../../../apps/desktop/package.json', import.meta.url)));
const load = name => import(pathToFileURL(desktop.resolve(name)).href);
const { connect } = await load('@storytree/library');
const { pageReads, projectSelection, surfacesActions } = await load('@storytree/app');
const { arcSurfaces } = await load('@storytree/arc-surface/surfaces');
const { forestSurfaces } = await load('@storytree/forest/surfaces');
const { setupHelpActions } = await load('@storytree/app-setup');
const { start } = await load('@storytree/local-postgres');

const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(output, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-add-project-capture-'));
let pg, store, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'add project capture' });
  store = await connect({ url: pg.url });
  const first = await store.openProject('first-site'); await first.close();
  const home = path.join(temporary, 'home');
  const choice = path.join(home, 'project-choice.json');
  mkdirSync(home); writeFileSync(choice, JSON.stringify({ current: 'first-site' }));
  const reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: choice, listProjects: () => store.listProjects() });
  const picked = path.join(temporary, 'My Second Site');
  mkdirSync(picked);
  const help = setupHelpActions({ licenseFile: '', storytreeHome: home, chooseFolder: async () => picked, openExternal: async () => {}, copyText: async () => {}, library: () => store });
  const surfaces = surfacesActions([...forestSurfaces, ...arcSurfaces], home);
  const bridge = { ...reads, readSurfaces: () => surfaces.readSurfaces(), projectSelection: () => selection.read(), chooseProject: name => selection.choose(name), addProject: () => help.addProject() };
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
  await page.exposeFunction('captureRead', (method, args) => { assert.ok(Object.hasOwn(bridge, method), method); return bridge[method](...args); });
  await page.addInitScript(methods => {
    window.storytree = Object.fromEntries(methods.map(method => [method, (...args) => window.captureRead(method, args)]));
    try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
  }, Object.keys(bridge));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  assert.equal(await page.getAttribute('body', 'data-project'), 'first-site');
  const gear = page.getByRole('button', { name: 'App menu', exact: true });
  await gear.click();
  const add = page.getByRole('button', { name: 'Add project…', exact: true });
  assert.equal(await add.isVisible(), true, 'Add project is in the Projects section');
  const menu = page.locator('#app-menu');
  await menu.screenshot({ path: path.join(output, 'projects-add-button.png') });
  await add.click();
  await page.waitForFunction(() => document.body.dataset.project === 'my-second-site', undefined, { timeout: 60000 });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  assert.equal(await menu.isVisible(), false, 'the menu closes on the new project');
  assert.deepEqual(JSON.parse(readFileSync(path.join(picked, '.storytree.json'), 'utf8')), { project: 'my-second-site' });
  await gear.click();
  const options = await page.locator('#project option').allTextContents();
  assert.deepEqual(options, ['first-site', 'my-second-site'], 'both projects are selectable');
  assert.equal(await page.locator('#project').inputValue(), 'my-second-site');
  await menu.screenshot({ path: path.join(output, 'projects-after-add.png') });
  // A folder already a project is simply selected.
  await page.locator('#project').selectOption('first-site');
  await page.waitForFunction(() => document.body.dataset.project === 'first-site', undefined, { timeout: 60000 });
  await gear.click(); await add.click();
  await page.waitForFunction(() => document.body.dataset.project === 'my-second-site', undefined, { timeout: 60000 });
  assert.deepEqual((await store.listProjects()).sort(), ['first-site', 'my-second-site'], 'adding it again created nothing');
  await gear.click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.locator('#app-menu h3', { hasText: 'Add a project' }).scrollIntoViewIfNeeded();
  await menu.screenshot({ path: path.join(output, 'help-add-a-project.png') });
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify({ at: new Date().toISOString(), projects: await store.listProjects(), picked: path.basename(picked), shown: 'my-second-site', errors }, null, 2) + '\n');
  console.log('add project capture PASS');
} finally {
  await browser?.close(); server?.close(); await store?.close(); await pg?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
