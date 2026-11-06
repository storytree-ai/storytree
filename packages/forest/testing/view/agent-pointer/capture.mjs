// A session points the owner's eye at one capability (5.8, question_97c6d6036e47 answered E): storytree's own map (the
// code-rows snapshot and its survey) with the open-work capture's arc in the stand-in bridge and three sessions in the agent
// log. A claims Story node render and points at Running sessions, which the arc names; B points at Arcs and increments for a
// question; C points at Agent capability claims, off the arc and for no question. No arc selected shows B's pulse alone; the
// arc selected shows A's and B's, never C's; the camera stays where it was put. Close up on The forest and The command line.
// `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/agent-pointer). Counts, from the scene,
// every pointer shown, so "only on the arc's open work or for a question" is measured.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'agent-pointer');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const at = '2026-11-06T00:00:00.000Z';
const record = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
const work = (id, arc, title, status, capabilities) => record(id, 'increment', { arc, title, objective: title, status, parked: at, capabilities });
const RUNNING_SESSIONS = 'capability_6133809a4139', STORY_NODE_RENDER = 'capability_8ffc78a4bad2', ARCS = 'capability_81ad90bacdbc', CLAIMS = 'capability_efa4328b624c';
const tree = record('arc_tree', 'arc', { title: 'Capability tree: a map of capabilities', intent: 'See where work lands', endState: 'The look landed' });
const arcs = [{ arc: tree, state: 'active', questions: [], increments: [
  work('inc_point', 'arc_tree', 'While an agent works, the map points where your eye is needed', 'active', [RUNNING_SESSIONS, STORY_NODE_RENDER]),
] }];

// The agent log, written minutes before the page opens, so every session is working.
const now = Date.now();
const lines = [];
const add = (minutesAgo, session, line) => lines.push({ ...line, session, harness: 'claude-code', project: seed.projects[0], seq: lines.length + 1, at: new Date(now - minutesAgo * 60_000).toISOString() });
for (const session of ['A', 'B', 'C']) { add(6, session, { kind: 'session-started', source: 'hook' }); add(5, session, { kind: 'prompt-submitted', source: 'hook' }); }
add(4, 'A', { kind: 'claimed', source: 'tool', capability: STORY_NODE_RENDER, reason: 'the pointer pulse' });
add(3, 'A', { kind: 'pointed', source: 'tool', capability: RUNNING_SESSIONS, why: 'A picture to judge' });
add(3, 'B', { kind: 'pointed', source: 'tool', capability: ARCS, why: 'Your call on the arc list', question: 'question_000000000001' });
add(3, 'C', { kind: 'pointed', source: 'tool', capability: CLAIMS, why: 'Off the arc, for no question' });
seed.lines = { lines, cursor: lines.length };

const started = performance.now();
const phase = message => console.error(`[agent pointer +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
/** The pointers the map shows, counted from the scene: each whose every ancestor is visible, with its colour; and where the eye stands. */
const measure = page => page.evaluate(() => {
  const pointers = [];
  const shown = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  window.__globe.scene.traverse(object => {
    if (object.name.startsWith('territory-pointer:') && shown(object.getObjectByName('pointer-ring'))) pointers.push({ capability: object.userData.capability, colour: object.userData.colour });
  });
  pointers.sort((a, b) => a.capability.localeCompare(b.capability));
  return { pointers, camera: window.__globe.camera.position.toArray().map(n => Math.round(n * 1000) / 1000) };
});
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
const pointed = found => found.pointers.map(({ capability }) => capability);

await runCapture({
  folder: pictures, dist, seed, survey,
  answers: { boardArcs: async () => arcs, arcViews: async () => arcs },
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'every island laid out with its roads', () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('island-roads')) laid++; } }); return n > 0 && laid === n; });
    await until(page, 'the claim flag', () => { let flags = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('territory-claim:')) flags++; }); return flags > 0; });
    await settle(page);
  },
  views: [{
    name: 'no-arc-selected',
    measure: async ({ page }) => (results.none = await measure(page)),
    expect: found => assert.deepEqual(pointed(found), [ARCS], 'only the pointer for a question shows'),
  }, {
    name: 'arc-selected',
    prepare: async ({ page, settle }) => {
      await page.locator('[data-rail-tab="arcs"]').click().catch(() => {});
      await page.locator('[data-arc-select="arc_tree"]').click();
      await until(page, 'the arc\'s pointer', capability => { let found = false; window.__globe.scene.traverse(o => { if (o.name === `territory-pointer:${capability}`) found = true; }); return found; }, RUNNING_SESSIONS);
      await settle(page, 12);
      results.cameraBefore = (await measure(page)).camera;
      // The pulse plays on for three seconds: the eye stays where it was put.
      await page.waitForTimeout(3000);
    },
    measure: async ({ page }) => (results.selected = await measure(page)),
    expect: found => {
      assert.deepEqual(pointed(found), [RUNNING_SESSIONS, ARCS].sort(), 'the arc\'s open work and the question; never C\'s');
      assert.deepEqual(found.camera, results.cameraBefore, 'the camera never moves');
    },
  }, {
    name: 'arc-selected-the-forest',
    prepare: async ({ page, settle }) => closeUp(page, settle, forest),
    measure: async ({ page }) => (results.forest = await measure(page)),
    expect: found => assert.ok(pointed(found).includes(RUNNING_SESSIONS)),
  }, {
    name: 'arc-selected-the-command-line',
    prepare: async ({ page, settle }) => closeUp(page, settle, commandLine),
    measure: async ({ page }) => (results.commandLine = await measure(page)),
    expect: found => assert.ok(pointed(found).includes(ARCS)),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
