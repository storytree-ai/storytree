// The map pointer's second step (3.89, 5.9; question_97c6d6036e47 answered E): storytree's own map (the code-rows snapshot
// and its survey) with the open-work capture's arc in the stand-in bridge and two sessions in the agent log. A points at
// Running sessions (on The forest), which the arc names; B points at the gate between two of The forest's capabilities, for a
// question. Close up on The command line, The forest lies past the window's edge: an edge marker in each session's colour
// says which way, and the camera stays where it was put. Close up on The forest: B's pulse at the gate's posts.
// `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/agent-pointer-edge). Counts, from the
// page, every pointer edge marker and every pointer pulse shown, so "a marker only while out of view" is measured.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'agent-pointer-edge');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const at = '2026-11-07T00:00:00.000Z';
const record = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
const work = (id, arc, title, status, capabilities) => record(id, 'increment', { arc, title, objective: title, status, parked: at, capabilities });
const RUNNING_SESSIONS = 'capability_6133809a4139', STORY_NODE_RENDER = 'capability_8ffc78a4bad2';
// The gate between Story node render and Agent capability claims, on The forest (its posts' `between`, as measured).
const CLAIMS = 'capability_efa4328b624c', GATE = [STORY_NODE_RENDER, CLAIMS];
const tree = record('arc_tree', 'arc', { title: 'Capability tree: a map of capabilities', intent: 'See where work lands', endState: 'The look landed' });
const arcs = [{ arc: tree, state: 'active', questions: [], increments: [
  work('inc_point', 'arc_tree', 'The map pointer\'s edge marker, and pointing at a gate', 'active', [RUNNING_SESSIONS, STORY_NODE_RENDER]),
] }];

const now = Date.now();
const lines = [];
const add = (minutesAgo, session, line) => lines.push({ ...line, session, harness: 'claude-code', project: seed.projects[0], seq: lines.length + 1, at: new Date(now - minutesAgo * 60_000).toISOString() });
for (const session of ['A', 'B']) { add(6, session, { kind: 'session-started', source: 'hook' }); add(5, session, { kind: 'prompt-submitted', source: 'hook' }); }
add(3, 'A', { kind: 'pointed', source: 'tool', capability: RUNNING_SESSIONS, why: 'A picture to judge' });
add(3, 'B', { kind: 'pointed', source: 'tool', capability: GATE[0], gate: GATE[1], why: 'The interface between them', question: 'question_000000000001' });
seed.lines = { lines, cursor: lines.length };

const started = performance.now();
const phase = message => console.error(`[pointer edge +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
/** The pointer pulses shown (every ancestor visible), the pointer edge markers on the page, the forest's gate pairs, and where the eye stands. */
const measure = (page, forest) => page.evaluate(forest => {
  const pulses = [], gates = new Set();
  const shown = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  window.__globe.scene.traverse(object => {
    if (object.name.startsWith('territory-pointer:') && shown(object.getObjectByName('pointer-ring'))) pulses.push(object.name.slice('territory-pointer:'.length));
    if (object.userData?.gate === true && Array.isArray(object.userData.between)) {
      let o = object; while (o && !o.name.startsWith('planet:')) o = o.parent;
      if (o?.name === `planet:${forest}`) gates.add(object.userData.between.join('|'));
    }
  });
  const markers = [...document.querySelectorAll('.planet-edge-pointer')].map(b => ({ pointer: b.dataset.pointer, left: parseFloat(b.style.left), top: parseFloat(b.style.top), colour: b.style.borderColor }));
  return { pulses: pulses.sort(), markers, gates: [...gates].sort(), camera: window.__globe.camera.position.toArray().map(n => Math.round(n * 1000) / 1000) };
}, forest);
const results = {};
const storyNamed = title => seed.tree.stories.find(story => story.title === title).id;
const forest = storyNamed('The forest'), commandLine = storyNamed('The command line');
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
const closeUp = async (page, settle, story) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), story)) throw new Error(`no camera stop for ${story}`);
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await zoomTo(page, settle, DETAIL_ZOOM.near * 1.4);
};
const gateKey = [...GATE].sort().join('|');

await runCapture({
  folder: pictures, dist, seed, survey,
  answers: { boardArcs: async () => arcs, arcViews: async () => arcs },
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'every island laid out with its roads', () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('island-roads')) laid++; } }); return n > 0 && laid === n; });
    await page.locator('[data-rail-tab="arcs"]').click().catch(() => {});
    await page.locator('[data-arc-select="arc_tree"]').click();
    await until(page, 'the arc\'s pointer', capability => { let found = false; window.__globe.scene.traverse(o => { if (o.name === `territory-pointer:${capability}`) found = true; }); return found; }, RUNNING_SESSIONS);
    await settle(page, 12);
  },
  views: [{
    name: 'the-command-line-near',
    prepare: async ({ page, settle }) => {
      await closeUp(page, settle, commandLine);
      results.cameraBefore = (await measure(page, forest)).camera;
      // The pulses play on for three seconds past the window's edge: the eye stays where it was put.
      await page.waitForTimeout(3000);
      await settle(page, 4);
    },
    measure: async ({ page }) => (results.commandLine = await measure(page, forest)),
    expect: found => {
      assert.ok(found.markers.some(m => m.pointer === RUNNING_SESSIONS), 'A\'s pointer, out of view, has an edge marker');
      assert.ok(found.markers.some(m => m.pointer === gateKey), 'and so does B\'s gate pointer');
      assert.ok(found.markers.every(m => m.left === 20 || m.left === 1420 || m.top === 20 || m.top === 940), 'each at the canvas\'s edge');
      assert.deepEqual(found.camera, results.cameraBefore, 'the camera never moves');
    },
  }, {
    name: 'the-forest-near',
    prepare: async ({ page, settle }) => closeUp(page, settle, forest),
    measure: async ({ page }) => (results.forest = await measure(page, forest)),
    expect: found => {
      assert.ok(found.pulses.includes(RUNNING_SESSIONS));
      assert.ok(found.pulses.includes(gateKey), 'B\'s pulse at the gate\'s posts');
      assert.ok(!found.markers.some(m => m.pointer === RUNNING_SESSIONS), 'no marker while A\'s pointer is in view');
    },
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
