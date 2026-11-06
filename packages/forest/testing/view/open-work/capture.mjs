// Selecting an arc rings its open work (ADR-1253 D1 as corrected 2026-11-05): storytree's own map (the code-rows snapshot and
// its survey) as the app opens it, with two active arcs in the stand-in bridge whose open increments name real capabilities of
// the seed. No arc selected draws no open-work mark; the first arc's row clicked in the Arcs tab rings each capability it names
// round its settlement or its nameplate, the rest dimmed, the same at the wheel's floor (ADR-1272 D2); then close up on The library
// and on The arc surface, a small island. `node --import tsx capture.mjs` (append --retake to write into
// src/view/evidence/open-work). Counts, from the scene, every ring and dim shown, so "ringed what the arc names" is measured.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'open-work');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const at = '2026-11-05T00:00:00.000Z';
const record = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
const work = (id, arc, title, status, capabilities) => record(id, 'increment', { arc, title, objective: title, status, parked: at, capabilities });
// The capability tree arc's open work: Story node render and Running sessions (The forest), Arc surface (The arc surface),
// Storytree projects (The app) and Library transactions (The library); a closed increment's capabilities are not open work.
const RINGED = ['capability_3c5ed8b3ca70', 'capability_5a80222c88c4', 'capability_6133809a4139', 'capability_8ffc78a4bad2', 'capability_d077e76e50d7'];
const tree = record('arc_tree', 'arc', { title: 'Capability tree: a map of capabilities', intent: 'See where work lands', endState: 'The look landed' });
const retry = record('arc_library', 'arc', { title: 'Library transactions retry', intent: 'Retry safely', endState: 'Retries land' });
const arcs = [
  { arc: tree, state: 'active', questions: [], increments: [
    work('inc_ring', 'arc_tree', 'Open work: a hollow selection ring on arc select', 'active', ['capability_3c5ed8b3ca70', 'capability_6133809a4139', 'capability_8ffc78a4bad2', 'capability_d077e76e50d7']),
    work('inc_map', 'arc_tree', 'The map shows a transaction the library retries', 'proposal', ['capability_5a80222c88c4', 'capability_8ffc78a4bad2']),
    work('inc_3c', 'arc_tree', 'Rollout 2, step 3c: a picked link lights its way', 'closed', ['capability_33812c1d778b']),
  ] },
  { arc: retry, state: 'active', questions: [], increments: [
    work('inc_tx', 'arc_library', 'Retry a transaction that met a serialisation failure', 'proposal', ['capability_5a80222c88c4', 'capability_81ad90bacdbc']),
  ] },
];

const started = performance.now();
const phase = message => console.error(`[open work +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
/** What the map shows of the open work, counted from the scene: each ring and dim whose every ancestor is visible. */
const measure = page => page.evaluate(() => {
  const found = { rings: [], dims: [], dimmedIslands: [] };
  const shown = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  window.__globe.scene.traverse(object => {
    if (object.name.startsWith('planet:') && object.userData.sessionEmphasis === 'dimmed') found.dimmedIslands.push(object.name.slice('planet:'.length));
    if (!shown(object)) return;
    if (object.name.startsWith('open-work-ring:')) found.rings.push(object.name.slice('open-work-ring:'.length));
    if (object.name.startsWith('open-work-dim:')) found.dims.push(object.name.slice('open-work-dim:'.length));
  });
  for (const list of Object.values(found)) list.sort();
  return found;
});
const results = { ringedByTheArc: RINGED };
const storyNamed = title => seed.tree.stories.find(story => story.title === title).id;
const library = storyNamed('The library'), arcSurface = storyNamed('The arc surface');
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
/** The eye's zoom, CSS pixels per ground unit (`sheetEyeZoom`). */
const eyeZoom = page => page.evaluate(({ radius, fov }) => {
  const { camera, size } = window.__globe;
  return Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / (camera.position.length() - radius);
}, eye);
/** Stands the eye on its line of sight at `zoom`, as the wheel would, and lets the map draw it (the zoom-detail capture's). */
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
/** The sheet's own camera stop for `story` (the page's locator, 3.41), then the eye near, where the settlements show (3.86). */
const closeUp = async (page, settle, story) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), story)) throw new Error(`no camera stop for ${story}`);
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await zoomTo(page, settle, DETAIL_ZOOM.near * 1.4);
};
/** The whole map, at `times` the zoom it opens on. */
const whole = async (page, settle, times = 1) => {
  if (!await page.evaluate(() => window.storytreeGlobe.face({ kind: 'core' }))) throw new Error('no camera stop for the whole map');
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await zoomTo(page, settle, results.opening * times);
};

await runCapture({
  folder: pictures, dist, seed, survey,
  answers: { boardArcs: async () => arcs, arcViews: async () => arcs },
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'every island laid out with its roads', () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('island-roads')) laid++; } }); return n > 0 && laid === n; });
    await settle(page);
    results.opening = await eyeZoom(page);
  },
  views: [{
    name: 'no-arc-selected',
    measure: async ({ page }) => (results.none = await measure(page)),
    expect: found => { assert.deepEqual(found.rings, []); assert.deepEqual(found.dims, []); },
  }, {
    name: 'no-arc-selected-the-library',
    prepare: async ({ page, settle }) => closeUp(page, settle, library),
    measure: async ({ page }) => measure(page),
    expect: found => assert.deepEqual(found.rings, []),
  }, {
    name: 'arc-selected',
    prepare: async ({ page, settle }) => {
      await whole(page, settle);
      await page.locator('[data-rail-tab="arcs"]').click().catch(() => {});
      await page.locator('[data-arc-select="arc_tree"]').click();
      // The rings follow the selected arc, so it stays selected in the picture.
      await until(page, 'the arc\'s rings', count => { let rings = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('open-work-ring:')) rings++; }); return rings >= count; }, RINGED.length);
      await settle(page, 12);
    },
    measure: async ({ page }) => (results.selected = await measure(page)),
    expect: found => { assert.deepEqual(found.rings, RINGED); assert.ok(found.dims.length > 0); assert.ok(found.dimmedIslands.length > 0); },
  }, {
    name: 'arc-selected-floor',
    // Half the zoom the map opens on, where the wheel stops: the territories still show, so the capabilities' rings do (3.86).
    prepare: async ({ page, settle }) => whole(page, settle, 0.5),
    measure: async ({ page }) => (results.floor = await measure(page)),
    expect: found => { assert.deepEqual(found.rings, RINGED); assert.ok(found.dims.length > 0); },
  }, {
    name: 'arc-selected-the-library',
    prepare: async ({ page, settle }) => closeUp(page, settle, library),
    measure: async ({ page }) => (results.library = await measure(page)),
    expect: found => assert.ok(found.rings.includes('capability_5a80222c88c4')),
  }, {
    name: 'arc-selected-the-arc-surface',
    prepare: async ({ page, settle }) => closeUp(page, settle, arcSurface),
    measure: async ({ page }) => (results.arcSurface = await measure(page)),
    expect: found => assert.ok(found.rings.includes('capability_d077e76e50d7')),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
