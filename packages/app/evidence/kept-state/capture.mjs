// The app shows its last known state at once while it refreshes (increment_12f64f90f42f): the real
// desktop renderer bundle, the app's real page reads over a throwaway Postgres, and a second launch
// modelled as a fresh page with the first one's storage whose library is slow, then failing, then
// back. Never opens the live library or the owner's home. Run after `node apps/desktop/build.mjs`:
//   STORYTREE_EMBEDDER=off node --import tsx packages/app/evidence/kept-state/capture.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require_ = createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url));
const desktopRequire = { resolve: (name) => pathToFileURL(require_.resolve(name)).href };
const { pageReads, projectSelection, surfacesActions } = await import(desktopRequire.resolve('@storytree/app'));
const { settingsActions, openActivityLog } = { ...await import(desktopRequire.resolve('@storytree/agent-link/settings')), ...await import(desktopRequire.resolve('@storytree/agent-link')) };
const { forestSurfaces } = await import(desktopRequire.resolve('@storytree/forest/surfaces'));
const { arcSurfaces } = await import(desktopRequire.resolve('@storytree/arc-surface/surfaces'));
const { connect } = await import(desktopRequire.resolve('@storytree/library'));
const { start } = await import(desktopRequire.resolve('@storytree/local-postgres'));
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');

const output = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(output, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-kept-capture-'));
const record = { shots: [] };
let pg, store, log, reads, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'kept state capture' });
  store = await connect({ url: pg.url });
  log = await openActivityLog(pg.url);
  const library = await store.openProject('site');
  for (const [title, parts] of [['Sign up', ['Enter an email', 'Confirm the email']], ['Pay', ['Choose a plan', 'Pay by card', 'Receipt']], ['Settings', ['Change the email']]]) {
    const story = await library.addStory({ title });
    for (const part of parts) await library.addCapability({ story: story.id, title: part });
  }
  const arc = await library.createArc({ title: 'Launch the site', intent: 'People can sign up and pay', endState: 'Launched' });
  const increment = await library.addIncrement({ arc: arc.id, title: 'Card payments', objective: 'Pay by card', body: 'Pay by card' });
  await log.append('site', { kind: 'session-started', source: 'hook', harness: 'claude-code', session: 's1' });
  await log.append('site', { kind: 'claimed', source: 'tool', harness: 'claude-code', session: 's1', increment: increment.id, reason: 'card payments' });

  reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: path.join(temporary, 'choice.json'), listProjects: () => store.listProjects() });
  await selection.choose('site');
  const bridge = { ...reads, ...settingsActions(temporary), ...surfacesActions([...forestSurfaces, ...arcSurfaces], temporary),
    projectSelection: () => selection.read(), chooseProject: (name) => selection.choose(name) };
  // How the library answers the page's first reads: at once, never (a slow network), or failing.
  let library_ = 'answers';
  const held = new Set(['changesSince', 'linesSince']);
  const call = (method, args) => {
    assert.ok(Object.hasOwn(bridge, method), method);
    if (held.has(method) && library_ === 'slow') return new Promise(() => {});
    if (held.has(method) && library_ === 'failing') return Promise.reject(new Error('timeout exceeded when trying to connect'));
    return bridge[method](...args);
  };
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'styles.css', 'app-setup.css', 'arc-surface.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ ...(process.env.STORYTREE_CHROMIUM ? { executablePath: process.env.STORYTREE_CHROMIUM } : {}), headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const errors = [];
  const open = async (storageState) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1, ...(storageState ? { storageState } : {}) });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.exposeFunction('bridgeCall', call);
    await page.addInitScript((methods) => {
      window.storytree = Object.fromEntries(methods.map((method) => [method, (...args) => window.bridgeCall(method, args)]));
      try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
    }, Object.keys(bridge));
    await page.goto(url);
    return page;
  };
  const reading = (page) => page.evaluate(() => ({
    state: document.body.dataset.state, fresh: document.body.dataset.fresh ?? null,
    freshness: document.getElementById('freshness')?.textContent ?? null,
    canvas: document.querySelectorAll('.forest canvas').length,
    islands: [...document.querySelectorAll('.forest-label')].map((node) => node.textContent.trim()).sort(),
    arcState: document.querySelector('#arc-drawer')?.dataset.arcState ?? null,
    arcStatus: document.querySelector('.arc-status')?.textContent ?? null,
    lanes: [...document.querySelectorAll('[data-arc-select]')].map((node) => node.dataset.arcSelect),
    sessionsFresh: document.querySelector('.sessions-list')?.dataset.fresh ?? null,
    sessions: [...document.querySelectorAll('.sessions-list [data-session-id]')].map((node) => node.dataset.sessionId),
  }));
  const shoot = async (page, shot) => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(output, `${shot}.png`) });
    const seen = await reading(page);
    record.shots.push({ shot, ...seen });
    console.log(shot, JSON.stringify(seen));
    return seen;
  };

  // First launch: nothing kept, so the page loads as before, then keeps what it drew.
  const first = await open();
  await first.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  await first.locator('[data-open-arcs]').click();
  await first.waitForSelector('.arc-overlay[data-arc-state=ready]');
  await first.waitForSelector('.sessions-list [data-session-id="s1"]');
  const fresh = await shoot(first, '0-first-launch-fresh');
  assert.equal(fresh.fresh, null);
  const kept = await first.context().storageState();
  await first.close();

  // Next launch over a slow library: the kept forest, board and sessions at once, each marked.
  library_ = 'slow';
  const slow = await open(kept);
  await slow.waitForSelector('#freshness');
  await slow.waitForSelector('.arc-overlay[data-arc-state=refreshing]');
  const stale = await shoot(slow, '1-next-launch-kept-state');
  assert.equal(stale.state, 'loading', 'the page is not ready until its first read lands');
  assert.equal(stale.fresh, 'no');
  assert.equal(stale.canvas, 1);
  assert.deepEqual(stale.lanes, [arc.id]);
  assert.equal(stale.sessionsFresh, 'no');
  assert.deepEqual(stale.sessions, ['s1']);
  assert.deepEqual(stale.islands, fresh.islands, 'the kept forest has the islands the last launch drew');
  assert.equal(stale.islands.length, 3);
  await slow.keyboard.press('Escape');
  await shoot(slow, '1b-next-launch-kept-forest');
  await slow.close();

  // A launch whose reads fail: the kept state stays on show with the error, and recovers by itself.
  library_ = 'failing';
  const failing = await open(kept);
  await failing.waitForFunction(() => /timeout exceeded/.test(document.getElementById('freshness')?.textContent ?? ''));
  await failing.waitForSelector('.arc-overlay[data-arc-state=error]');
  const failed = await shoot(failing, '2-refresh-failing-keeps-kept-state');
  assert.equal(failed.state, 'loading', 'no error screen in place of the kept forest');
  assert.equal(failed.canvas, 1);
  assert.deepEqual(failed.lanes, [arc.id]);
  library_ = 'answers';
  await failing.waitForFunction(() => document.body.dataset.state === 'ready' && document.body.dataset.fresh === undefined, undefined, { timeout: 30000 });
  await failing.waitForSelector('.arc-overlay[data-arc-state=ready]');
  const back = await shoot(failing, '3-library-back-fresh');
  assert.equal(back.freshness, null);
  assert.equal(back.sessionsFresh, null);
  assert.deepEqual(errors, []);
  record.browser = await browser.version();
  writeFileSync(path.join(output, 'capture.json'), `${JSON.stringify(record, null, 2)}\n`);
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await reads?.close(); await log?.close(); await store?.close(); await pg?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
