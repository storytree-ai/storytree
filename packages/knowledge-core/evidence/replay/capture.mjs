// Bounded browser acceptance for ADR-0797: the real desktop page, built by
// packages/forest/evidence/sessions-list/build.mjs, over the read-only forest snapshot, with the
// traversal capture's session (ADR-0756) opening six notes. Selected with reduced motion, its steps
// are whole and still. With motion, one replay head walks them in reading order: at each moment the
// lines drawn and the notes lit are exactly those it has reached; the finished picture holds, then
// clears and the replay starts again. No per-agent glow is drawn while a session is selected.
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
const jump = loose[0], later = loose[5], last = loose[8], glimpses = [loose[10], loose[11]];
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
    { kind: 'file', id: 'packages/agent-link/src/claims/merges.ts', call: 'f1', tool: 'Read', resident: true },
    open(next, 'c2'),
    open(jump, 'c3'),
    open(later, 'c4'),
    open(last, 'c5'),
  ],
};
const opened = [old, hub, next, jump, later, last];

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
    const lines = [], states = {}, rings = [], fills = [], inView = [], glows = [];
    window.__globe.scene.traverse(object => {
      if (object.name.startsWith('knowledge-trail:')) lines.push({ ...object.userData, visible: object.children[0]?.visible ?? false });
      if (object.name.startsWith('knowledge-fill:')) fills.push({ step: object.name.slice('knowledge-fill:'.length), visible: object.visible, fill: object.userData.fill });
      if (object.name.startsWith('knowledge-point:') && object.userData.window) states[object.userData.id] = { state: object.userData.window, colour: object.userData.colour, opacity: object.userData.opacity };
      if (object.name.startsWith('knowledge-window:')) rings.push(object.name.slice('knowledge-window:'.length));
      if (object.name.startsWith('knowledge-in-view:')) inView.push(object.name);
      if (object.name.startsWith('knowledge-glow:') && object.visible) glows.push(object.name);
    });
    const shown = lines.sort((a, b) => a.seq - b.seq).filter(({ visible }) => visible).map(({ from, to }) => `${from}>${to}`);
    return { lines, shown, states, rings: rings.sort(), fills, inView, glows };
  });
  // Frame the camera on the notes the session opened, so its lines can be seen.
  const aim = notes => page.evaluate(notes => {
    const { scene, camera, controls } = window.__globe;
    const at = [];
    scene.traverse(o => { if (notes.includes(o.userData?.id) && o.name.startsWith('knowledge-point:')) at.push(o.getWorldPosition(o.position.clone())); });
    const centre = at.reduce((sum, p) => sum.add(p), at[0].clone().multiplyScalar(0)).multiplyScalar(1 / at.length);
    // Aim from a fixed distance, so aiming again never creeps the camera inwards.
    const distance = window.__aimFrom ??= camera.position.length();
    camera.position.copy(centre.clone().normalize().multiplyScalar(distance * 0.55));
    camera.lookAt(0, 0, 0);
    controls?.update?.();
    window.__globe.invalidate();
  }, notes);
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.userData?.lit) n++; }); return n > 0; });
  await frames();
  await aim(opened);
  await frames();

  // Select its row with reduced motion: every step whole and still, every note lit.
  await row.click();
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-window:')) n++; }); return n > 0; });
  await frames();
  await aim(opened);
  await frames();
  const still = await drawn();
  const steps = still.lines.map(({ from, to }) => `${from}>${to}`);
  assert.deepEqual(steps, opened.slice(1).map((to, i) => `${opened[i]}>${to}`), 'one step per move, in reading order');
  assert.deepEqual(still.shown, steps, 'reduced motion: every step drawn whole');
  assert.deepEqual(still.glows, [], 'no glow while a session is selected');
  await page.screenshot({ path: path.join(out, '0-reduced-motion.png') });

  // Motion: reselect, so the replay starts from nothing, and sample it over one whole cycle.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await row.click();
  await row.click();
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-window:')) n++; }); return n > 0; });
  await aim(opened);
  const samples = [], strip = [];
  let mid = false;
  // Software GL can hand the page a canvas mid-draw; render and read it in one task, so each frame is whole.
  const shot = () => page.evaluate(async () => {
    // Let React commit the notes the head reached this frame first.
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    const { gl, scene, camera } = window.__globe;
    gl.render(scene, camera);
    return gl.domElement.toDataURL('image/png').split(',')[1];
  });
  for (let i = 0; i < 20; i++) {
    const now = await drawn();
    const lit = opened.filter(note => now.states[note] !== undefined);
    samples.push({ at: i * 400, shown: now.shown.length, lit: lit.length, glows: now.glows.length });
    // Only what the head has reached: the drawn steps are always the first of the reading order.
    assert.deepEqual(now.shown, steps.slice(0, now.shown.length), 'drawn steps are a prefix of the reading order');
    assert.deepEqual(now.glows, [], 'no glow while a session is selected');
    const partway = !mid && now.shown.length > 1 && now.shown.length < steps.length - 1;
    if (i % 2 === 0 || partway) await aim(opened);
    if (i % 2 === 0) strip.push(await shot());
    // The first frame caught partway through, with some steps drawn and some still to come.
    if (partway) { mid = true; writeFileSync(path.join(out, '1-mid-replay.png'), Buffer.from(await shot(), 'base64')); }
    await page.waitForTimeout(400);
  }
  assert.ok(mid, 'a frame was caught partway through');
  const counts = samples.map(({ shown }) => shown);
  assert.ok(counts.some(n => n > 0 && n < steps.length), 'the picture builds up step by step');
  assert.ok(counts.includes(steps.length), 'the finished picture is reached and held');
  assert.ok(counts.some((n, i) => i > 0 && n < counts[i - 1]), 'then clears and starts again');
  const rest = async () => { for (let i = 0; i < 40; i++) { if ((await drawn()).shown.length === steps.length) return; await page.waitForTimeout(100); } };
  await rest();
  // The last line is drawn from the moment it starts growing: wait out its growth, into the rest.
  await page.waitForTimeout(900);
  await aim(opened);
  writeFileSync(path.join(out, '2-at-rest.png'), Buffer.from(await shot(), 'base64'));
  const png = await page.evaluate(async frames => {
    const images = await Promise.all(frames.map(src => new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.src = `data:image/png;base64,${src}`; })));
    const crop = { x: images[0].width * 0.3, y: images[0].height * 0.25, w: images[0].width * 0.36, h: images[0].height * 0.5 };
    const canvas = document.createElement('canvas');
    const scale = 0.5;
    canvas.width = crop.w * scale * 5; canvas.height = crop.h * scale * 2;
    const context = canvas.getContext('2d');
    images.forEach((image, i) => context.drawImage(image, crop.x, crop.y, crop.w, crop.h, (i % 5) * crop.w * scale, Math.floor(i / 5) * crop.h * scale, crop.w * scale, crop.h * scale));
    return canvas.toDataURL('image/png').split(',')[1];
  }, strip);
  writeFileSync(path.join(out, '3-replay-strip.png'), Buffer.from(png, 'base64'));
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ steps, samples }, null, 2) + '\n');
  console.log('ADR-0797 capture passed');
} finally {
  await browser?.close();
  server.close();
}
