// Bounded browser acceptance for ADR-0754 D1 as increment_81d266399588 built it: the real desktop
// page, built by packages/forest/evidence/sessions-list/build.mjs, over the read-only forest
// snapshot. Three running sessions, none selected. Two read the library by command line, so the log
// holds no note-read line for them: only their window readings (agent link 9.10) say what they
// opened. The third has no window, and its log's note-read lines stand in. Every one lights what it
// opened in its colour, with a line from each opened note to the next; a note two of them opened
// wears a ring of two arcs. Then a later reading adds an open, and its line grows and glows.
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
const story = title => seed.tree.stories.find(item => item.title === title);
const forest = story('The forest'), app = story('The app'), librarian = story('The librarian');
const covers = [...new Set(seed.changes.changes.filter(change => change.record.fields?.frontCoverOf).map(change => change.recordId))].sort();
// The ids the all-sessions capture chose, so the three colours sit far apart on the wheel.
const ids = { a: 'builder', b: 'traversal-a', c: 'librarian' };
const shared = covers[12];
const opened = { a: [...covers.slice(0, 5), shared], b: [shared, ...covers.slice(20, 25)] };
const logged = covers.slice(40, 45);
const added = covers[6];
const now = Date.now();
const lines = [];
const line = (session, minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1,
  at: new Date(now - minutes * 60_000).toISOString(), ...fields });
for (const session of Object.values(ids)) line(session, 30, { kind: 'session-started' });
line(ids.a, 20, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Build the traversal view' });
line(ids.b, 20, { kind: 'claimed', source: 'tool', capability: app.capabilities[0].id, reason: 'Review the app' });
line(ids.c, 20, { kind: 'claimed', source: 'tool', capability: librarian.capabilities[0].id, reason: 'Check the library links' });
// Only the session with no window has note-read lines (it read through the agent link's open).
logged.forEach((note, i) => line(ids.c, 10 - i * 0.1, { kind: 'note-read', source: 'tool', note, found: 'search', read: 'whole', agent: 'orchestrator' }));
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

// Read by `storytree library read <id>` in a shell, as the measured sessions did.
const shell = (id, i) => ({ kind: 'note', id, call: `b${i}`, tool: 'Bash', resident: true });
const reading = (session, notes) => ({ session, at: new Date(now).toISOString(), compactions: 0, inView: [], glimpses: [covers[30]],
  opens: notes.map(shell) });
const windows = {
  [ids.a]: reading(ids.a, opened.a),
  [ids.b]: reading(ids.b, opened.b),
  [ids.c]: { session: ids.c, at: new Date(now).toISOString(), absent: "no hook has named this session's transcript" },
};
const steps = notes => notes.slice(1).map((to, i) => `${notes[i]}>${to}`);

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
    window.__windows = data.windows;
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.seed.projects, current: 'storytree' }),
      projectTree: async () => copy(data.seed.tree),
      changesSince: async (_, cursor) => ({ changes: copy(data.seed.changes.changes.filter(change => change.seq > cursor)), cursor: data.seed.changes.changes.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.seed.lines.lines.filter(item => item.seq > cursor)), cursor: data.seed.lines.lines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(data.seed.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, holds: async () => ({ waits: {}, heldOn: {} }), waitHolds: async () => [], heldOnQuestion: async () => [],
      readSurfaces: async () => ({ ok: false }),
      windowReadings(project, sessions) { return Promise.all(sessions.map((one) => this.windowReading(project, one))); },
      windowReading: async (_, session) => {
        window.__asked.push(session);
        return copy(window.__windows[session] ?? { session, at: new Date().toISOString(), absent: 'no hook has named this session\'s transcript' });
      },
    };
  }, { seed, windows });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe, null, { timeout: 20_000 });
  for (const name of ['Close help', 'Close app menu']) {
    const close = page.getByRole('button', { name, exact: true });
    if (await close.isVisible()) await close.click();
  }
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  for (const session of Object.values(ids)) await list.locator(`.session-row[data-session-id="${session}"]`).waitFor();
  await page.locator('button[data-forest-mode="library"]').click();
  const frames = async () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); }
  });
  const drawn = () => page.evaluate(() => {
    const trails = [], lit = {}, arcs = {}, windowStates = [], glows = [];
    window.__globe.scene.traverse(object => {
      if (object.name.startsWith('knowledge-trail:')) trails.push({ step: `${object.userData.from}>${object.userData.to}`, colour: object.userData.colour, edge: object.userData.edge, visible: object.children[0]?.visible ?? false });
      if (object.name.startsWith('knowledge-point:') && object.userData.lit) {
        lit[object.userData.id] = object.userData.lit;
        if (object.userData.arcs.length > 0) arcs[object.userData.id] = object.userData.arcs;
      }
      if (object.name.startsWith('knowledge-point:') && object.userData.window) windowStates.push(object.userData.id);
      if (object.name.startsWith('knowledge-glow:') && object.visible) glows.push(object.userData.mover);
    });
    return { trails, lit, arcs, windowStates, glows };
  });
  const aim = notes => page.evaluate(notes => {
    const { scene, camera, controls } = window.__globe;
    const at = [];
    scene.traverse(o => { if (notes.includes(o.userData?.id) && o.name.startsWith('knowledge-point:')) at.push(o.getWorldPosition(o.position.clone())); });
    const centre = at.reduce((sum, p) => sum.add(p), at[0].clone().multiplyScalar(0)).multiplyScalar(1 / at.length);
    const distance = camera.position.length();
    camera.position.copy(centre.clone().normalize().multiplyScalar(distance * 0.75));
    camera.lookAt(0, 0, 0);
    controls?.update?.();
    window.__globe.invalidate();
  }, notes);
  const everyNote = [...opened.a, ...opened.b, ...logged];
  await page.waitForFunction(count => { let n = 0; window.__globe.scene.traverse(o => { if (o.userData?.lit) n++; }); return n >= count; }, new Set(everyNote).size);
  await frames();
  await aim(everyNote);
  await frames();

  // None selected: every listed session is drawn, the two with windows from their windows alone.
  const none = await drawn();
  const asked = await page.evaluate(() => [...new Set(window.__asked)].sort());
  assert.deepEqual(asked, Object.values(ids).sort(), 'every listed session\'s window is asked for');
  const colours = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, none.lit[(key === 'c' ? logged : opened[key]).find(note => note !== shared)]]));
  assert.equal(new Set(Object.values(colours)).size, 3, 'each session wears its own colour');
  for (const note of opened.a.filter(note => note !== shared)) assert.equal(none.lit[note], colours.a, 'a window\'s opens light in its session\'s colour');
  for (const note of opened.b.filter(note => note !== shared)) assert.equal(none.lit[note], colours.b);
  for (const note of logged) assert.equal(none.lit[note], colours.c, 'a session with no window lights from its log');
  assert.equal(none.lit[covers[30]], undefined, 'a glimpse lights nothing with none selected');
  assert.deepEqual([...none.arcs[shared]].sort(), [colours.a, colours.b].sort(), 'the note both opened wears one arc per session');
  const byColour = colour => none.trails.filter(trail => trail.colour === colour).map(({ step }) => step).sort();
  assert.deepEqual(byColour(colours.a), steps(opened.a).sort(), 'one line per step from the window, in its colour');
  assert.deepEqual(byColour(colours.b), steps(opened.b).sort());
  assert.deepEqual(byColour(colours.c), steps(logged).sort());
  assert.ok(none.trails.every(({ edge, visible }) => edge === null && visible), 'the reading-path curve, not the selected view\'s solid/dotted traversal');
  assert.deepEqual(none.windowStates, [], 'no selected-window drawing with none selected');
  await page.screenshot({ path: path.join(out, '0-none-selected.png') });

  // Motion on: a later reading of builder's window adds an open; its line grows from the note before, then the glow runs.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await aim([shared, added, ...opened.a]);
  await frames();
  await page.evaluate(([session, note]) => {
    const window_ = window.__windows[session];
    window.__windows[session] = { ...window_, opens: [...window_.opens, { kind: 'note', id: note, call: 'b-late', tool: 'Bash', resident: true }] };
  }, [ids.a, added]);
  const before = await page.evaluate(() => window.__asked.length);
  await page.waitForFunction(before => window.__asked.length > before, before, { timeout: 20_000 });
  const late = `${shared}>${added}`;
  // The moment the new line is first drawn, its note is still unlit.
  const atArrival = await (await page.waitForFunction(([late, id]) => {
    let seen = false, lit = null;
    window.__globe.scene.traverse(o => { if (o.name === `knowledge-trail:${late}`) seen = true; if (o.name === `knowledge-point:${id}`) lit = o.userData.lit; });
    return seen && { lit };
  }, [late, added], { polling: 'raf' })).jsonValue();
  const strip = [];
  const growing = [atArrival.lit];
  for (let i = 0; i < 10; i++) {
    strip.push((await page.screenshot({ type: 'png' })).toString('base64'));
    growing.push(await page.evaluate(id => { let lit = null; window.__globe.scene.traverse(o => { if (o.name === `knowledge-point:${id}`) lit = o.userData.lit; }); return lit; }, added));
    await page.waitForTimeout(200);
  }
  assert.equal(growing[0], null, 'the added note is unlit while its line grows toward it');
  assert.equal(growing.at(-1), colours.a, 'and lights in its session\'s colour once the line arrives');
  const png = await page.evaluate(async frames => {
    const images = await Promise.all(frames.map(src => new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.src = `data:image/png;base64,${src}`; })));
    const crop = { x: images[0].width * 0.28, y: images[0].height * 0.22, w: images[0].width * 0.44, h: images[0].height * 0.56 };
    const canvas = document.createElement('canvas');
    const scale = 0.4;
    canvas.width = crop.w * scale * 5; canvas.height = crop.h * scale * 2;
    const context = canvas.getContext('2d');
    images.forEach((image, i) => context.drawImage(image, crop.x, crop.y, crop.w, crop.h, (i % 5) * crop.w * scale, Math.floor(i / 5) * crop.h * scale, crop.w * scale, crop.h * scale));
    return canvas.toDataURL('image/png').split(',')[1];
  }, strip);
  writeFileSync(path.join(out, '1-grow-strip.png'), Buffer.from(png, 'base64'));
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-glow:') && o.visible) n++; }); return n > 0; });
  const glowing = await drawn();
  await page.screenshot({ path: path.join(out, '2-glow.png') });
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({
    asked, colours,
    lit: Object.keys(none.lit).length, rings: Object.keys(none.arcs).length, lines: none.trails.length,
    linesBySession: Object.fromEntries(Object.entries(colours).map(([key, colour]) => [ids[key], byColour(colour).length])),
    grew: late, litWhileGrowing: growing.map(colour => colour !== null), glows: glowing.glows.sort(),
  }, null, 2) + '\n');
  console.log('ADR-0754 D1 window capture passed');
} finally {
  await browser?.close();
  server.close();
}
