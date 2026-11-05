// Selecting an arc circles its open work (rollout 2, step 4b; ADR-1253 D1): storytree's own map (the code-rows snapshot and its
// survey) as the app opens it, with two active arcs in the stand-in bridge whose open increments name real capabilities of the
// seed. Three views: no arc selected (the open-work dots alone), the first arc's row clicked in the Arcs tab (its capabilities
// ringed, the rest dimmed), and then The forest's island clicked, so its roads, gates and settlements are drawn beside the dots.
// `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/open-work). Counts, from the scene, every ring,
// dot and dim, so "ringed what the arc names" is measured, not looked at.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'open-work');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const at = '2026-11-05T00:00:00.000Z';
const record = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
const work = (id, arc, title, status, capabilities) => record(id, 'increment', { arc, title, objective: title, status, parked: at, capabilities });
// The capability tree arc's open work as this step leaves it: Story node render and Running sessions (The forest), Arc surface
// (The arc surface) and Storytree projects (The app); a closed increment's capabilities are not open work.
const RINGED = ['capability_3c5ed8b3ca70', 'capability_6133809a4139', 'capability_8ffc78a4bad2', 'capability_d077e76e50d7'];
const tree = record('arc_tree', 'arc', { title: 'Capability tree: a map of capabilities', intent: 'See where work lands', endState: 'The look landed' });
const library = record('arc_library', 'arc', { title: 'Library transactions retry', intent: 'Retry safely', endState: 'Retries land' });
const arcs = [
  { arc: tree, state: 'active', questions: [], increments: [
    work('inc_4b', 'arc_tree', 'Rollout 2, step 4b: selecting an arc circles its open work', 'active', RINGED),
    work('inc_6', 'arc_tree', 'Rollout 2, step 6: the legend says what the map draws', 'proposal', ['capability_8ffc78a4bad2']),
    work('inc_3c', 'arc_tree', 'Rollout 2, step 3c: a picked link lights its way', 'closed', ['capability_33812c1d778b']),
  ] },
  { arc: library, state: 'active', questions: [], increments: [
    work('inc_tx', 'arc_library', 'Retry a transaction that met a serialisation failure', 'proposal', ['capability_5a80222c88c4', 'capability_81ad90bacdbc']),
  ] },
];
const OPEN = [...new Set(arcs.flatMap(({ increments }) => increments.filter(({ fields }) => fields.status !== 'closed').flatMap(({ fields }) => fields.capabilities)))].sort();

const started = performance.now();
const phase = message => console.error(`[open work +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
/** What the map drew of the open work, counted from the scene. */
const measure = page => page.evaluate(() => {
  const found = { rings: [], dots: [], dims: [], dimmedIslands: [] };
  window.__globe.scene.traverse(object => {
    if (object.name.startsWith('open-work-ring:')) found.rings.push(object.name.slice('open-work-ring:'.length));
    if (object.name.startsWith('open-work-dot:')) found.dots.push(object.name.slice('open-work-dot:'.length));
    if (object.name.startsWith('open-work-dim:')) found.dims.push(object.name.slice('open-work-dim:'.length));
    if (object.name.startsWith('planet:') && object.userData.sessionEmphasis === 'dimmed') found.dimmedIslands.push(object.name.slice('planet:'.length));
  });
  for (const list of Object.values(found)) list.sort();
  return found;
});
const results = { ringedByTheArc: RINGED, openWork: OPEN };
const forest = seed.tree.stories.find(story => story.title === 'The forest').id;
// A close-up: the sheet's own camera stop for The forest (the page's locator, 3.41), then the eye zoomed in, as territory-health's.
const ZOOM = 2.6;
// The eye's zoom set from the opening's, never multiplied, so a glide that settles late cannot compound it.
const zoomTo = async (page, settle, times) => {
  await page.evaluate(times => { const { camera, invalidate } = window.__globe; camera.zoom = window.__openingZoom * times; camera.updateProjectionMatrix(); invalidate(); }, times);
  await settle(page, 12);
};
const closeUp = async (page, settle, face = true, zoom = ZOOM) => {
  if (face && !await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), forest)) throw new Error('no camera stop for The forest');
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await zoomTo(page, settle, zoom);
};

await runCapture({
  folder: pictures, dist, seed, survey,
  answers: { boardArcs: async () => arcs, arcViews: async () => arcs },
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map with its dots', count => document.body.dataset.state === 'ready' && (() => {
      let dots = 0; window.__globe?.scene.traverse(o => { if (o.name.startsWith('open-work-dot:')) dots++; }); return dots >= count;
    })(), OPEN.length);
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await settle(page);
    await page.evaluate(() => { window.__openingZoom = window.__globe.camera.zoom; });
  },
  views: [{
    name: 'no-arc-selected',
    measure: async ({ page }) => (results.none = await measure(page)),
    expect: found => { assert.deepEqual(found.dots, OPEN); assert.deepEqual(found.rings, []); assert.deepEqual(found.dims, []); },
  }, {
    name: 'no-arc-selected-close',
    prepare: async ({ page, settle }) => closeUp(page, settle),
    measure: async ({ page }) => measure(page),
    expect: found => assert.deepEqual(found.rings, []),
  }, {
    name: 'arc-selected',
    prepare: async ({ page, settle }) => {
      await zoomTo(page, settle, 1);
      if (!await page.evaluate(() => window.storytreeGlobe.face({ kind: 'core' }))) throw new Error('no camera stop for the whole map');
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await page.locator('[data-rail-tab="arcs"]').click().catch(() => {});
      await page.locator('[data-arc-select="arc_tree"]').click();
      // The rings follow the open card, so it stays open in the picture.
      await until(page, 'the arc\'s rings', count => { let rings = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('open-work-ring:')) rings++; }); return rings >= count; }, RINGED.length);
      await settle(page, 12);
    },
    measure: async ({ page }) => (results.selected = await measure(page)),
    expect: found => { assert.deepEqual(found.rings, RINGED); assert.deepEqual(found.dots, OPEN); assert.ok(found.dims.length > 0); assert.ok(found.dimmedIslands.length > 0); },
  }, {
    name: 'arc-selected-close',
    prepare: async ({ page, settle }) => closeUp(page, settle),
    measure: async ({ page }) => measure(page),
    expect: found => assert.deepEqual(found.rings, RINGED),
  }, {
    name: 'arc-selected-the-forest',
    prepare: async ({ page, settle }) => {
      const island = await page.evaluate(story => window.storytreeGlobe.islands().find(i => i.story === story), forest);
      await page.mouse.click(island.x, island.y);
      await until(page, 'The forest selected, its roads drawn', story => document.body.dataset.selected === story && (() => {
        let settlements = 0; window.__globe.scene.getObjectByName(`planet:${story}`)?.traverse(o => { if (o.name.startsWith('settlement:')) settlements++; }); return settlements > 0;
      })(), forest);
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await closeUp(page, settle, true, 2);
    },
    measure: async ({ page }) => (results.forest = await measure(page)),
    expect: found => assert.deepEqual(found.rings, RINGED),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
