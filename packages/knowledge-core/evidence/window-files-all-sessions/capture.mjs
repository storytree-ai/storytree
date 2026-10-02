// Bounded browser acceptance for ADR-0875: the real desktop page, built by packages/forest/evidence/sessions-list/build.mjs, over the
// eight-story snapshot and its code survey (the traversal capture's). Two running sessions, none
// selected, whose window readings (agent link 9.10) interleave note opens and code-file opens. Each
// surveyed file a window opened lights its flat circle on the land in that session's colour, with no
// in-view ring; a file-to-file step is a hop over the land, a file-to-note step a dive into the core.
// Both opened forest's file-circles.ts: it wears the colour of the session whose open of it was seen
// latest, so a later reading in which the other session opens it again hands the circle to that one.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const evidence = path.join(root, 'packages/forest/src/view/evidence');
const seed = JSON.parse(readFileSync(path.join(evidence, 'knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(evidence, 'traversal/survey.json'), 'utf8'));

const KNOWLEDGE_CORE = 'story_4c04d95d52a8', FOREST = 'story_be32e99ed54f';
const CLAIMS_NOTE = 'decision_88f95657e45b', HOOKS_NOTE = 'decision_98e3f55d636d', THIRD_NOTE = 'decision_0aa9bd1f4dd2';
const CHECKOUT = '/repo';
const ids = { a: 'builder', b: 'traversal-a' };
const now = Date.now();
const lines = [];
const line = (session, minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1,
  at: new Date(now - minutes * 60_000).toISOString(), ...fields });
const story = id => seed.tree.stories.find(item => item.id === id);
for (const session of Object.values(ids)) line(session, 30, { kind: 'session-started' });
line(ids.a, 20, { kind: 'claimed', source: 'tool', capability: story(KNOWLEDGE_CORE).capabilities[0].id, reason: 'Light the code with none selected' });
line(ids.b, 20, { kind: 'claimed', source: 'tool', capability: story(FOREST).capabilities[0].id, reason: 'Review the file circles' });
seed.lines = { lines, cursor: lines.length };

const file = (pkg, rest, call) => ({ kind: 'file', id: `${CHECKOUT}/packages/${pkg}/${rest}`, call, tool: 'Read', resident: true });
const note = (id, call) => ({ kind: 'note', id, call, tool: 'Bash', resident: true });
const K = 'knowledge-core', F = 'forest';
const shared = `packages/${F}/src/view/file-circles.ts`;
const windows = {
  [ids.a]: { session: ids.a, at: new Date(now).toISOString(), compactions: 0, inView: [], glimpses: [], opens: [
    file(K, 'src/look-inside/look-inside.ts', 'a1'), file(K, 'src/view/surface.tsx', 'a2'), note(CLAIMS_NOTE, 'a3'),
    file(K, 'src/view/globe-points.tsx', 'a4'), file(F, 'src/view/file-circles.ts', 'a5'),
  ] },
  [ids.b]: { session: ids.b, at: new Date(now).toISOString(), compactions: 0, inView: [], glimpses: [], opens: [
    note(HOOKS_NOTE, 'b1'), file(F, 'src/view/planet-view.tsx', 'b2'), file(F, 'src/view/file-circles.ts', 'b3'),
    file(F, 'src/view/forest-view.tsx', 'b4'), note(THIRD_NOTE, 'b5'),
  ] },
};
const key = open => open.kind === 'file' ? `file:${open.id.slice(CHECKOUT.length + 1)}` : open.id;
const files = session => [...new Set(windows[session].opens.filter(open => open.kind === 'file').map(key))];
const steps = session => windows[session].opens.slice(1).map((to, i) => {
  const from = windows[session].opens[i];
  return [key(from), key(to), from.kind === 'file' && to.kind === 'file' ? 'hop' : from.kind === 'file' || to.kind === 'file' ? 'dive' : null];
});

await withCapture({ folder: here, dist: path.join(root, 'packages/forest/evidence/sessions-list/dist/production') }, async ({ browser, origin, out, settle }) => {
  const measure = page => page.evaluate(() => {
    const { scene } = window.__globe;
    const trails = [], circles = {}, rings = [], notes = {};
    let Color;
    scene.traverse(object => {
      if (object.name.startsWith('knowledge-trail:')) trails.push({ name: object.name, from: object.userData.from, to: object.userData.to, kind: object.userData.kind ?? null, colour: object.userData.colour, visible: object.children[0]?.visible ?? false });
      if (object.name.startsWith('file:') && object.userData.window) {
        const fill = object.getObjectByName(`file-lit:${object.userData.file}`);
        Color = fill?.material.color.constructor ?? Color;
        circles[object.userData.file] = { window: object.userData.window, lit: !!fill, colour: fill?.material.color.getHexString(), opacity: fill?.material.opacity };
      }
      if (object.name.startsWith('file-ring:')) rings.push(object.name);
      if (object.name.startsWith('knowledge-point:') && object.userData.lit) notes[object.userData.id] = object.userData.lit;
    });
    const hex = Object.fromEntries(Object.entries(notes).map(([id, hsl]) => [id, Color ? new Color(hsl).getHexString() : hsl]));
    return { trails, circles, rings, notes, hex };
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(({ data, survey, windows }) => {
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
      windowReadings(project, sessions) { return Promise.all(sessions.map((one) => this.windowReading(project, one))); },
      windowReading: async (_, id) => { window.__asked.push(id); return copy(window.__windows[id] ?? { session: id, at: new Date().toISOString(), absent: 'no hook has named this session\'s transcript' }); },
    };
  }, { data: seed, survey, windows });
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
  for (const session of Object.values(ids)) await list.locator(`.session-row[data-session-id="${session}"]`).waitFor();
  const everyFile = new Set([...files(ids.a), ...files(ids.b)]).size;
  await page.waitForFunction(count => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file-lit:')) n++; }); return n >= count; }, everyFile, { timeout: 30000 });
  await settle(page);

  // None selected: both sessions' code reads drawn from their windows.
  const none = await measure(page);
  const colour = { a: none.hex[CLAIMS_NOTE], b: none.hex[HOOKS_NOTE] };
  assert.ok(colour.a && colour.b && colour.a !== colour.b, 'each session lights its notes in its own colour');
  // A circle's userData.file is its path inside its package; the opened files' names are unique across the two packages.
  const circleOf = fileKey => Object.entries(none.circles).find(([file]) => fileKey.endsWith(`/${file}`))?.[1];
  for (const [session, wear] of [[ids.a, colour.a], [ids.b, colour.b]]) {
    for (const fileKey of files(session)) {
      const circle = circleOf(fileKey);
      assert.ok(circle?.lit, `${fileKey} is lit`);
      assert.equal(circle.window, 'read', `${fileKey} is lit as a read with none selected`);
      if (!fileKey.endsWith(shared)) assert.equal(circle.colour, wear, `${fileKey} wears its reader's colour`);
    }
  }
  assert.equal(Object.keys(none.circles).length, everyFile, 'only the opened files light');
  assert.deepEqual(none.rings, [], 'no in-view ring with none selected');
  const sharedFirst = circleOf(`file:${shared}`).colour;
  assert.ok([colour.a, colour.b].includes(sharedFirst), 'the file both opened wears one of their colours');
  const codeTrails = none.trails.filter(trail => trail.name.startsWith('knowledge-trail:file:'));
  assert.ok(codeTrails.length > 0 && codeTrails.every(trail => ['hop', 'dive'].includes(trail.kind)), 'trails from a file are hops or dives');
  const drawnSteps = none.trails.map(({ from, to, kind }) => [from, to, kind]);
  for (const session of Object.values(ids)) for (const step of steps(session)) assert.ok(drawnSteps.some(drawn => JSON.stringify(drawn) === JSON.stringify(step)), `step ${step.join(' > ')} is drawn`);
  await page.screenshot({ path: path.join(out, '0-none-selected.png'), timeout: 180000 });

  const baseZoom = await page.evaluate(() => window.__globe.camera.zoom);
  const faceIt = async (id, zoom) => {
    await page.evaluate(({ id, zoom }) => {
      const { scene, camera, invalidate } = window.__globe, { rotation, onRotate } = window.__nav;
      const V = camera.position.constructor, Q = camera.quaternion.constructor;
      const at = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize();
      onRotate(new Q().setFromUnitVectors(at, camera.position.clone().normalize()).multiply(rotation));
      camera.zoom = zoom; camera.updateProjectionMatrix();
      invalidate();
    }, { id, zoom });
    await settle(page);
  };
  await faceIt(KNOWLEDGE_CORE, baseZoom * 2.4);
  await page.screenshot({ path: path.join(out, '1-knowledge-core.png'), timeout: 180000 });

  // A later reading: the session not wearing the shared file opens it again, and it takes the circle.
  const later = sharedFirst === colour.a ? 'b' : 'a';
  await page.evaluate(([session, id]) => {
    const window_ = window.__windows[session];
    window.__windows[session] = { ...window_, opens: [...window_.opens, { kind: 'file', id, call: 'late', tool: 'Read', resident: true }] };
  }, [ids[later], `${CHECKOUT}/${shared}`]);
  const asked = await page.evaluate(() => window.__asked.length);
  await page.waitForFunction(asked => window.__asked.length > asked, asked, { timeout: 30000 });
  await page.waitForFunction(([file, hex]) => {
    let wear; window.__globe.scene.traverse(o => { if (o.name === `file-lit:${file}`) wear = o.material.color.getHexString(); });
    return wear === hex;
  }, [shared.replace(`packages/${F}/`, ''), colour[later]], { timeout: 30000 }).catch(() => undefined);
  await faceIt(FOREST, baseZoom * 5);
  const after = await measure(page);
  const sharedAfter = Object.entries(after.circles).find(([file]) => shared.endsWith(file))?.[1];
  assert.equal(sharedAfter?.colour, colour[later], 'the file both opened wears its latest reader\'s colour');
  assert.deepEqual(after.rings, []);
  await page.screenshot({ path: path.join(out, '2-forest-later-reader.png'), timeout: 180000 });

  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({
    sessions: ids, colours: colour,
    litCircles: none.circles, rings: none.rings,
    codeTrails: codeTrails.map(({ from, to, kind, colour }) => ({ from, to, kind, colour })),
    shared: { file: shared, first: sharedFirst, laterReader: ids[later], after: sharedAfter.colour },
  }, null, 2) + '\n');
  console.log(JSON.stringify({ circles: Object.keys(none.circles).length, codeTrails: codeTrails.length, trails: none.trails.length, sharedFirst, after: sharedAfter.colour, colour }));
});
