// Bounded browser acceptance for ADR-0878: the real desktop page, built by packages/forest/evidence/sessions-list/build.mjs, over the
// eight-story snapshot and its code survey (the traversal capture's). Seven listed sessions, none selected: six working (each
// with a prompt at a different recent time) and one idle (its turn ended well past the idle-after time, still listed). Each
// window reads two notes and a surveyed file no other window reads. With none selected the core draws only the five most
// recently seen working sessions; the oldest working one and the idle one are drawn nowhere, yet every row stays listed.
// Selecting the oldest working session's row draws its traversal in its own colour.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { sessionColour } from '../../../forest/src/agent-claims/agent-claims.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const evidence = path.join(root, 'packages/forest/src/view/evidence');
const seed = JSON.parse(readFileSync(path.join(evidence, 'knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(evidence, 'traversal/survey.json'), 'utf8'));

const KNOWLEDGE_CORE = 'story_4c04d95d52a8', FOREST = 'story_be32e99ed54f';
const CHECKOUT = '/repo';
const IDLE_AFTER_MS = 30 * 60_000, LEAVE_AFTER_MS = 60 * 60_000; // the stand-in bridge's defaults, given here explicitly
// Working sessions, most recently seen first: each one's prompt is this many minutes ago. Ids chosen for well-spread hues.
const working = [['builder', 2], ['traversal-a', 4], ['reviewer', 6], ['lane-north', 8], ['curator', 10], ['scout', 12]];
const IDLE = 'lane-south';
const ids = [...working.map(([id]) => id), IDLE];
const drawn = working.slice(0, 5).map(([id]) => id);
const undrawn = [working[5][0], IDLE];
const OLDEST = working[5][0];

const now = Date.now();
const lines = [];
const line = (session, minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1,
  at: new Date(now - minutes * 60_000).toISOString(), ...fields });
const story = id => seed.tree.stories.find(item => item.id === id);
const capabilities = [...story(KNOWLEDGE_CORE).capabilities, ...story(FOREST).capabilities].map(cap => cap.id);
const reasons = { builder: 'Draw the five latest sessions', 'traversal-a': 'Review the file circles', reviewer: 'Review the roster cut',
  'lane-north': 'Port the window replay', curator: 'Curate the decision log', scout: 'Survey the oldest lane', [IDLE]: 'Wait on the owner' };
ids.forEach((session, i) => {
  const started = session === IDLE ? 58 : 25;
  line(session, started, { kind: 'session-started' });
  line(session, started - 1, { kind: 'claimed', source: 'tool', capability: capabilities[i % capabilities.length], reason: reasons[session] });
});
for (const [session, minutes] of working) line(session, minutes, { kind: 'prompt-submitted' });
line(IDLE, 52, { kind: 'prompt-submitted' });
line(IDLE, 45, { kind: 'turn-ended' }); // past the 30-minute idle-after, inside the 60-minute leave-after
lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach((one, i) => { one.seq = i + 1; });
seed.lines = { lines, cursor: lines.length };

// Two notes and one surveyed file per session, none shared, so every lit thing names one reader.
const NOTES = ['decision_728785ea6f01', 'decision_03fd07d9014b', 'decision_98e3f55d636d', 'decision_9c5546e0993f', 'decision_88f95657e45b',
  'decision_b9ed4ced4ad5', 'decision_7f67a324a35f', 'decision_fa952bcf7f82', 'decision_5a18094c3bc8', 'decision_ae92aa6309fd',
  'decision_e9b30966b459', 'decision_ea96c9945768', 'decision_c0b6a4f875b1', 'decision_c0790d7eaa0b'];
const FILES = ['packages/knowledge-core/src/look-inside/look-inside.ts', 'packages/forest/src/view/file-circles.ts',
  'packages/knowledge-core/src/view/surface.tsx', 'packages/forest/src/sessions-list/sessions-list.ts', 'packages/knowledge-core/src/shelves/shelves.ts',
  'packages/forest/src/view/planet-view.tsx', 'packages/knowledge-core/src/view/globe-points.tsx'];
const reads = Object.fromEntries(ids.map((session, i) => [session, { notes: [NOTES[2 * i], NOTES[2 * i + 1]], file: FILES[i] }]));
const windows = Object.fromEntries(ids.map(session => {
  const { notes: [first, second], file } = reads[session];
  return [session, { session, at: new Date(now).toISOString(), compactions: 0, inView: [], glimpses: [], opens: [
    { kind: 'note', id: first, call: `${session}-1`, tool: 'Bash', resident: true },
    { kind: 'file', id: `${CHECKOUT}/${file}`, call: `${session}-2`, tool: 'Read', resident: true },
    { kind: 'note', id: second, call: `${session}-3`, tool: 'Bash', resident: true },
  ] }];
}));
const colour = Object.fromEntries(ids.map(session => [session, sessionColour(session)]));
assert.equal(new Set(Object.values(colour)).size, ids.length, 'the seven sessions wear seven colours');
const inPackage = file => file.replace(/^packages\/[^/]+\//, '');

await withCapture({ folder: here, dist: path.join(root, 'packages/forest/evidence/sessions-list/dist/production') }, async ({ browser, origin, out, settle }) => {
  const measure = page => page.evaluate(colours => {
    const { scene } = window.__globe;
    const trails = [], circles = {}, notes = {}, windowed = {};
    let Color;
    scene.traverse(object => {
      if (object.name.startsWith('knowledge-trail:')) trails.push({ from: object.userData.from, to: object.userData.to, kind: object.userData.kind ?? null, colour: object.userData.colour });
      if (object.name.startsWith('file:') && object.userData.window) {
        const fill = object.getObjectByName(`file-lit:${object.userData.file}`);
        Color = fill?.material.color.constructor ?? Color;
        circles[object.userData.file] = { window: object.userData.window, lit: !!fill, colour: fill?.material.color.getHexString() };
      }
      if (object.name.startsWith('knowledge-point:') && object.userData.lit) { notes[object.userData.id] = object.userData.lit; Color ??= object.material?.color?.constructor; }
      if (object.name.startsWith('knowledge-point:') && object.userData.window) windowed[object.userData.id] = { window: object.userData.window, colour: object.userData.colour };
    });
    const hex = Color ? Object.fromEntries(Object.entries(colours).map(([session, hsl]) => [session, new Color(hsl).getHexString()])) : {};
    return { trails, circles, notes, windowed, hex };
  }, colour);
  const rowsShown = page => page.getByRole('complementary', { name: 'Running sessions', exact: true }).locator('.session-row').evaluateAll(rows => rows.map(row => row.dataset.sessionId));

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(({ data, survey, windows, idleAfter, leaveAfter }) => {
    const copy = value => structuredClone(value);
    window.__asked = [];
    window.__windows = windows;
    let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
    window.storytreeAnswers = {
      projectSelection: async () => copy({ projects: data.projects, current }),
      chooseProject: async name => { current = name; return copy({ projects: data.projects, current }); },
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => copy(survey),
      idleAfterMs: async () => idleAfter, leaveAfterMs: async () => leaveAfter,
      windowReadings(project, sessions) { return Promise.all(sessions.map((one) => this.windowReading(project, one))); },
      windowReading: async (_, id) => { window.__asked.push(id); return copy(window.__windows[id] ?? { session: id, at: new Date().toISOString(), absent: 'no hook has named this session\'s transcript' }); },
    };
  }, { data: seed, survey, windows, idleAfter: IDLE_AFTER_MS, leaveAfter: LEAVE_AFTER_MS });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 60000 });
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  for (const name of ['Close help', 'Close app menu']) {
    const close = page.getByRole('button', { name, exact: true });
    if (await close.isVisible()) await close.click();
  }
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  const row = session => list.locator(`.session-row[data-session-id="${session}"]`);
  for (const [session] of working) await row(session).waitFor();
  // The idle session folds into the list's "1 idle" row (ADR-0758 D5); opening it shows the seventh row.
  assert.equal(await row(IDLE).count(), 0, 'the idle row is folded');
  const fold = list.getByRole('button', { name: 'Show 1 idle session', exact: true });
  await fold.click();
  await row(IDLE).waitFor();
  assert.equal(await row(IDLE).getAttribute('data-idle'), 'true', 'the seventh row is idle');
  await page.waitForFunction(count => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file-lit:')) n++; }); return n >= count; }, drawn.length, { timeout: 30000 });
  await settle(page);

  // None selected: seven rows listed, five sessions drawn.
  const listed = await rowsShown(page);
  assert.deepEqual([...listed].sort(), [...ids].sort(), 'the sessions list shows all seven rows');
  const none = await measure(page);
  const hex = none.hex;
  const drawnColours = new Set(drawn.map(session => colour[session]));
  const undrawnColours = new Set(undrawn.map(session => colour[session]));
  assert.ok(none.trails.length > 0, 'trails are drawn');
  for (const trail of none.trails) {
    assert.ok(drawnColours.has(trail.colour), `trail ${trail.from} > ${trail.to} wears a drawn session's colour (${trail.colour})`);
    assert.ok(!undrawnColours.has(trail.colour));
  }
  assert.deepEqual([...new Set(none.trails.map(trail => trail.colour))].sort(), [...drawnColours].sort(), 'each of the five draws its trails');
  const expectNotes = Object.fromEntries(drawn.flatMap(session => reads[session].notes.map(note => [note, colour[session]])));
  assert.deepEqual(none.windowed, {}, 'no window state with none selected');
  assert.deepEqual(none.notes, expectNotes, 'the five sessions\' notes light in their colours, and nothing else');
  const expectCircles = Object.fromEntries(drawn.map(session => [inPackage(reads[session].file), hex[session]]));
  const litCircles = Object.fromEntries(Object.entries(none.circles).filter(([, circle]) => circle.lit).map(([file, circle]) => [file, circle.colour]));
  assert.deepEqual(litCircles, expectCircles, 'the five sessions\' file circles light in their colours, and nothing else');
  for (const session of undrawn) {
    assert.ok(!Object.values(none.notes).includes(colour[session]), `${session}'s colour is on no note`);
    assert.ok(!Object.values(litCircles).includes(hex[session]), `${session}'s colour is on no file circle`);
  }
  const askedBefore = await page.evaluate(() => [...new Set(window.__asked)]);
  assert.ok(undrawn.every(session => !askedBefore.includes(session)), 'an undrawn session\'s window is not read');
  await page.screenshot({ path: path.join(out, '0-none-selected.png'), timeout: 180000 });

  // Select the oldest working session: its traversal draws in its colour.
  await row(OLDEST).click();
  assert.equal(await row(OLDEST).getAttribute('data-selected'), 'true');
  const target = reads[OLDEST].notes;
  await page.waitForFunction(([notes, hsl]) => {
    const lit = {}; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-point:') && o.userData.window) lit[o.userData.id] = o.userData.colour; });
    return notes.every(note => lit[note] === hsl);
  }, [target, colour[OLDEST]], { timeout: 30000 }).catch(async error => {
    console.log('after selection:', JSON.stringify({ seen: await measure(page), asked: await page.evaluate(() => window.__asked.slice(-10)) }));
    throw error;
  });
  await settle(page);
  const one = await measure(page);
  assert.deepEqual(Object.keys(one.windowed).sort(), [...reads[OLDEST].notes].sort(), 'the selection draws its notes alone');
  assert.ok(Object.values(one.windowed).every(note => note.colour === colour[OLDEST]), 'in its colour');
  assert.deepEqual(one.notes, {}, 'no roster lighting while one is selected');
  assert.equal(one.trails.length, 2, 'its two steps are drawn');
  assert.ok(one.trails.every(trail => trail.colour === colour[OLDEST]), 'its trails wear its colour');
  const oneLit = Object.entries(one.circles).filter(([, circle]) => circle.lit);
  assert.deepEqual(oneLit.map(([file, circle]) => [file, circle.colour]), [[inPackage(reads[OLDEST].file), hex[OLDEST]]], 'its file circle lights in its colour');
  assert.deepEqual((await rowsShown(page)).sort(), [...ids].sort(), 'still seven rows');
  await page.screenshot({ path: path.join(out, '1-oldest-selected.png'), timeout: 180000 });

  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({
    listed, drawn, undrawn, colours: colour, hex, askedBeforeSelection: askedBefore,
    noneSelected: { notes: none.notes, litCircles, trails: none.trails },
    oldestSelected: { session: OLDEST, notes: one.windowed, litCircles: Object.fromEntries(oneLit.map(([file, circle]) => [file, circle.colour])), trails: one.trails },
  }, null, 2) + '\n');
  console.log(JSON.stringify({ listed: listed.length, trails: none.trails.length, notes: Object.keys(none.notes).length, circles: Object.keys(litCircles).length, selectedTrails: one.trails.length }));
});
