// App contracts 2.2–2.5: the real renderer over a throwaway database, with the durable setup yes.
// Browser regression found 2026-09-27: switching projects tore down Html twice and raised NotFoundError.
// Run from the repo root under the shared heavy lock; no running app or display is needed:
// STORYTREE_PLAYWRIGHT=/path/to/playwright-core/index.mjs STORYTREE_CHROMIUM=/path/to/chromium \
//   flock /tmp/storytree-heavy.lock node --import tsx packages/app/evidence/project-switch-smoke.mjs
// Uses an already-installed Playwright and browser; writes screenshots and smoke.json under
// STORYTREE_SMOKE_OUT (default: the system temp directory's app-own-projects-evidence).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? 'playwright-core');
import { start } from '@storytree/local-postgres';
import { connect } from '@storytree/library';
import { setUpProject } from '@storytree/agent-link';
import { pageReads, projectSelection } from '@storytree/app';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const out = process.env.STORYTREE_SMOKE_OUT ?? path.join(tmpdir(), 'app-own-projects-evidence');
mkdirSync(out, { recursive: true });
const build = spawnSync(process.execPath, ['apps/desktop/build.mjs'], { cwd: root, stdio: 'inherit' });
assert.equal(build.status, 0);
const home = mkdtempSync(path.join(tmpdir(), 'app-projects-smoke-'));
let pg, library, reads, browser, server;
try {
  pg = await start({ dataDir: path.join(home, 'pgdata'), owner: 'app projects smoke' });
  library = await connect({ url: pg.url });
  reads = pageReads({ storytree: library, serverUrl: pg.url });
  const preferences = { file: path.join(home, 'project-choice.json'), listProjects: () => library.listProjects() };
  let selection = projectSelection(preferences);
  await selection.read();
  server = createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(root, 'apps/desktop/dist/renderer', name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    ...(process.env.STORYTREE_CHROMIUM ? { executablePath: process.env.STORYTREE_CHROMIUM } : {}),
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(60000);
  const errors = [];
  const calls = {};
  let failChoice = true;
  await context.exposeBinding('bridge', async (_source, method, args) => {
    calls[method] = (calls[method] ?? 0) + 1;
    if (method === 'projectSelection') return selection.read();
    if (method === 'chooseProject') {
      if (failChoice) { failChoice = false; throw new Error('temporary choice failure'); }
      return selection.choose(...args);
    }
    return reads[method](...args);
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
    window.storytree = Object.fromEntries(['projectSelection', 'chooseProject', 'listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'waitHolds', 'heldOnQuestion'].map(name => [name, (...args) => window.bridge(name, args)]));
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.stack ?? String(error))));
  let page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const chooseProject = async name => {
    if (!(await page.locator('#app-menu').isVisible())) await page.getByRole('button', { name: 'App menu', exact: true }).click();
    await page.selectOption('#project', name);
  };
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.state === 'empty');
  const emptyText = await page.locator('#content').innerText();
  assert.match(emptyText, /Claude Code or Codex/);
  assert.match(emptyText, /say yes/);
  await page.screenshot({ path: path.join(out, 'empty.png') });
  const folder = path.join(home, 'site');
  mkdirSync(folder);
  const before = Date.now();
  await setUpProject({ folder, project: 'my-site', storytree: library, storytreeHome: home });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'my-site', undefined, { timeout: 30000 });
  const firstProjectMs = Date.now() - before;
  assert.equal(await page.locator('#project').inputValue(), 'my-site');
  const plan = await library.openProject('my-site');
  const story = await plan.addStory({ title: 'My site' });
  await plan.addCapability({ story: story.id, title: 'Home page' });
  await plan.close();
  await page.waitForFunction(() => JSON.parse(document.body.dataset.drew ?? '{}').stories?.length === 1);
  await page.screenshot({ path: path.join(out, 'first-project.png') });
  await page.evaluate(() => { window.originalCanvas = document.querySelector('canvas'); });
  const initialPolls = calls.projectSelection;
  await page.waitForFunction(() => document.body.dataset.state === 'ready');
  await new Promise(resolve => setTimeout(resolve, 3300));
  assert.ok(calls.projectSelection > initialPolls);
  assert.equal(await page.evaluate(() => window.originalCanvas === document.querySelector('canvas')), true);
  const second = path.join(home, 'other');
  mkdirSync(second);
  await setUpProject({ folder: second, project: 'other-site', storytree: library, storytreeHome: home });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'other-site', undefined, { timeout: 30000 });
  await chooseProject('my-site');
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.querySelector('#project').value === 'other-site');
  await chooseProject('my-site');
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'my-site');
  await page.close();
  selection = projectSelection(preferences);
  page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'my-site');
  await page.screenshot({ path: path.join(out, 'remembered-choice.png') });
  const setup = async (project) => {
    const folder = path.join(home, project);
    mkdirSync(folder);
    await setUpProject({ folder, project, storytree: library, storytreeHome: home });
  };
  await setup('a-new-site');
  await setup('z-new-site');
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'z-new-site');
  assert.equal(await page.locator('#project option').count(), 4);
  await page.screenshot({ path: path.join(out, 'last-setup-choice.png') });
  await chooseProject('my-site');
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'my-site');
  await page.close();
  await setup('b-closed-site');
  await setup('y-closed-site');
  page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'y-closed-site');
  await page.screenshot({ path: path.join(out, 'closed-window-choice.png') });
  await page.close();
  selection = projectSelection(preferences);
  await selection.read('other-site');
  page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.project === 'other-site');
  assert.deepEqual(errors, []);
  const result = { firstProjectMs, emptyText, calls, errors, passed: ['first project without restart', 'new setup choice', 'unchanged polling preserves canvas', 'picker choice persisted across page and selection-service restart', 'last back-to-back setup wins', 'newer picker wins over setup', 'last setup while the window is closed wins on reopening', 'explicit project wins over setup at launch'] };
  writeFileSync(path.join(out, 'smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close();
  await library?.close();
  await pg?.stop();
  rmSync(home, { recursive: true, force: true });
}
