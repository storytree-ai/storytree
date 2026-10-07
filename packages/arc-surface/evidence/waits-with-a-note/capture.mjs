// ADR-0938 on the actual desktop renderer and app reads: an increment that waits for the owner or an
// outside event, with a note, reads on the Arcs board.
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
// The frame is reached through the desktop app, which mounts this surface: arc-surface itself never depends on it (ADR-0847).
const { pageReads } = await import(pathToFileURL(createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url)).resolve('@storytree/app')).href);
import { start } from '@storytree/local-postgres';
import { captureOutput, fakeBridge, launch } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-waits-with-a-note-'));
const DAY = 86_400_000;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
let postgres, store, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'waits with a note capture' });
  store = await connect({ url: postgres.url });
  const project = 'storytree';
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const makeArc = (title) => library.createArc({ title, intent: `${title}.`, endState: 'Done.', stories: [story.id] });
  const work = (arc, title, extra = {}) => library.addIncrement({ arc: arc.id, title, objective: title, body: title, ...extra });
  const owner = (increment, note) => library.addWaitFor(increment.id, { releaser: 'owner', note });
  const event = (increment, note, checkBack) => library.addWaitFor(increment.id, { releaser: 'event', note, checkBack });

  // (a) A ready lane: two free fixes, and two increments that wait on something outside the library.
  const website = await makeArc('Website');
  await work(website, 'Pricing page', { outcome: { disposition: 'landed', pr: '41' } });
  await work(website, 'Fix the footer links');
  await work(website, 'Fix the contact form');
  await owner(await work(website, 'Switch the DNS'), 'approve the DNS cutover');
  await event(await work(website, 'Add card payments'), 'payment provider review', day(14));
  // (b) Queued lanes: the only open work waits on the owner (yellow, waiting on you), or on an event.
  const backups = await makeArc('Cloud backups');
  await work(backups, 'Restore drill', { outcome: { disposition: 'landed', pr: '12' } });
  await owner(await work(backups, 'Move the archive'), 'pick the backup region');
  const mobile = await makeArc('Mobile app');
  await event(await work(mobile, 'Ship the beta'), 'app store review', day(21));
  // (c) A bar whose event check-back has passed: the library is asked on a day when "tomorrow" is behind it.
  const docs = await makeArc('Docs refresh');
  await work(docs, 'Rewrite the quick start');
  await event(await work(docs, 'Publish the vendor comparison'), 'the vendor quote arrives', day(1));
  const later = () => new Date(Date.now() + 3 * DAY);

  reads = pageReads({ storytree: store });
  const pick = (names) => Object.fromEntries(names.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'arcViews']),
    // The library's own holds, read as of three days on: the 'tomorrow' check-back has passed, the others have not.
    holds: async () => library.holds(later()),
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
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  await page.locator('[data-open-arcs]').click();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  await page.waitForSelector('.arc-lanes > .arc-row .arc-bar', { state: 'attached' });
  const rows = async () => page.locator('.arc-lanes > .arc-row').evaluateAll(nodes => nodes.map(row => ({
    title: row.querySelector('.arc-title').textContent,
    chip: row.querySelector('.arc-chip').textContent,
    marker: row.querySelector('.arc-note-marker')?.textContent ?? null,
    markerHover: row.querySelector('.arc-note-marker')?.getAttribute('title') ?? null,
    waitsOn: row.querySelector('.arc-waits-on')?.textContent ?? null,
    waitsOnHover: row.querySelector('.arc-waits-on')?.getAttribute('title') ?? null,
    count: row.querySelector('.arc-count').textContent,
    bars: [...row.querySelectorAll('.arc-bar')].map(bar => ({ id: bar.dataset.incrementId, className: bar.className, passed: bar.dataset.checkBackPassed ?? null, hover: bar.getAttribute('title') })),
  })));
  const lanes = await rows();
  const by = (title) => lanes.find(lane => lane.title === title);
  assert.equal(lanes.length, 4);
  assert.deepEqual(lanes.map(lane => lane.title).slice(0, 2).sort(), ['Cloud backups', 'Mobile app'], 'the queued lanes sort above the ready ones');
  assert.equal(by('Website').chip, 'ready · 2 to take');
  assert.equal(by('Website').marker, '+2 waiting for approve the DNS cutover and 1 more');
  assert.match(by('Website').markerHover, /Switch the DNS: waits for you: approve the DNS cutover/);
  assert.match(by('Website').markerHover, /Add card payments: waits for an event: payment provider review \(check back /);
  assert.equal(by('Cloud backups').chip, 'queued');
  assert.equal(by('Cloud backups').waitsOn, 'waits for you: pick the backup region');
  assert.equal(by('Cloud backups').marker, null, 'a queued lane says it on its wait line, not a marker');
  assert.equal(by('Mobile app').chip, 'queued');
  assert.match(by('Mobile app').waitsOn, /^waits for an event: app store review \(check back /);
  assert.equal(by('Docs refresh').chip, 'ready · 2 to take', 'a passed check-back leaves the work free to take');
  assert.equal(by('Docs refresh').marker, null);
  const passed = by('Docs refresh').bars.filter(bar => bar.passed);
  assert.equal(passed.length, 1);
  assert.match(passed[0].hover, /check-back passed \d{4}-\d\d-\d\d: the vendor quote arrives/);
  assert.equal(lanes.flatMap(lane => lane.bars).filter(bar => bar.passed).length, 1, 'only that one bar is marked');
  // Hover text is a native tooltip, not drawn by headless Chromium: it is the title attribute measured above.
  await page.screenshot({ path: path.join(output, 'board.png'), clip: { x: 0, y: 0, width: 1440, height: 580 } });
  await page.screenshot({ path: path.join(output, 'lanes.png'), clip: { x: 0, y: 134, width: 720, height: 330 } });
  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), lanes, errors };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
