// Picking a gate rings the gate, not the road (3.88; Mick, 2026-11-05: "the gate should show the circle when i select
// this"): storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The library. Nothing
// picked; then a gate between two of its capabilities clicked with the mouse: a gold ring round its posts and no road lit;
// then a road clicked, which takes no click (Mick, 2026-11-07: "I don't think we should ever have highlighting or selection of
// the roads, because we have the gates"): the capability under it is selected and ringed in gold, and nothing is lit (3.15,
// 3.91); then the same beside an arc's blue open-work rings. `node --import tsx capture.mjs` (append --retake to write into
// src/view/evidence/gate-ring). Counts, from the scene, the rings and lit roads shown, so "no road lit" is measured.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'gate-ring');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[gate ring +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const library = seed.tree.stories.find(story => story.title === 'The library').id;
const at = '2026-11-07T00:00:00.000Z';
const record = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
// One active arc whose open increment names Library transactions, so its blue ring stands beside a picked capability's gold one.
const arcs = [{ arc: record('arc_library', 'arc', { title: 'Library transactions retry', intent: 'Retry safely', endState: 'Retries land' }), state: 'active', questions: [], increments: [
  record('inc_tx', 'increment', { arc: 'arc_library', title: 'Retry a serialisation failure', objective: 'Retry a serialisation failure', status: 'proposal', parked: at, capabilities: ['capability_5a80222c88c4'] }),
] }];
/** What The library shows of a pick, counted from the scene: each gate ring, selected capability's ring, open-work ring, lit road and gold gate face whose every ancestor is visible. */
const measure = page => page.evaluate(story => {
  const found = { rings: [], picked: [], openWork: [], litRoads: 0, goldFaces: 0 };
  const shown = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  window.__globe.scene.getObjectByName(`planet:${story}`).traverse(object => {
    if (!shown(object)) return;
    if (object.name.startsWith('gate-ring:')) found.rings.push(object.name);
    if (object.name.startsWith('picked-ring:')) found.picked.push(object.name.slice('picked-ring:'.length));
    if (object.name.startsWith('open-work-ring:')) found.openWork.push(object.name.slice('open-work-ring:'.length));
    if (/^road-lit:\d+$/.test(object.name)) found.litRoads++;
    if (object.name.startsWith('gate-face:') && object.material.color.getHexString() === 'ffd34d') found.goldFaces++;
  });
  return found;
}, library);
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
/** The screen points of The library's marks named by `kind`: each gate post between two capabilities, or each road segment carrying one link, nearest the middle of the view first. */
const targets = (page, kind) => page.evaluate(({ story, kind }) => {
  const { scene, camera } = window.__globe, box = document.querySelector('canvas').getBoundingClientRect();
  const marks = [];
  scene.updateMatrixWorld(true);
  scene.getObjectByName(`planet:${story}`).traverse(object => {
    const { gate, between, portal, links, width } = object.userData;
    // A road segment is drawn with its links and width, and takes no ray: the click lands on what lies under it.
    const wanted = kind === 'gate' ? gate === true && /^gate-post:\d+:1$/.test(object.name) && !between.includes('open') : width !== undefined && !portal && links?.length === 1;
    if (!wanted) return;
    object.geometry.computeBoundingBox();
    const at = object.geometry.boundingBox.getCenter(object.position.clone()).applyMatrix4(object.matrixWorld).project(camera);
    if (Math.abs(at.x) > 0.8 || Math.abs(at.y) > 0.8) return;
    marks.push({ name: object.name, between, x: box.left + (at.x + 1) / 2 * box.width, y: box.top + (1 - at.y) / 2 * box.height, off: Math.hypot(at.x, at.y) });
  });
  return marks.sort((a, b) => a.off - b.off);
}, { story: library, kind });
/** Clicks each target of `kind` in turn until `picked` holds of what the scene shows; the one it clicked. */
const clickUntil = async (page, settle, kind, picked) => {
  for (const target of await targets(page, kind)) {
    await page.mouse.click(target.x, target.y);
    await settle(page, 8);
    if (picked(await measure(page))) return target;
  }
  throw new Error(`no ${kind} on The library took the click`);
};
const results = {};
/** The sheet's own camera stop for The library, then the eye at `times` the near detail zoom. */
const closeUp = async (page, settle, times) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), library)) throw new Error('no camera stop for The library');
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await zoomTo(page, settle, DETAIL_ZOOM.near * times);
};
const roadClicked = found => found.picked.length === 1;
const nothingLit = found => { assert.deepEqual(found.rings, [], 'a road click rings no gate'); assert.equal(found.litRoads, 0, 'and lights no road'); assert.equal(found.goldFaces, 0, 'nor any gate face'); };

await runCapture({
  folder: pictures, dist, seed, survey,
  answers: { boardArcs: async () => arcs, arcViews: async () => arcs },
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'The library laid out with its roads', story => !!window.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-roads'), library);
    await closeUp(page, settle, 1.6);
  },
  views: [{
    name: 'the-library-nothing-picked',
    measure: async ({ page }) => (results.none = await measure(page)),
    expect: found => { assert.deepEqual(found.rings, []); assert.deepEqual(found.picked, []); assert.equal(found.litRoads, 0); },
  }, {
    name: 'the-library-gate-picked',
    prepare: async ({ page, settle }) => { results.gate = await clickUntil(page, settle, 'gate', found => found.rings.length === 1); },
    measure: async ({ page }) => (results.gatePicked = await measure(page)),
    expect: found => { assert.equal(found.rings.length, 1, 'the picked gate ringed'); assert.equal(found.litRoads, 0, 'no road lit'); assert.equal(found.goldFaces, 0, 'no gate face gold'); },
  }, {
    name: 'the-library-road-clicked',
    // The click falls through the road to the capability's territory under it: that capability is selected and ringed (3.91).
    prepare: async ({ page, settle }) => { results.road = await clickUntil(page, settle, 'road', roadClicked); },
    measure: async ({ page }) => (results.roadClicked = await measure(page)),
    expect: found => { nothingLit(found); assert.equal(found.picked.length, 1, 'the capability under the road ringed'); },
  }, {
    name: 'the-library-road-clicked-beside-an-arc',
    // An arc selected rings its open work in blue; a road clicked then rings the capability under it in gold beside them.
    prepare: async ({ page, settle }) => {
      await page.locator('[data-rail-tab="arcs"]').click().catch(() => {});
      await page.locator('[data-arc-select="arc_library"]').click();
      await until(page, 'the arc\'s ring', () => { let rings = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('open-work-ring:')) rings++; }); return rings > 0; });
      await closeUp(page, settle, 1.6);
      results.roadBesideArc = await clickUntil(page, settle, 'road', found => roadClicked(found) && found.openWork.length > 0);
    },
    measure: async ({ page }) => (results.roadClickedBesideArc = await measure(page)),
    expect: found => { nothingLit(found); assert.equal(found.picked.length, 1); assert.deepEqual(found.openWork, ['capability_5a80222c88c4']); },
  }, {
    name: 'the-library-gate-picked-close',
    // Closer, from The library's own camera stop (the gate stands near the middle of its view): the ring round its posts.
    prepare: async ({ page, settle }) => {
      await closeUp(page, settle, 4);
      results.closeGate = await clickUntil(page, settle, 'gate', found => found.rings.length === 1);
    },
    measure: async ({ page }) => measure(page),
    expect: found => { assert.equal(found.rings.length, 1); assert.deepEqual(found.picked, [], 'a gate pick rings no capability'); assert.equal(found.litRoads, 0); },
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
