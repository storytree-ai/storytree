// Bounded browser acceptance for ADR-0738: the real desktop page, built by
// packages/forest/evidence/sessions-list/build.mjs, over the read-only forest snapshot with three
// synthetic running sessions reading real notes. With no session selected the globe's knowledge
// dots light in each listed session's colour; clicking a row drills into that session alone.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, fakeBridge } from '../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const root = path.resolve(here, '../../../..');
const built = path.join(root, 'packages/forest/evidence/sessions-list/dist/production');
const seed = JSON.parse(readFileSync(path.join(root, 'packages/forest/src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const story = title => seed.tree.stories.find(item => item.title === title);
const forest = story('The forest'), app = story('The app'), librarian = story('The librarian');
// Shelf-placed notes, in a stable order, so each session reads real dots under real islands.
const covers = [...new Set(seed.changes.changes.filter(change => change.record.fields?.frontCoverOf).map(change => change.recordId))].sort();
// Ids chosen so the three sessions' colours sit far apart on the wheel (cyan, violet, orange).
const ids = { a: 'builder', b: 'traversal-a', c: 'librarian', lane: 'builder-lane' };
const reads = { a: covers.slice(0, 14), lane: covers.slice(24, 30), b: covers.slice(10, 24), c: covers.slice(40, 52) };
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(session, minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: at(minutes), ...fields });
}
const claim = (session, capability, reason) => line(session, 20, { kind: 'claimed', source: 'tool', capability, reason });
for (const session of [ids.a, ids.b, ids.c]) line(session, 30, { kind: 'session-started' });
claim(ids.a, forest.capabilities[0].id, 'Build the traversal view');
claim(ids.b, app.capabilities[0].id, 'Review the app');
claim(ids.c, librarian.capabilities[0].id, 'Check the library links');
line(ids.a, 18, { kind: 'subagent-started', subagent: ids.lane, type: 'explorer', task: 'Sweep the decisions' });
const read = (session, note, agent, minutes) => line(session, minutes, { kind: 'note-read', source: 'tool', note, found: 'search', read: 'whole', agent });
reads.a.forEach((note, i) => read(ids.a, note, 'orchestrator', 15 - i * 0.1));
reads.lane.forEach((note, i) => read(ids.a, note, { subagent: ids.lane, type: 'explorer' }, 12 - i * 0.1));
reads.b.forEach((note, i) => read(ids.b, note, 'orchestrator', 10 - i * 0.1));
reads.c.forEach((note, i) => read(ids.c, note, 'orchestrator', 8 - i * 0.1));
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? 'file:///C:/code/storytree/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs');
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['index.html', 'renderer.js', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(path.join(built, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLANET_CHROMIUM
    ?? path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-win64/chrome-headless-shell.exe'), headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
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
    // The test appends reads here later, as a live session would (ADR-0741 flights).
    window.__lines = data.lines.lines;
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => ({ changes: copy(data.changes.changes.filter(change => change.seq > cursor)), cursor: data.changes.changes.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(window.__lines.filter(item => item.seq > cursor)), cursor: window.__lines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
    };
  }, seed);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe);
  const closeHelp = page.getByRole('button', { name: 'Close help', exact: true });
  if (await closeHelp.isVisible()) await closeHelp.click();
  // The app menu (#183) opens over a fresh page with no saved state; the forest is what this checks.
  const closeMenu = page.getByRole('button', { name: 'Close app menu', exact: true });
  if (await closeMenu.isVisible()) await closeMenu.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  const row = session => list.locator(`.session-row[data-session-id="${session}"]`);
  await row(ids.a).waitFor();
  await page.locator('button[data-forest-mode="library"]').click();
  const frames = async () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); }
  });
  const dots = () => page.evaluate(() => {
    const found = [];
    window.__globe.scene.traverse(object => {
      if (!object.name.startsWith('knowledge-point:')) return;
      found.push({ id: object.userData.id, lit: object.userData.lit, shared: object.userData.arcs.length > 0 });
    });
    return found;
  });
  const swatch = session => row(session).locator('.session-colour').evaluate(node => getComputedStyle(node).backgroundColor);
  const rgb = colour => page.evaluate(colour => { const probe = document.createElement('span'); probe.style.color = colour; document.body.append(probe);
    const value = getComputedStyle(probe).color; probe.remove(); return value; }, colour);
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.userData?.lit) n++; }); return n > 0; });
  await frames();

  // No session selected: every listed session lights what it read, in its row's colour.
  const all = await dots();
  const litBy = new Map(all.filter(dot => dot.lit).map(dot => [dot.id, dot]));
  const expected = new Set([...reads.a, ...reads.lane, ...reads.b, ...reads.c]);
  assert.deepEqual([...litBy.keys()].sort(), [...expected].sort(), 'every listed session\'s reads light, and nothing else');
  assert.equal(await rgb(litBy.get(reads.a[0]).lit), await swatch(ids.a), 'a note wears its reader\'s row colour');
  assert.equal(await rgb(litBy.get(reads.lane[5]).lit), await swatch(ids.a), 'a subagent\'s read wears its parent session\'s colour');
  assert.equal(await rgb(litBy.get(reads.c[0]).lit), await swatch(ids.c));
  const shared = [...litBy.values()].filter(dot => dot.shared).map(dot => dot.id).sort();
  assert.deepEqual(shared, covers.slice(10, 14).sort(), 'notes two sessions read are shared');
  const curves = () => page.evaluate(() => {
    const found = [];
    window.__globe.scene.traverse(object => { if (object.name.startsWith('knowledge-trail:')) found.push(object.userData); });
    return found;
  });
  // Every listed session's path draws, one curve per step, in its colour (ADR-0740).
  const allCurves = await curves();
  const steps = notes => notes.slice(1).map((note, i) => `${notes[i]}>${note}`);
  assert.deepEqual(allCurves.map(c => `${c.from}>${c.to}`).sort(),
    [...steps(reads.a), ...steps(reads.lane), ...steps(reads.b), ...steps(reads.c)].sort(), "one curve per step of each agent's reading order");
  assert.equal(await rgb(allCurves.find(c => c.from === reads.c[0]).colour), await swatch(ids.c), "a curve wears its session's colour");
  await page.screenshot({ path: path.join(out, 'all-sessions.png') });

  // Click a row: the core drills into that session alone, the row marked selected.
  await row(ids.b).click();
  await frames();
  assert.equal(await row(ids.b).getAttribute('data-selected'), 'true');
  const one = (await dots()).filter(dot => dot.lit);
  assert.deepEqual(one.map(dot => dot.id).sort(), [...reads.b].sort(), 'a selection lights that session alone');
  assert.ok(one.every(dot => !dot.shared));
  assert.equal(await rgb(one.find(dot => dot.id === reads.b[0]).lit), await swatch(ids.b), 'its orchestrator wears its colour');
  assert.equal((await curves()).length, reads.b.length - 1, "a selection draws that session's path alone");
  await page.screenshot({ path: path.join(out, 'one-session.png') });

  // Drill into the session with a subagent: the subagent wears a shade of the same hue.
  await row(ids.a).click();
  await frames();
  const drilled = new Map((await dots()).filter(dot => dot.lit).map(dot => [dot.id, dot.lit]));
  const hue = colour => /^hsl\((\d+),/.exec(colour)?.[1];
  assert.equal(hue(drilled.get(reads.lane[5])), hue(drilled.get(reads.a[0])), 'same hue');
  assert.notEqual(drilled.get(reads.lane[5]), drilled.get(reads.a[0]), 'a different shade');
  await page.screenshot({ path: path.join(out, 'drill-in-shades.png') });

  // Click it again: back to every running session.
  await row(ids.a).click();
  await frames();
  assert.equal((await dots()).filter(dot => dot.lit).length, expected.size, 'clicking the selected row again shows every session');
  assert.equal(await row(ids.a).getAttribute('data-selected'), null);
  assert.deepEqual(errors, []);
  // A new read arrives: its step's line grows, and each agent's path glows in a loop (ADR-0742).
  const readNext = note => page.evaluate(([session, note]) => {
    const last = window.__lines.at(-1);
    window.__lines.push({ project: 'storytree', source: 'tool', harness: 'claude-code', session, seq: last.seq + 1, at: new Date().toISOString(),
      kind: 'note-read', note, found: 'search', read: 'whole', agent: 'orchestrator' });
  }, [ids.c, note]);
  const glows = () => page.evaluate(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-glow:') && o.visible) n++; }); return n; });
  // How far along its curve a step's line is drawn: 0 not yet, 1 whole.
  const drawn = (from, to) => page.evaluate(([from, to]) => {
    let line, end;
    window.__globe.scene.traverse(o => { if (o.name === `knowledge-trail:${from}>${to}`) line = o.children[0]; if (o.userData?.id === to) end = o.position; });
    if (line === undefined || !line.visible) return 0;
    const tip = line.geometry.attributes.instanceEnd, i = tip.count - 1;
    return end.distanceTo({ x: tip.getX(i), y: tip.getY(i), z: tip.getZ(i) }) < 0.01 ? 1 : 0.5;
  }, [from, to]);
  // With reduced motion (this page's setting) nothing moves: no glow, and a new step is drawn whole at once.
  assert.equal(await glows(), 0, 'reduced motion never glows');
  await readNext(covers[60]);
  await page.waitForFunction(([from, to]) => { let found = false; window.__globe.scene.traverse(o => { if (o.name === `knowledge-trail:${from}>${to}`) found = true; }); return found; }, [reads.c.at(-1), covers[60]]);
  assert.equal(await drawn(reads.c.at(-1), covers[60]), 1, 'drawn whole at once');
  // With motion allowed the next step grows from its earlier read to its later one, and the paths glow in a loop.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await readNext(covers[62]);
  await page.waitForFunction(([from, to]) => { let part = false; window.__globe.scene.traverse(o => { if (o.name === `knowledge-trail:${from}>${to}` && o.children[0].visible) part = true; }); return part; }, [covers[60], covers[62]]);
  assert.equal(await drawn(covers[60], covers[62]), 0.5, 'caught growing, short of its later read');
  const litNow = note => page.evaluate(note => { let lit = null; window.__globe.scene.traverse(o => { if (o.userData?.id === note && o.name.startsWith('knowledge-point:')) lit = o.userData.lit; }); return lit; }, covers[62]);
  assert.equal(await litNow(), null, 'the new note waits, unlit, for its line');
  await page.screenshot({ path: path.join(out, 'path-growing.png') });
  await page.waitForTimeout(1500);
  assert.equal(await drawn(covers[60], covers[62]), 1, 'then whole');
  assert.equal(await rgb(await litNow()), await swatch(ids.c), 'and the note lights as the line arrives');
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-glow:') && o.visible) n++; }); return n > 0; });
  await page.screenshot({ path: path.join(out, 'path-glow.png') });
  const heads = await page.evaluate(() => {
    let n = 0;
    window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-trail:')) o.traverse(c => { if (c.geometry?.type === 'ConeGeometry') n++; }); });
    return { n };
  });
  assert.equal(heads.n, 0, 'paths carry no arrowheads');
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({
    sessions: Object.fromEntries(Object.entries(reads).map(([key, notes]) => [ids[key], notes.length])),
    litWithNoneSelected: expected.size, shared: shared.length, litWhenBSelected: one.length,
  }, null, 2) + '\n');
  console.log('ADR-0738 capture passed: ' + JSON.stringify({ lit: expected.size, shared: shared.length, selected: one.length }));
} finally {
  await browser?.close();
  server.close();
}
