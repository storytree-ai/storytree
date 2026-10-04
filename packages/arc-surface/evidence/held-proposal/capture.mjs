// ADR-0909 D2 on the actual desktop renderer and app reads: a proposal held on a question the owner
// has not settled reads waiting on you, and stops counting as free to take. Run after
// apps/desktop/build.mjs. Its fake bridge and Chromium come from the capture kit
// (apps/desktop/src/capture); no live project is opened or changed. CAPTURE_PLAYWRIGHT and
// CAPTURE_CHROMIUM name others by path. --before records the readings without asserting them, for
// a capture of the renderer built before the fix.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from '@storytree/library';
import { openActivityLog } from '@storytree/agent-link';
// The frame is reached through the desktop app, which mounts this surface: arc-surface itself never depends on it (ADR-0847).
const { pageReads } = await import(pathToFileURL(createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url)).resolve('@storytree/app')).href);
import { start } from '@storytree/local-postgres';
import { captureOutput, fakeBridge, launch } from '../../../../apps/desktop/src/capture/index.ts';

const before = process.argv.includes('--before');
const name = before ? 'before' : 'after';
const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-held-proposal-'));
let postgres, store, log, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'held proposal capture' });
  store = await connect({ url: postgres.url }); log = await openActivityLog(postgres.url);
  const project = 'storytree';
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const makeArc = (title) => library.createArc({ title, intent: `${title}.`, endState: 'Done.', stories: [story.id] });
  const work = (arc, title, extra = {}) => library.addIncrement({ arc: arc.id, title, objective: title, body: title, ...extra });
  const ask = (arc, title) => library.raiseQuestion({ arc: arc.id, title, statement: `${title}?`, stakes: 'Stakes.', context: 'Context.', options: 'A. Yes. B. No.' });

  // A proposal held on the owner's question on its own arc, beside free work.
  const live = await makeArc('One owner-approved waitlist row proves the live path');
  await work(live, 'The waitlist form writes a row', { outcome: { disposition: 'landed', pr: '410' } });
  const email = await ask(live, 'Which email should the live row use');
  await work(live, 'Send one live waitlist entry', { heldOn: [email.id] });
  await work(live, 'Show the row in the owner\'s session');
  // A proposal held on a question raised on another arc: its arc has no question of its own.
  const keeps = await makeArc('The app keeps up');
  const fork = await ask(keeps, 'Should the land draw your folder or merged main');
  const follows = await makeArc('The land follows merged work');
  await work(follows, 'Redraw the land after a merge', { heldOn: [fork.id] });
  await work(keeps, 'The globe redraws after losing its drawing context');
  // Free proposals, one naming the machine it needs (ADR-0909 D3): still to take.
  const releases = await makeArc('Promoted releases for first users');
  await work(releases, 'Verify stable channels on a real Windows install', { body: 'needs: the laptop' });
  await work(releases, 'CI starts the packaged app');

  reads = pageReads({ storytree: store });
  const pick = (names) => Object.fromEntries(names.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcViews', 'holds']),
    projectSelection: async () => ({ current: project, projects: [project] }),
    readSurfaces: async () => undefined,
    agentConnections: async () => [],
    codeSurvey: async () => ({}),
    checkForUpdates: async () => ({ phase: 'unavailable', runningBuild: 'capture', reason: 'not under test' }),
  });
  server = createServer((req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'arc-surface.css', 'styles.css'].includes(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.error('pageerror', String(error)); });
  await bridge.install(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await log.append(project, { kind: 'session-started', source: 'hook', harness: 'codex', session: 'capture-agent' });
  // The app menu opens itself when the app's own reads (updates, setup) are not carried here; it is not under test.
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  await page.locator('[data-open-arcs]').click();
  await page.waitForSelector('.arc-lanes > .arc-row', { timeout: 8000 }).catch(async (error) => { await page.screenshot({ path: path.join(output, 'debug.png') }); console.error(await page.locator('body').innerHTML().then((h) => h.slice(0, 3000))); throw error; });
  const rows = await page.locator('.arc-lanes > .arc-row').evaluateAll(nodes => nodes.map(row => ({
    arc: row.querySelector('.arc-title').textContent,
    chip: row.querySelector('.arc-chip').textContent,
    bars: [...row.querySelectorAll('.arc-bar')].map(bar => `${bar.getAttribute('aria-label')} [${[...bar.classList].find(c => /^arc-(grey|yellow|green|red)$/.test(c))}]`),
  })));
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  const row = (arc) => rows.find((r) => r.arc === arc);
  if (!before) {
    assert.equal(row('One owner-approved waitlist row proves the live path')?.chip, 'waiting');
    assert.ok(row('One owner-approved waitlist row proves the live path')?.bars.some((bar) => bar.startsWith('Send one live waitlist entry') && bar.endsWith('[arc-yellow]')), 'the held proposal reads waiting on you');
    assert.equal(row('The land follows merged work')?.chip, 'queued', 'its only open work waits on the owner, so nothing is free to take');
    assert.equal(row('Promoted releases for first users')?.chip, 'ready · 2 to take', 'free proposals, machine named or not, are still to take');
  }
  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), rows, errors };
  writeFileSync(path.join(output, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await log?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
