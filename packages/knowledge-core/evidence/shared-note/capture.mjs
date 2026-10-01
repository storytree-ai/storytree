// Bounded browser acceptance for ADR-0754 D2: the real desktop page, built by
// packages/forest/evidence/sessions-list/build.mjs, over the read-only forest snapshot. Three
// synthetic running sessions converge on the same real notes: each such note's dot wears the
// session that read it last, and a thin ring carries one arc per session in the order they
// arrived. A new read's arc appears only once its line reaches the note.
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
// Ids chosen so the three sessions' colours sit far apart on the wheel, as in ../all-sessions.
const ids = { a: 'builder', b: 'traversal-a', c: 'librarian' };
// All three reach covers[3] and covers[4]: a first, then b, then c; b reads covers[4] once more, last.
const reads = {
  a: covers.slice(0, 6),
  b: [...covers.slice(10, 14), covers[3], covers[4]],
  c: [...covers.slice(20, 24), covers[4], covers[3]],
};
const now = Date.now();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: new Date(now - minutes * 60_000).toISOString(), ...fields });
}
for (const session of Object.values(ids)) line(session, 30, { kind: 'session-started' });
line(ids.a, 20, { kind: 'claimed', source: 'tool', capability: forest.capabilities[0].id, reason: 'Build the traversal view' });
line(ids.b, 20, { kind: 'claimed', source: 'tool', capability: app.capabilities[0].id, reason: 'Review the app' });
line(ids.c, 20, { kind: 'claimed', source: 'tool', capability: librarian.capabilities[0].id, reason: 'Check the library links' });
const read = (session, note, minutes) => line(session, minutes, { kind: 'note-read', source: 'tool', note, found: 'search', read: 'whole', agent: 'orchestrator' });
reads.a.forEach((note, i) => read(ids.a, note, 15 - i * 0.1));
reads.b.forEach((note, i) => read(ids.b, note, 12 - i * 0.1));
reads.c.forEach((note, i) => read(ids.c, note, 9 - i * 0.1));
read(ids.b, covers[4], 6);
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

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
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 3, colorScheme: 'dark', reducedMotion: 'reduce' });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.__lines = data.lines.lines;
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: copy(data.changes.changes.filter(change => change.seq > cursor)), cursor: data.changes.changes.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(window.__lines.filter(item => item.seq > cursor)), cursor: window.__lines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
      // Unread surfaces are all on (ADR-0750).
      readSurfaces: async () => ({ ok: false }),
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe, null, { timeout: 20_000 }).catch(async error => {
    throw new Error(`the page did not get ready: state ${await page.evaluate(() => document.body.dataset.state + ': ' + document.body.innerText.replace(/\s+/g, ' ').slice(-500))}, globe ${await page.evaluate(() => Boolean(window.__globe))}; errors: ${errors.join(' | ') || 'none'}`, { cause: error });
  });
  for (const name of ['Close help', 'Close app menu']) {
    const close = page.getByRole('button', { name, exact: true });
    if (await close.isVisible()) await close.click();
  }
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  const row = session => list.locator(`.session-row[data-session-id="${session}"]`);
  await row(ids.a).waitFor();
  await page.locator('button[data-forest-mode="library"]').click();
  const frames = async () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); }
  });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.userData?.lit) n++; }); return n > 0; });
  await frames();
  const dot = note => page.evaluate(note => {
    let found;
    window.__globe.scene.traverse(o => { if (o.name === `knowledge-point:${note}`) found = { lit: o.userData.lit, arcs: o.userData.arcs }; });
    let ring = null;
    window.__globe.scene.traverse(o => { if (o.name === `knowledge-arcs:${note}`) ring = o.userData.arcs; });
    return { ...found, ring };
  }, note);
  const swatch = session => row(session).locator('.session-colour').evaluate(node => getComputedStyle(node).backgroundColor);
  const rgb = colour => page.evaluate(colour => { const probe = document.createElement('span'); probe.style.color = colour; document.body.append(probe);
    const value = getComputedStyle(probe).color; probe.remove(); return value; }, colour);
  const rgbs = colours => Promise.all(colours.map(rgb));
  const [a, b, c] = await Promise.all([swatch(ids.a), swatch(ids.b), swatch(ids.c)]);
  // A close crop around a note, from the 3x page, so its ring can be seen.
  const close = async (note, file) => {
    const at = await page.evaluate(note => {
      const { scene, camera, size } = window.__globe;
      let point;
      scene.traverse(o => { if (o.name === `knowledge-point:${note}`) point = o; });
      const v = point.getWorldPosition(point.position.clone()).project(camera);
      const box = document.querySelector('canvas').getBoundingClientRect();
      return { x: box.left + (v.x + 1) / 2 * size.width, y: box.top + (1 - v.y) / 2 * size.height };
    }, note);
    await page.screenshot({ path: path.join(out, file), clip: { x: at.x - 120, y: at.y - 80, width: 240, height: 160 } });
  };

  // Converged: covers[3] was reached by a, then b, then c, and c read it last.
  const three = await dot(covers[3]);
  assert.equal(await rgb(three.lit), c, "the dot wears the session that read it last");
  assert.deepEqual(await rgbs(three.arcs), [a, b, c], 'one arc per session, in arrival order');
  assert.deepEqual(three.ring, three.arcs, 'the ring draws those arcs');
  const four = await dot(covers[4]);
  assert.equal(await rgb(four.lit), b, 'b read covers[4] again, last');
  assert.deepEqual(await rgbs(four.arcs), [a, b, c], 'arrival order, not latest order');
  const alone = await dot(covers[0]);
  assert.deepEqual([alone.arcs, alone.ring], [[], null], 'one reader, no ring');
  let white = 0;
  await page.evaluate(() => 0);
  white = await page.evaluate(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.material?.color?.getHexString?.() === 'ffffff' && o.geometry?.type === 'SphereGeometry') n++; }); return n; });
  assert.equal(white, 0, 'the white shared halo is gone');
  await page.screenshot({ path: path.join(out, 'converged-overview.png') });
  await close(covers[3], 'converged-close.png');
  await close(covers[4], 'converged-close-latest-b.png');

  // Live: a reads covers[12], which only b has read. Its line grows; a's arc waits for it.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(([session, note]) => {
    const last = window.__lines.at(-1);
    window.__lines.push({ project: 'storytree', source: 'tool', harness: 'claude-code', session, seq: last.seq + 1, at: new Date().toISOString(),
      kind: 'note-read', note, found: 'search', read: 'whole', agent: 'orchestrator' });
  }, [ids.a, covers[12]]);
  await page.waitForFunction(([from, to]) => { let part = false; window.__globe.scene.traverse(o => { if (o.name === `knowledge-trail:${from}>${to}` && o.children[0].visible) part = true; }); return part; }, [reads.a.at(-1), covers[12]]);
  const waiting = await dot(covers[12]);
  assert.equal(await rgb(waiting.lit), b, "while a's line grows, the dot is still b's");
  assert.deepEqual([waiting.arcs, waiting.ring], [[], null], "and a's arc has not appeared");
  await close(covers[12], 'arrival-growing.png');
  await page.waitForTimeout(1500);
  await frames();
  const reached = await dot(covers[12]);
  assert.equal(await rgb(reached.lit), a, 'the line arrives: the dot turns a');
  assert.deepEqual(await rgbs(reached.arcs), [b, a], "and a's arc joins b's");
  await close(covers[12], 'arrival-reached.png');
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({
    converged: { [covers[3]]: { dot: ids.c, arcs: [ids.a, ids.b, ids.c] }, [covers[4]]: { dot: ids.b, arcs: [ids.a, ids.b, ids.c] } },
    arrival: { note: covers[12], before: { dot: ids.b, arcs: [] }, after: { dot: ids.a, arcs: [ids.b, ids.a] } },
    whiteHalos: white,
  }, null, 2) + '\n');
  console.log('ADR-0754 D2 capture passed');
} finally {
  await browser?.close();
  server.close();
}
