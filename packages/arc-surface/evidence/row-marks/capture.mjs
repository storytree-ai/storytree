// ADR-0980 on the actual desktop renderer and app reads: an arc's row is its chip, its title and two
// counted wait marks, then its bars alone, which keep their size and wrap on a long arc.
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
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-row-marks-'));
const DAY = 86_400_000;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
let postgres, store, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'row marks capture' });
  store = await connect({ url: postgres.url });
  const project = 'storytree';
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const makeArc = (title) => library.createArc({ title, intent: `${title}.`, endState: 'Done.', stories: [story.id] });
  const work = (arc, title, extra = {}) => library.addIncrement({ arc: arc.id, title, objective: title, body: title, ...extra });
  const owner = (increment, note) => library.addWaitFor(increment.id, { releaser: 'owner', note });
  const event = (increment, note, checkBack) => library.addWaitFor(increment.id, { releaser: 'event', note, checkBack });

  // (a) A long arc: 34 increments, most landed, one that failed, the rest open, under a long title.
  const platform = await makeArc('Platform rebuild: every service moved to the new runtime, with its data, its alerts and its runbooks');
  for (let n = 1; n <= 26; n++) await work(platform, `Move service ${n}`, { outcome: { disposition: 'landed', pr: String(100 + n) } });
  await work(platform, 'Move the billing service', { outcome: { disposition: 'failed' } });
  const platformOpen = [];
  for (let n = 1; n <= 7; n++) platformOpen.push(await work(platform, `Move the last service ${n}`));
  // (b) A ready lane with free work, one owner note, one event note, and an open question.
  const website = await makeArc('Website');
  await work(website, 'Pricing page', { outcome: { disposition: 'landed', pr: '41' } });
  await work(website, 'Fix the footer links');
  await owner(await work(website, 'Switch the DNS'), 'approve the DNS cutover');
  await event(await work(website, 'Add card payments'), 'payment provider review', day(14));
  await library.raiseQuestion({ arc: website.id, title: 'Which payment provider?', statement: 'Which provider should take card payments?', stakes: 'It sets fees and the review we wait on.', context: 'Two quotes are in.', options: 'A. The cheaper one. FOR: fees. AGAINST: slower review.\n\nB. The faster one. FOR: review. AGAINST: fees.' });
  // (c) A queued lane: its only open work waits on other work (a missing blocker stays at the top) and the owner.
  const backups = await makeArc('Cloud backups');
  await work(backups, 'Restore drill', { outcome: { disposition: 'landed', pr: '12' } });
  await owner(await work(backups, 'Move the archive'), 'pick the backup region');
  const mirror = await work(backups, 'Mirror the archive');
  await library.addWait(mirror.id, platformOpen[0].id, 'The new runtime first.');
  await library.addWait((await work(backups, 'Check the mirror')).id, platformOpen[0].id, 'The new runtime first.');
  // (d) A lane with nothing to count draws no marks.
  const docs = await makeArc('Docs refresh');
  await work(docs, 'Rewrite the quick start');

  reads = pageReads({ storytree: store });
  const pick = (names) => Object.fromEntries(names.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'arcViews']),
    holds: async () => library.holds(),
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
  const rows = async () => page.locator('.arc-lanes > .arc-row').evaluateAll(nodes => nodes.map(row => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const head = row.querySelector('.arc-lane-head');
    return {
      title: row.querySelector('.arc-title').textContent,
      chip: row.querySelector('.arc-chip').textContent,
      lineOne: [...head.children].map(child => child.className),
      lineTwo: [...row.querySelector('.arc-track').children].map(child => child.className),
      barsLabel: row.querySelector('.arc-bars').getAttribute('aria-label'),
      marks: [...row.querySelectorAll('.arc-mark')].map(mark => ({ kind: mark.className.replace('arc-mark arc-mark-', ''), count: mark.querySelector('.arc-mark-count').textContent, hover: mark.getAttribute('title'), label: mark.getAttribute('aria-label') })),
      head: box(head), title_box: box(row.querySelector('.arc-title')), marksBox: row.querySelector('.arc-marks') ? box(row.querySelector('.arc-marks')) : null, lane: box(row.querySelector('.arc-lane')),
      bars: [...row.querySelectorAll('.arc-bar')].map(box),
    };
  }));
  const lanes = await rows();
  const by = (title) => lanes.find(lane => lane.title.startsWith(title));
  assert.equal(lanes.length, 4);
  for (const lane of lanes) {
    assert.deepEqual(lane.lineTwo, ['arc-bars'], `${lane.title}: line two is the bars alone`);
    assert.ok(lane.bars.every(bar => bar.width === 8 && bar.height === 10), `${lane.title}: every bar keeps its size`);
    assert.ok(lane.bars.every(bar => bar.y >= lane.head.y + lane.head.height), `${lane.title}: no bar is drawn beside or over line one`);
    if (lane.marksBox) assert.ok(lane.marksBox.x >= lane.title_box.x + lane.title_box.width, `${lane.title}: the marks sit at the right of the title, not over it`);
  }
  const long = by('Platform rebuild');
  assert.equal(long.bars.length, 34);
  assert.equal(long.barsLabel, 'Increments: 26 landed · 1 not completed · 7 open');
  assert.deepEqual(long.marks, []);
  assert.deepEqual(by('Website').marks.map(({ kind, count }) => [kind, count]), [['waits', '1'], ['owner', '2']]);
  assert.match(by('Website').marks[0].hover, /^Add card payments: waits for an event: payment provider review \(check back /);
  assert.equal(by('Website').marks[1].hover, 'waiting on you: Which payment provider?\nSwitch the DNS: waits for you: approve the DNS cutover');
  assert.deepEqual(by('Cloud backups').marks.map(({ kind, count }) => [kind, count]), [['waits', '1'], ['owner', '1']], 'two increments waiting on one blocker count it once');
  assert.deepEqual(by('Docs refresh').marks, []);
  assert.ok(lanes.every(lane => lane.marks.every(mark => mark.label === mark.hover)), 'each mark is labelled with its hover');
  // Hover text is a native tooltip, not drawn by headless Chromium: it is the title attribute measured above.
  await page.screenshot({ path: path.join(output, 'board.png'), clip: { x: 0, y: 0, width: 1440, height: 580 } });
  await page.screenshot({ path: path.join(output, 'lanes.png'), clip: { x: 0, y: 134, width: 780, height: 220 } });
  // A narrow window: the long arc's bars wrap onto further lines, at their size.
  await page.setViewportSize({ width: 640, height: 960 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const narrow = (await rows()).find(lane => lane.title.startsWith('Platform rebuild'));
  assert.ok(new Set(narrow.bars.map(bar => bar.y)).size >= 2, 'the long arc wraps onto a second line');
  assert.ok(narrow.bars.every(bar => bar.width === 8), 'wrapped bars keep their size');
  assert.ok(narrow.bars.every(bar => bar.x + bar.width <= narrow.lane.x + narrow.lane.width), 'no bar runs past the row');
  await page.screenshot({ path: path.join(output, 'narrow.png'), clip: { x: 0, y: 0, width: 640, height: 580 } });
  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), lanes, narrowLines: new Set(narrow.bars.map(bar => bar.y)).size, errors };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ lanes: lanes.map(({ title, chip, marks, barsLabel }) => ({ title, chip, marks: marks.map(({ kind, count }) => `${kind} ${count}`), barsLabel })), narrowLines: result.narrowLines }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
