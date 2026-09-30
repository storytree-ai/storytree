// ADR-0760 D1 on the actual desktop renderer and app reads: lanes roll up their increments and
// fold under what they wait on. Run under the heavy lock, after apps/desktop/build.mjs.
// Its fake bridge and Chromium come from the capture kit (apps/desktop/src/capture); no live
// project is opened or changed. CAPTURE_PLAYWRIGHT and CAPTURE_CHROMIUM name others by path.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@storytree/library';
import { openActivityLog, claim } from '@storytree/agent-link';
import { pageReads } from '@storytree/app';
import { start } from '@storytree/local-postgres';
import { fakeBridge, launch } from '../../../../apps/desktop/src/capture/index.ts';

const output = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(output, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-lane-rollup-'));
let postgres, store, log, reads, browser, server;
try {
  postgres = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'lane roll-up capture' });
  store = await connect({ url: postgres.url }); log = await openActivityLog(postgres.url);
  const project = 'storytree';
  const snapshot = JSON.parse(readFileSync(process.env.ARC_SNAPSHOT ?? '/home/mickh/storytree-lanes/snapshots/2026-09-27T12-40-59-713Z.json', 'utf8'));
  await store.restore(project, snapshot);
  const library = await store.openProject(project);
  const story = await library.addStory({ title: 'Understand the work' });
  const makeArc = (title) => library.createArc({ title, intent: `${title}.`, endState: 'Done.', stories: [story.id] });
  const work = (arc, title, extra = {}) => library.addIncrement({ arc: arc.id, title, objective: title, body: title, ...extra });

  // Ready: free work nobody holds.
  const users = await makeArc('Trusted-circle distribution');
  await work(users, 'Installer signed', { outcome: { disposition: 'landed', pr: '90' } });
  const firstUsers = await work(users, 'First trusted-circle users');
  await work(users, 'Invite letter');
  // Queued, folds under its blocker: its only open work waits on an increment in another arc.
  const lamp = await makeArc('Floor-health lamp');
  await work(lamp, 'Lamp design', { outcome: { disposition: 'landed', pr: '60' } });
  const rework = await work(lamp, 'Bring the lamp back, reworked');
  await library.addWait(rework.id, firstUsers.id, 'After first users.');
  // A chain: queued behind the lamp's work.
  const tips = await makeArc('Lamp tips in the briefing');
  const tip = await work(tips, 'Show a tip beside the lamp');
  await library.addWait(tip.id, rework.id, 'Needs the reworked lamp.');
  // Waiting: a question for the owner keeps it on top even though its work waits too.
  const waiting = await makeArc('Choose the release approach');
  await library.raiseQuestion({ arc: waiting.id, title: 'Which release should go first?', statement: 'One project or several?', stakes: 'How much work comes first.', context: 'Context.', options: 'A. One. B. Several.' });
  const release = await work(waiting, 'Prepare the release');
  await library.addWait(release.id, firstUsers.id, 'Users first.');
  // Queued at the top: what it waits on is not on the active board.
  const later = await makeArc('Hosted library later'); const host = await work(later, 'Host the library'); await library.parkArc(later.id);
  const cloud = await makeArc('Cloud backups');
  await work(cloud, 'Nightly backup');
  const restore = await work(cloud, 'Restore drill');
  for (const id of [(await library.arcView(cloud.id))?.increments.find(({ fields }) => fields.title === 'Nightly backup').id, restore.id]) await library.addWait(id, host.id, 'Needs the hosted library.');
  // Claimed, for contrast.
  const surface = await makeArc('Arc surface');
  const held = await work(surface, 'Lanes roll up');

  reads = pageReads({ storytree: store });
  // The renderer's own reads (updates, setup) are answered as idle here; they are not under test.
  const pick = (names) => Object.fromEntries(names.map((name) => [name, reads[name]]));
  const bridge = fakeBridge({
    ...pick(['listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'holds']),
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
  const errors = []; page.on('pageerror', error => { errors.push(String(error)); console.error('pageerror', String(error)); }); page.on('console', m => process.env.ARC_DEBUG && console.error('console', m.text()));
  await bridge.install(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await log.append(project, { kind: 'session-started', source: 'hook', harness: 'codex', session: 'capture-agent' });
  assert.equal((await claim({ library, log, project, session: 'capture-agent', harness: 'codex' }, held.id, 'Build the roll-up.')).ok, true);
  // The app menu opens itself when the app's own reads (updates, setup) are not carried here; it is not under test.
  await page.evaluate(() => { const menu = document.getElementById('app-menu'); if (menu?.matches(':popover-open')) menu.hidePopover(); });
  await page.locator('[data-open-arcs]').click();
  await page.waitForSelector('.arc-overlay[data-arc-state=ready]');
  await page.waitForSelector('[data-agent-label=Codex]');
  const chips = async () => page.locator('.arc-lanes > .arc-row').evaluateAll(rows => rows.map(row => [row.querySelector('.arc-title').textContent, row.querySelector('.arc-chip').textContent, row.querySelector('.arc-waits-on')?.textContent ?? '']));
  const top = await chips();
  assert.deepEqual(top.map(([title]) => title), ['Choose the release approach', 'Cloud backups', 'Arc surface', 'Trusted-circle distribution'], 'lamp and tips fold away; the question and the off-board wait stay on top');
  assert.deepEqual(top.find(([title]) => title === 'Trusted-circle distribution')?.[1], 'ready · 2 to take');
  assert.deepEqual(top.find(([title]) => title === 'Cloud backups')?.slice(1), ['queued', 'waits on Host the library · Hosted library later']);
  await page.screenshot({ path: path.join(output, 'folded.png') });
  await page.locator(`[data-arc-queue="${users.id}"]`).click();
  const queue = await page.locator(`[data-arc-id="${users.id}"] .arc-queue-chip`).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  assert.deepEqual(queue, ['Floor-health lamp — queued behind Trusted-circle distribution, waits on First trusted-circle users', 'Lamp tips in the briefing — queued behind Floor-health lamp, waits on Bring the lamp back, reworked']);
  await page.screenshot({ path: path.join(output, 'queue-open.png') });
  await page.locator(`[data-arc-select="${lamp.id}"]`).click();
  await page.screenshot({ path: path.join(output, 'queued-selected.png') });
  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), top, queue, errors };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await log?.close(); await store?.close(); await postgres?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
