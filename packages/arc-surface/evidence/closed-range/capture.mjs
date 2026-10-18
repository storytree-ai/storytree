// 3.12 on the actual desktop renderer and app reads: the Closed tab opens on Today from the board's
// own read, and 7 days or a From–to asks the library for older closed arcs. Run after
// apps/desktop/build.mjs. Its fake bridge and Chromium come from the capture kit
// (apps/desktop/src/capture); a throwaway Postgres holds the arcs, and no live project is opened.
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
import { dayOf } from '../../src/board/closed-range.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const dist = path.resolve(here, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-closed-range-'));
let postgres, store, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'closed range capture' });
  store = await connect({ url: postgres.url });
  const project = 'storytree';
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const makeArc = (title) => library.createArc({ title, intent: `${title}.`, endState: 'Done.', stories: [story.id] });
  // Each arc closes on the day its last increment closes, as the library reads it (10.22).
  const closedOn = async (title, ...daysAgo) => {
    const arc = await makeArc(title);
    for (const [index, ago] of daysAgo.entries()) {
      const increment = await library.addIncrement({ arc: arc.id, title: `${title}, part ${index + 1}`, objective: 'Build', body: 'Build' });
      await library.closeIncrement(increment.id, { disposition: index === 1 ? 'withdrawn' : 'landed', ...(index === 1 ? { note: 'A smaller approach worked.' } : { pr: String(100 + index) }), date: dayOf(Date.now(), -ago) });
    }
    return arc;
  };
  const live = await makeArc('Arc surface opens fresh');
  await library.addIncrement({ arc: live.id, title: 'Closed arcs by date', objective: 'Read by date', body: 'Read by date' });
  await closedOn('Closed today', 3, 0);
  await closedOn('Closed yesterday', 1);
  await closedOn('Closed four days ago', 9, 6, 4);
  await closedOn('Closed three weeks ago', 21);

  reads = pageReads({ storytree: store });
  const asked = [];
  const pick = (names) => Object.fromEntries(names.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'boardArcs', 'holds']),
    // Every closed-arc ask is counted: Today and Yesterday must make none.
    closedArcs: async (name, window) => { asked.push(window); return reads.closedArcs(name, window); },
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.error('pageerror', String(error)); });
  await bridge.install(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  // The app menu opens itself when the app's own reads (updates, setup) are not carried here; it is not under test.
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  await page.locator('[data-open-arcs]').click();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  const titles = () => page.locator('.arc-lanes .arc-title').allTextContents();
  const shown = {};
  shown.active = await titles();
  assert.deepEqual(shown.active, ['Arc surface opens fresh']);

  await page.locator('[data-arc-scope="closed"]').click();
  shown.today = await titles();
  assert.deepEqual(shown.today, ['Closed today']);
  await page.screenshot({ path: path.join(output, 'closed-today.png') });

  await page.locator('[data-closed-range="yesterday"]').click();
  shown.yesterday = await titles();
  assert.deepEqual(shown.yesterday, ['Closed yesterday']);
  assert.deepEqual(asked, [], 'Today and Yesterday ask the library nothing more');

  await page.locator('[data-closed-range="week"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.arc-lanes .arc-title').length === 3);
  shown.week = (await titles()).sort();
  assert.deepEqual(shown.week, ['Closed four days ago', 'Closed today', 'Closed yesterday']);
  await page.locator('.arc-lane', { hasText: 'Closed four days ago' }).click();
  await page.screenshot({ path: path.join(output, 'closed-week.png') });

  await page.locator('[data-closed-from]').fill(dayOf(Date.now(), -30));
  await page.waitForFunction(() => document.querySelectorAll('.arc-lanes .arc-title').length === 4);
  shown.range = (await titles()).sort();
  assert.deepEqual(shown.range, ['Closed four days ago', 'Closed three weeks ago', 'Closed today', 'Closed yesterday']);
  await page.screenshot({ path: path.join(output, 'closed-from-to.png') });
  assert.equal(asked.length, 2, 'one ask for 7 days, one for the From–to');
  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), shown, asked, errors };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
