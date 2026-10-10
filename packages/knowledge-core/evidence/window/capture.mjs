// Bounded browser acceptance for ADR-0746 D1: the real desktop page, built by
// packages/forest/evidence/sessions-list/build.mjs, over the read-only forest snapshot. One running
// session has read six real notes; its window reading (agent link 9.10) says four of those it holds
// now, one fell out at a compaction, and which were in view when each was opened. Selecting its row
// rings the notes it holds in warm white and joins the in-view pairs with dotted warm white lines.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, fakeBridge, launch } from '../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const root = path.resolve(here, '../../../..');
const built = path.join(root, 'packages/forest/evidence/sessions-list/dist/production');
const seed = JSON.parse(readFileSync(path.join(root, 'packages/forest/src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const forest = seed.tree.stories.find(item => item.title === 'The forest');
const covers = [...new Set(seed.changes.changes.filter(change => change.record.fields?.frontCoverOf).map(change => change.recordId))].sort();
const session = 'builder';
const read = covers.slice(0, 6);
const now = Date.now();
const lines = [];
const line = (minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1,
  at: new Date(now - minutes * 60_000).toISOString(), ...fields });
line(30, { kind: 'session-started' });
line(20, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Build the traversal view' });
read.forEach((note, i) => line(15 - i, { kind: 'note-read', source: 'tool', note, found: 'search', read: 'whole', agent: 'orchestrator' }));
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

// The window reading: what each open had in view. The first and fourth came from a search; the
// fifth was opened before a compaction, so its read is no longer held.
const opened = note => [{ kind: 'note', id: note }];
const open = (note, call, from, resident = true) => ({ kind: 'note', id: note, call, tool: 'mcp__storytree__open', resident,
  inViewFrom: from.map(([via, notes]) => ({ call: via, tool: notes.length === 0 ? 'mcp__storytree__search_notes' : 'mcp__storytree__open', opened: notes.flatMap(opened) })) });
const window = {
  session, at: new Date(now).toISOString(), compactions: 1, inView: [], glimpses: [],
  opens: [
    open(read[4], 'c0', [['s0', []]], false),
    open(read[5], 'c5', [['c0', [read[4]]]]),
    open(read[0], 'c1', [['s1', []]]),
    open(read[1], 'c2', [['s1', []], ['c1', [read[0]]]]),
    open(read[2], 'c3', [['c2', [read[1]]]]),
    open(read[3], 'c4', [['s2', []]]),
    { kind: 'file', id: 'packages/agent-link/src/claims/merges.ts', call: 'f1', tool: 'Read', resident: true, inViewFrom: [] },
  ],
};
const held = [read[5], read[0], read[1], read[2], read[3]];

const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['index.html', 'renderer.js', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(path.join(built, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.__asked = [];
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.seed.projects, current: 'storytree' }),
      projectTree: async () => copy(data.seed.tree),
      changesSince: async (_, cursor) => ({ changes: copy(data.seed.changes.changes.filter(change => change.seq > cursor)), cursor: data.seed.changes.changes.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.seed.lines.lines.filter(item => item.seq > cursor)), cursor: data.seed.lines.lines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(data.seed.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
      // The sessions list reads every row's window for its detail; only the core's own ask, on selection, is counted.
      windowReadings: async (_, sessions) => sessions.map(() => copy(data.window)),
      windowReading: async (_, session) => { window.__asked.push(session); return copy(data.window); },
    };
  }, { seed, window });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe);
  for (const name of ['Close help', 'Close app menu']) {
    const close = page.getByRole('button', { name, exact: true });
    if (await close.isVisible()) await close.click();
  }
  const row = page.getByRole('complementary', { name: 'Running sessions', exact: true }).locator(`.session-row[data-session-id="${session}"]`);
  await row.waitFor();
  await page.locator('button[data-forest-mode="library"]').click();
  const frames = async () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); }
  });
  const drawn = () => page.evaluate(() => {
    const rings = [], links = [];
    window.__globe.scene.traverse(object => {
      if (object.name.startsWith('knowledge-window:')) rings.push(object.name.slice('knowledge-window:'.length));
      if (object.name.startsWith('knowledge-in-view:')) {
        let heads = 0;
        object.traverse(child => { if (child.geometry?.type === 'ConeGeometry') heads++; });
        links.push({ ...object.userData, heads });
      }
    });
    return { rings: rings.sort(), links };
  });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.userData?.lit) n++; }); return n > 0; });
  await frames();

  // None selected: the running session lights what it read, and no window is drawn.
  assert.deepEqual(await drawn(), { rings: [], links: [] }, 'no window while no session is selected');
  assert.deepEqual(await page.evaluate(() => window.__asked), [], 'no one session\'s window asked while none is selected');
  await page.screenshot({ path: path.join(out, 'window-none-selected.png') });

  // Select its row: the core asks for that session's window and draws it.
  await row.click();
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-window:')) n++; }); return n > 0; });
  await frames();
  const selected = await drawn();
  assert.deepEqual(await page.evaluate(() => window.__asked), [session]);
  assert.deepEqual(selected.rings, [...held].sort(), 'a ring on each note it holds now, and not on the one a compaction dropped');
  // The dotted in-view lines gave way to the traversal drawing (ADR-0756), which the traversal capture covers.
  assert.deepEqual(selected.links, [], 'no in-view lines: the traversal drawing replaced them');
  await page.screenshot({ path: path.join(out, 'window-selected.png') });

  // Back to every session: the window goes.
  await row.click();
  await frames();
  assert.deepEqual(await drawn(), { rings: [], links: [] }, 'deselecting takes the window away');
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ read: read.length, held: selected.rings.length, inViewLines: selected.links.length }, null, 2) + '\n');
  console.log('ADR-0746 D1 capture passed: ' + JSON.stringify({ held: selected.rings.length, inViewLines: selected.links.length }));
} finally {
  await browser?.close();
  server.close();
}
