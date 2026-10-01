// Who decides what (agent link 7.6, ADR-0842 D4), in the gear menu's Sessions tab: the real desktop
// renderer bundle, its real settings action on a throwaway home, and the real page reads over a
// snapshot restored into a throwaway Postgres. The project's register is the live "Standing
// delegation" definition's text, copied read-only into register.txt and defined in the throwaway
// library. Never opens the live library or the owner's home.
// Run after `node apps/desktop/build.mjs`, under the heavy lock:
//   flock /tmp/storytree-heavy.lock node --import tsx packages/agent-link/evidence/decision-rights/capture.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const desktopRequire = createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url));
const { pageReads, projectSelection, surfacesActions } = await import(desktopRequire.resolve('@storytree/app'));
const { settingsActions } = await import(desktopRequire.resolve('@storytree/agent-link/settings'));
const { decisionRights } = await import(desktopRequire.resolve('@storytree/agent-link'));
const { forestSurfaces } = await import(desktopRequire.resolve('@storytree/forest/surfaces'));
const { arcSurfaces } = await import(desktopRequire.resolve('@storytree/arc-surface/surfaces'));
const { connect } = await import(desktopRequire.resolve('@storytree/library'));
const { start } = await import(desktopRequire.resolve('@storytree/local-postgres'));
const { launch } = await import('../../../../apps/desktop/src/capture/index.ts');

const output = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(output, '../../../../apps/desktop/dist/renderer');
const snapshots = '/home/mickh/storytree-lanes/snapshots';
const snapshotPath = process.env.SURFACES_SNAPSHOT ?? path.join(snapshots, readdirSync(snapshots).filter((name) => name.endsWith('.json')).sort().at(-1));
const register = readFileSync(path.join(output, 'register.txt'), 'utf8').trim();
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-decision-rights-capture-'));
const record = { snapshot: path.basename(snapshotPath), shots: [] };
let pg, store, server, browser, reads;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'decision rights capture' });
  store = await connect({ url: pg.url });
  await store.restore('storytree', JSON.parse(readFileSync(snapshotPath, 'utf8')));
  await (await store.openProject('storytree')).defineTerm({ term: 'Standing delegation', meaning: register });
  await (await store.openProject('bare')).addStory({ title: 'A project with no register' });
  reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: path.join(temporary, 'choice.json'), listProjects: () => store.listProjects() });
  await selection.choose('storytree');
  const surfaces = surfacesActions([...forestSurfaces, ...arcSurfaces], temporary);
  const bridge = { ...reads, ...settingsActions(temporary), ...surfaces, projectSelection: () => selection.read(), chooseProject: (name) => selection.choose(name),
    // The renderer's own reads that are not under test here answer as idle.
    readSignIn: async () => ({ available: false, on: false }), setSignIn: async () => ({ available: false, on: false }),
    checkForUpdates: async () => ({ phase: 'unavailable', runningBuild: 'capture', reason: 'not under test' }),
    agentConnections: async () => [], codeSurvey: async () => ({}) };
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'styles.css', 'app-setup.css', 'arc-surface.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (error) => errors.push(String(error)));
  await page.exposeFunction('bridgeCall', (method, args) => { assert.ok(Object.hasOwn(bridge, method), method); return bridge[method](...args); });
  await page.addInitScript((methods) => {
    window.storytree = Object.fromEntries(methods.map((method) => [method, (...args) => window.bridgeCall(method, args)]));
    try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
  }, Object.keys(bridge));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({ state: document.body.dataset.state, text: document.body.innerText.slice(0, 400) }));
    throw new Error(`the page did not get ready: ${JSON.stringify(state)}; page errors: ${JSON.stringify(errors)}`, { cause: error });
  });
  const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const view = page.locator('#app-sessions .decision-rights');
  const shoot = async (shot, extra = {}) => {
    await frame(); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, `${shot}.png`) });
    record.shots.push({ shot, ...extra });
    console.log('shot', shot);
  };
  const sessionsTab = async () => {
    await page.getByRole('button', { name: 'App menu', exact: true }).click();
    await page.locator('#app-menu').getByRole('button', { name: 'Sessions', exact: true }).click();
    await page.locator('#app-sessions [data-setting]').first().waitFor();
  };

  await sessionsTab();
  await page.locator('#app-sessions [data-delegations]').waitFor();
  const split = decisionRights();
  const shown = await view.innerText();
  for (const line of [...split.decides, ...split.asks, ...split.honesty]) assert.ok(shown.toLowerCase().includes(line.toLowerCase()), `shows "${line}"`);
  assert.ok(shown.includes(split.override), 'says the instructions file overrides it');
  assert.equal(await page.locator('#app-sessions [data-app-decision-rights] :is(input, select, textarea, button, form, [contenteditable])').count(), 0, 'nothing on it is editable');
  await shoot('1-sessions-tab', { note: 'the Sessions tab opened: its settings, with who decides what below them' });
  await view.locator('h3').scrollIntoViewIfNeeded();
  await page.locator('#app-sessions .decision-rights h3').evaluate((heading) => heading.scrollIntoView({ block: 'start' }));
  await shoot('2-who-decides-what', { note: 'scrolled to the split' });
  await page.locator('#app-sessions [data-delegations]').evaluate((register) => register.scrollIntoView({ block: 'start' }));
  await shoot('3-standing-delegations', { note: "storytree's own register, from its library" });
  await page.keyboard.press('Escape');

  await selection.choose('bare');
  await page.reload();
  await page.waitForFunction(() => ['ready', 'empty'].includes(document.body.dataset.state), undefined, { timeout: 120000 });
  await sessionsTab();
  await page.locator('#app-sessions .decision-rights').waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#app-sessions [data-delegations]').count(), 0, 'a project without the register shows none');
  await page.locator('#app-sessions .decision-rights h3').evaluate((heading) => heading.scrollIntoView({ block: 'start' }));
  await shoot('4-project-without-register', { note: 'a project whose library has no "Standing delegation": the split alone' });

  assert.equal(existsSync(path.join(temporary, 'settings.json')), false, 'looking saves nothing');
  record.pageErrors = errors;
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'capture.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log('capture: PASS');
} finally {
  await browser?.close();
  server?.close();
  await reads?.close?.();
  await store?.close?.();
  await pg?.stop?.();
  rmSync(temporary, { recursive: true, force: true });
}
