// ADR-0938 D3 on the actual desktop renderer and app reads: an idle claim does not hide free work.
// Run after apps/desktop/build.mjs. Its fake bridge and Chromium come from the capture kit
// (apps/desktop/src/capture); an isolated Postgres holds an explicit fixture, so no live project is
// opened or changed. CAPTURE_PLAYWRIGHT and CAPTURE_CHROMIUM name others by path.
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

const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-idle-beside-ready-'));
let postgres, store, log, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'idle beside ready capture' });
  store = await connect({ url: postgres.url }); log = await openActivityLog(postgres.url);
  const project = 'storytree';
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const makeArc = (title) => library.createArc({ title, intent: `${title}.`, endState: 'Done.', stories: [story.id] });
  const work = (arc, title, extra = {}) => library.addIncrement({ arc: arc.id, title, objective: title, body: title, ...extra });

  // (a) Free work and one idle claim: reads ready, the quiet claim kept beside the chip (the website arc's real case).
  const website = await makeArc('Website');
  await work(website, 'Pricing page', { outcome: { disposition: 'landed', pr: '41' } });
  const held = await work(website, 'Fix the footer links');
  await work(website, 'Fix the contact form');
  await work(website, 'Fix the mobile menu');
  await work(website, 'Fix the sitemap');
  // (b) Only open work, and an idle session holds it: nothing to take, so idle.
  const backups = await makeArc('Cloud backups');
  const drill = await work(backups, 'Restore drill');
  // (c) Free work, no claims: ready, nothing beside it.
  const docs = await makeArc('Docs refresh');
  await work(docs, 'Rewrite the quick start');
  await work(docs, 'Add the glossary');
  // (d) A live holder, for contrast: claimed.
  const surface = await makeArc('Arc surface');
  const live = await work(surface, 'Lanes roll up');
  await work(surface, 'Idle beside ready');

  reads = pageReads({ storytree: store });
  const pick = (names) => Object.fromEntries(names.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'arcViews', 'holds']),
    projectSelection: async () => ({ current: project, projects: [project] }),
    readSurfaces: async () => undefined,
    agentConnections: async () => [],
    codeSurvey: async () => ({}),
    checkForUpdates: async () => ({ phase: 'unavailable', runningBuild: 'capture', reason: 'not under test' }),
  });
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'arc-surface.css', 'styles.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.error('pageerror', String(error)); }); page.on('console', m => process.env.ARC_DEBUG && console.error('console', m.text()));
  await bridge.install(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  // The claims are hook lines written earlier: two sessions went quiet (859 and 42 minutes ago), one is working now.
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000 - 20_000).toISOString();
  const claimLine = (session, increment, reason) => ({ session, harness: 'claude-code', source: 'hook', kind: 'claimed', increment, reason });
  await log.append(project, claimLine('quiet-footer', held.id, 'Fix the footer links.'), { at: minutesAgo(859) });
  await log.append(project, claimLine('quiet-drill', drill.id, 'Run the restore drill.'), { at: minutesAgo(42) });
  await log.append(project, claimLine('working-now', live.id, 'Build the roll-up.'), { at: new Date().toISOString() });
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  await page.locator('[data-open-arcs]').click();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  await page.waitForSelector('[data-agent-session]', { state: 'attached' }).catch(async () => { console.error(await page.locator('.arc-lanes').innerText()); throw new Error('no agent marks'); });
  const rows = async () => page.locator('.arc-lanes > .arc-row').evaluateAll(nodes => nodes.map(row => ({
    title: row.querySelector('.arc-title').textContent,
    chip: row.querySelector('.arc-chip').textContent,
    marker: row.querySelector('.arc-idle-marker')?.textContent ?? null,
    markerHover: row.querySelector('.arc-idle-marker')?.getAttribute('title') ?? null,
    count: row.querySelector('.arc-count').textContent,
  })));
  const lanes = await rows();
  const by = (title) => lanes.find(lane => lane.title === title);
  assert.deepEqual(lanes.map(lane => lane.title).slice(0, 2), ['Arc surface', 'Cloud backups'], 'claimed, then idle, then the ready lanes');
  assert.deepEqual(lanes.map(lane => lane.title).slice(2).sort(), ['Docs refresh', 'Website'], 'the mixed lane sorts with the ready lanes');
  assert.equal(by('Website').chip, 'ready · 3 to take');
  assert.equal(by('Website').marker, 'idle · 859 min', 'the quiet claim stays beside the ready chip');
  assert.match(by('Website').markerHover, /Holds Fix the footer links/);
  assert.equal(by('Cloud backups').chip, 'idle · 42 min');
  assert.equal(by('Cloud backups').marker, null, 'an idle lane carries only its own chip');
  assert.equal(by('Docs refresh').chip, 'ready · 2 to take');
  assert.equal(by('Docs refresh').marker, null);
  assert.equal(by('Arc surface').chip, 'claimed');
  // The marker's hover (a native tooltip, not drawn by headless Chromium) is the title attribute measured above.
  await page.screenshot({ path: path.join(output, 'board.png'), clip: { x: 0, y: 0, width: 1440, height: 580 } });
  await page.screenshot({ path: path.join(output, 'lanes.png'), clip: { x: 0, y: 134, width: 480, height: 230 } });
  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), lanes, errors };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await log?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
