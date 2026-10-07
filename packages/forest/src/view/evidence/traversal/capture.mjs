// Seeded, repeatable capture of the actual desktop page (ADR-0804 D5): the eight-story snapshot, its code
// survey (survey.json), and one running session whose window (agent link 9.10) is fixed below: same seed,
// same 1440 x 960 viewport, same programmatic turns and zoom; nothing is hand-panned. Reduced motion, so the
// replay's finished picture is what is drawn. Measures what can be counted before anyone looks, writes
// measurements.json. Run under `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --` after `node build.mjs`.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));

const AGENT_LINK = 'story_05e45963ca9f', KNOWLEDGE_CORE = 'story_4c04d95d52a8', FOREST = 'story_be32e99ed54f';
const CHECKOUT = path.resolve(here, '../../../../../..');
const CLAIMS_NOTE = 'decision_88f95657e45b', HOOKS_NOTE = 'decision_98e3f55d636d';
const LOOK_INSIDE_CAPABILITY = 'capability_83d80a307e18';
const session = 'builder';
const now = Date.now();
const lines = [];
const line = (minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1,
  at: new Date(now - minutes * 60_000).toISOString(), ...fields });
line(30, { kind: 'session-started' });
line(20, { kind: 'claimed', source: 'tool', capability: LOOK_INSIDE_CAPABILITY, reason: 'Build the traversal over the code' });
seed.lines = { lines, cursor: lines.length };

// One session: it reads the knowledge core's code, dips into two notes, crosses to the forest and back to the agent link.
const file = (pkg, rest, resident = true, call = `f-${pkg}-${rest}`) => ({ kind: 'file', id: `${CHECKOUT}/packages/${pkg}/${rest}`, call, tool: 'Read', resident });
const note = (id, resident = true) => ({ kind: 'note', id, call: `open ${id}`, tool: 'mcp__storytree__open', resident });
const reading = {
  session, at: new Date(now).toISOString(), compactions: 1, inView: [], glimpses: [],
  opens: [
    file('knowledge-core', 'src/ghosts/ghosts.ts', false),
    note(LOOK_INSIDE_CAPABILITY),
    note('arc_f59eb2a8e34d'), note('increment_d02249eaf5a4'),
    file('knowledge-core', 'src/look-inside/look-inside.ts'),
    file('knowledge-core', 'src/view/surface.tsx'),
    file('knowledge-core', 'src/view/globe-points.tsx'),
    file('knowledge-core', 'src/reads/reads.ts'),
    note(CLAIMS_NOTE),
    note(HOOKS_NOTE),
    file('forest', 'src/view/planet-view.tsx'),
    file('forest', 'src/view/file-circles.ts'),
    { kind: 'file', id: `${CHECKOUT}/scripts/gate.mjs`, call: 'f-gate', tool: 'Read', resident: true },
    file('agent-link', 'src/context/window.ts'),
  ],
};
const K = 'knowledge-core', F = 'forest', A = 'agent-link';
const expected = [
  // [from, to, edge, kind, faded]
  [`file:packages/${K}/src/ghosts/ghosts.ts`, `file:packages/${K}/src/look-inside/look-inside.ts`, 'solid', 'hop', true],
  [`file:packages/${K}/src/look-inside/look-inside.ts`, `file:packages/${K}/src/view/surface.tsx`, 'solid', 'hop', false],
  [`file:packages/${K}/src/view/surface.tsx`, `file:packages/${K}/src/view/globe-points.tsx`, 'solid', 'hop', false],
  [`file:packages/${K}/src/view/globe-points.tsx`, `file:packages/${K}/src/reads/reads.ts`, 'dotted', 'hop', false],
  [`file:packages/${K}/src/reads/reads.ts`, CLAIMS_NOTE, 'dotted', 'dive', false],
  [CLAIMS_NOTE, HOOKS_NOTE, 'dotted', null, false],
  [HOOKS_NOTE, `file:packages/${F}/src/view/planet-view.tsx`, 'dotted', 'dive', false],
  [`file:packages/${F}/src/view/planet-view.tsx`, `file:packages/${F}/src/view/file-circles.ts`, 'solid', 'hop', false],
  [`file:packages/${F}/src/view/file-circles.ts`, `file:packages/${A}/src/context/window.ts`, 'dotted', 'hop', false],
];

await withCapture({ folder: here, dist: path.join(here, 'dist') }, async ({ browser, origin, out, settle }) => {

/** What the scene draws of the traversal: the steps' lines, the lit circles and territories, the rings, and how high each line runs above the surface, all counted. */
const measure = page => page.evaluate(() => {
  const { scene, camera, size } = window.__globe;
  scene.updateMatrixWorld(true);
  const V = camera.position.constructor;
  const trails = [], circles = [], rings = [], territories = [];
  const surface = (() => { let r = 0; scene.traverse(o => { if (o.name === 'planet:shell') r = o.geometry.parameters.radius; }); return r; })();
  const toPx = p => { const q = p.clone().project(camera); return [(q.x + 1) * size.width / 2, (1 - q.y) * size.height / 2]; };
  scene.traverse(object => {
    if (object.name.startsWith('knowledge-trail:')) {
      const line = object.children[0];
      const start = line.geometry.attributes.instanceStart, end = line.geometry.attributes.instanceEnd;
      const radii = [];
      for (let i = 0; i < start.count; i++) radii.push(Math.hypot(start.getX(i), start.getY(i), start.getZ(i)), Math.hypot(end.getX(i), end.getY(i), end.getZ(i)));
      trails.push({ from: object.userData.from, to: object.userData.to, edge: object.userData.edge, kind: object.userData.kind, faded: object.userData.faded, seq: object.userData.seq,
        visible: line.visible, dashed: !!line.material.dashed, renderOrder: line.renderOrder, minRadius: Math.min(...radii), maxRadius: Math.max(...radii), opacity: line.material.opacity });
    }
    if (object.name.startsWith('file:') && object.userData.window) {
      const centre = object.getWorldPosition(new V());
      const scale = object.getWorldScale(new V()).x;
      const edge = centre.clone().add(new V(1, 0, 0).applyQuaternion(object.getWorldQuaternion(camera.quaternion.clone())).multiplyScalar(scale));
      const [cx, cy] = toPx(centre), [ex, ey] = toPx(edge);
      const fill = object.getObjectByName(`file-lit:${object.userData.file}`);
      circles.push({ file: object.userData.file, state: object.userData.window, colour: fill.material.color.getHexString(), opacity: fill.material.opacity, dimmedByEmphasis: fill.material.userData.sessionBrightness !== undefined, ring: !!object.getObjectByName(`file-ring:${object.userData.file}`), radiusPx: Math.hypot(ex - cx, ey - cy), lines: object.userData.lines });
    }
    if (object.name.startsWith('file-ring:')) rings.push(object.name);
    if (object.name.startsWith('territory:') && object.userData.window) { const fill = object.getObjectByName(`territory-lit:${object.userData.capability}`); territories.push({ capability: object.userData.capability, state: object.userData.window, colour: fill.material.color.getHexString(), opacity: fill.material.opacity, dimmedByEmphasis: fill.material.userData.sessionBrightness !== undefined }); }
  });
  let allCircles = 0;
  scene.traverse(o => { if (o.name.startsWith('file:')) allCircles++; });
  return { zoom: camera.zoom, shellRadius: surface, trails: trails.sort((a, b) => a.seq - b.seq), circles, rings, territories, allCircles };
});

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) (message.type() === 'warning' ? warnings : errors).push(message.text()); });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(({ data, survey, reading }) => {
    const copy = value => structuredClone(value);
    window.__asked = [];
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
      windowReading: async (_, id) => { window.__asked.push(id); return copy(reading); },
    };
  }, { data: seed, survey, reading });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 60000 });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  for (const name of ['Close help', 'Close app menu']) {
    const close = page.getByRole('button', { name, exact: true });
    if (await close.isVisible()) await close.click();
  }
  await settle(page);
  const results = { expected: expected.length };
  results.noneSelected = await measure(page);
  // With none selected the listed session's two notes still step to each other (ADR-0754); nothing of the code is drawn.
  assert.deepEqual([results.noneSelected.trails.filter(t => t.kind).length, results.noneSelected.circles.length, results.noneSelected.territories.length], [0, 0, 0], 'nothing is drawn of the code while no session is selected');
  await page.screenshot({ path: path.join(out, '0-none-selected.png'), timeout: 180000 });

  const row = page.getByRole('complementary', { name: 'Running sessions', exact: true }).locator(`.session-row[data-session-id="${session}"]`);
  await row.waitFor({ timeout: 30000 });
  await row.click();
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-trail:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
  await settle(page);
  results.front = await measure(page);
  await page.screenshot({ path: path.join(out, '1-front-selected.png'), timeout: 180000 });

  const trailSummary = trail => [trail.from, trail.to, trail.edge, trail.kind, trail.faded];
  assert.deepEqual(results.front.trails.map(trailSummary), expected, 'one line per step in reading order, solid on an import, dotted otherwise, dives to and from the core');

  const faceIt = async (story, zoom) => {
    await page.evaluate(({ id, zoom }) => {
      const { scene, camera, invalidate } = window.__globe, { rotation, onRotate } = window.__nav;
      const V = camera.position.constructor, Q = camera.quaternion.constructor;
      const at = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize();
      onRotate(new Q().setFromUnitVectors(at, camera.position.clone().normalize()).multiply(rotation));
      if (zoom) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
      invalidate();
    }, { id: story, zoom });
    await settle(page);
  };
  const baseZoom = results.front.zoom;
  await faceIt(KNOWLEDGE_CORE, baseZoom * 2.4);
  results.knowledgeCore = await measure(page);
  await page.screenshot({ path: path.join(out, '2-knowledge-core.png'), timeout: 180000 });
  await faceIt(FOREST, baseZoom * 2.4);
  results.forest = await measure(page);
  await page.screenshot({ path: path.join(out, '3-forest.png'), timeout: 180000 });
  await faceIt(KNOWLEDGE_CORE, baseZoom * 6);
  results.knowledgeCoreClose = await measure(page);
  await page.screenshot({ path: path.join(out, '2b-knowledge-core-close.png'), timeout: 180000 });
  await faceIt(FOREST, baseZoom * 6);
  await page.screenshot({ path: path.join(out, '3b-forest-close.png'), timeout: 180000 });
  // Between the forest and the agent link: the far hop, at a zoom that keeps both islands in view.
  await faceIt(FOREST, baseZoom * 1.35);
  results.hop = await measure(page);
  await page.screenshot({ path: path.join(out, '4-hop-to-agent-link.png'), timeout: 180000 });

  // Letting the session go clears the land again.
  await faceIt(KNOWLEDGE_CORE, baseZoom);
  await row.click();
  await settle(page);
  results.released = await measure(page);
  assert.deepEqual([results.released.circles.length, results.released.territories.length], [0, 0], 'deselecting lights nothing');

  results.browser = await browser.version(); results.errors = errors; results.warnings = [...new Set(warnings)];
  results.asked = await page.evaluate(() => window.__asked);
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: results.browser, trails: results.front.trails.length, circles: results.front.circles.length, rings: results.front.rings.length, territories: results.front.territories, errors }));
});
