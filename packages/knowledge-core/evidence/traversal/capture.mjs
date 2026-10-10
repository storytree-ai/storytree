// Bounded browser acceptance for ADR-0756: the real desktop page, built by
// packages/forest/evidence/sessions-list/build.mjs, over the read-only forest snapshot. One running
// session opened four real notes; its window reading (agent link 9.10) says the first was compacted
// out since, and names two more it only glimpsed. Selecting its row draws one line per step in
// reading order: solid where the snapshot stores a link between the two notes, dotted where none
// does. Then a fifth open arrives and its line grows, and a faint fill runs along each line.
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
const records = new Map(seed.changes.changes.map(change => [change.recordId, change.record]));
const covers = [...new Set(seed.changes.changes.filter(change => change.record.fields?.frontCoverOf).map(change => change.recordId))].sort();
const joined = (a, b) => (records.get(a)?.fields.links ?? []).includes(b) || (records.get(b)?.fields.links ?? []).includes(a);
// The snapshot's covers store two links, both from one note: old -> hub, then hub -> next are solid.
const hub = 'decision_5ae1815d9959', old = 'decision_69b5ac6855c3', next = 'decision_914f96703a84';
assert.ok(joined(old, hub) && joined(hub, next), 'the snapshot still stores the two links');
const loose = covers.filter(id => ![hub, old, next].includes(id) && !joined(id, next) && !joined(id, hub));
const jump = loose[0], later = loose[5], glimpses = [loose[10], loose[11]];
const session = 'builder';
const now = Date.now();
const lines = [];
const line = (minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1,
  at: new Date(now - minutes * 60_000).toISOString(), ...fields });
line(30, { kind: 'session-started' });
line(20, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Build the traversal view' });
[old, hub, next, jump].forEach((note, i) => line(15 - i, { kind: 'note-read', source: 'tool', note, found: 'search', read: 'whole', agent: 'orchestrator' }));
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

const open = (id, call, resident = true) => ({ kind: 'note', id, call, tool: 'mcp__storytree__open', resident });
const reading = {
  session, at: new Date(now).toISOString(), compactions: 1, inView: [], glimpses,
  opens: [
    open(old, 'c0', false),
    open(hub, 'c1'),
    { kind: 'file', id: 'packages/session-management/src/claims/merges.ts', call: 'f1', tool: 'Read', resident: true },
    open(next, 'c2'),
    open(jump, 'c3'),
  ],
};
const steps = [[old, hub, 'solid', true], [hub, next, 'solid', false], [next, jump, 'dotted', false]];

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
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
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
    window.__window = data.reading;
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.seed.projects, current: 'storytree' }),
      projectTree: async () => copy(data.seed.tree),
      changesSince: async (_, cursor) => ({ changes: copy(data.seed.changes.changes.filter(change => change.seq > cursor)), cursor: data.seed.changes.changes.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.seed.lines.lines.filter(item => item.seq > cursor)), cursor: data.seed.lines.lines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(data.seed.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, holds: async () => ({ waits: {}, heldOn: {} }), waitHolds: async () => [], heldOnQuestion: async () => [],
      readSurfaces: async () => ({ ok: false }),
      windowReadings(project, sessions) { return Promise.all(sessions.map((one) => this.windowReading(project, one))); },
      windowReading: async (_, session) => { window.__asked.push(session); return copy(window.__window); },
    };
  }, { seed, reading });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe, null, { timeout: 20_000 });
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
    const lines = [], states = {}, rings = [], fills = [], inView = [];
    window.__globe.scene.traverse(object => {
      if (object.name.startsWith('knowledge-trail:')) lines.push({ ...object.userData, visible: object.children[0]?.visible ?? false });
      if (object.name.startsWith('knowledge-fill:')) fills.push({ step: object.name.slice('knowledge-fill:'.length), visible: object.visible, fill: object.userData.fill });
      if (object.name.startsWith('knowledge-point:') && object.userData.window) states[object.userData.id] = { state: object.userData.window, colour: object.userData.colour, opacity: object.userData.opacity };
      if (object.name.startsWith('knowledge-window:')) rings.push(object.name.slice('knowledge-window:'.length));
      if (object.name.startsWith('knowledge-in-view:')) inView.push(object.name);
    });
    return { lines: lines.sort((a, b) => a.seq - b.seq), states, rings: rings.sort(), fills, inView };
  });
  // Frame the camera on the notes the session opened, so its lines can be seen.
  const aim = notes => page.evaluate(notes => {
    const { scene, camera, controls } = window.__globe;
    const at = [];
    scene.traverse(o => { if (notes.includes(o.userData?.id) && o.name.startsWith('knowledge-point:')) at.push(o.getWorldPosition(o.position.clone())); });
    const centre = at.reduce((sum, p) => sum.add(p), at[0].clone().multiplyScalar(0)).multiplyScalar(1 / at.length);
    const distance = camera.position.length();
    camera.position.copy(centre.clone().normalize().multiplyScalar(distance * 0.55));
    camera.lookAt(0, 0, 0);
    controls?.update?.();
    window.__globe.invalidate();
  }, notes);
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.userData?.lit) n++; }); return n > 0; });
  await frames();
  await aim([old, hub, next, jump]);
  await frames();
  assert.deepEqual((await drawn()).states, {}, 'no window while no session is selected');
  await page.screenshot({ path: path.join(out, '0-none-selected.png') });

  // Select its row: one line per step in reading order, solid along a stored link, dotted for a jump.
  await row.click();
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-window:')) n++; }); return n > 0; });
  await frames();
  await aim([old, hub, next, jump]);
  await frames();
  const selected = await drawn();
  assert.deepEqual(selected.lines.map(({ from, to, edge, faded }) => [from, to, edge, faded]), steps, 'one line per step, in reading order, solid or dotted by a stored link');
  assert.deepEqual(selected.rings, [hub, next, jump].sort(), 'a ring on each note whose read is in the window now');
  assert.equal(selected.states[old].state, 'faded', 'the compacted read is faded');
  assert.deepEqual(glimpses.map(note => selected.states[note]?.state), ['glimpsed', 'glimpsed'], 'the glimpsed notes are tinted');
  assert.deepEqual(selected.inView, [], 'no in-view line any more');
  assert.deepEqual(selected.fills, [], 'reduced motion: no fill');
  await page.screenshot({ path: path.join(out, '1-selected.png') });

  // With motion on, a selected session replays its steps instead (ADR-0797): the per-step fill and growth
  // this capture once showed are retired, and the replay capture covers the motion.
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({
    steps: selected.lines.map(({ from, to, edge, faded }) => ({ from, to, edge, faded })),
    rings: selected.rings, states: Object.fromEntries(Object.entries(selected.states).map(([id, { state }]) => [id, state])),
  }, null, 2) + '\n');
  console.log('ADR-0756 capture passed');
} finally {
  await browser?.close();
  server.close();
}
