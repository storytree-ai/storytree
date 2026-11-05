// The legend says what the map draws (rollout 2, step 6; ADR-1236 as narrowed by ADR-1253, 4.39): storytree's own map (the
// code-rows snapshot and its survey) as the app opens it, with an arc whose open increments name real capabilities of the seed,
// The forest's island clicked so its roads, gates and settlements are drawn and its story panel opens with the legend at its
// foot. `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/map-legend). Measures, from the scene,
// every mark name drawn on the selected island beside the legend's entries, so "nothing drawn is left out" is measured.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { MAP_LEGEND } from '../../../src/view/map-legend.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'map-legend');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const at = '2026-11-05T00:00:00.000Z';
const record = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
const work = (id, arc, title, status, capabilities) => record(id, 'increment', { arc, title, objective: title, status, parked: at, capabilities });
const tree = record('arc_tree', 'arc', { title: 'Capability tree: a map of capabilities', intent: 'See where work lands', endState: 'The look landed' });
const arcs = [{ arc: tree, state: 'active', questions: [], increments: [
  work('inc_6', 'arc_tree', 'Rollout 2, step 6: the legend says what the map draws', 'active', ['capability_8ffc78a4bad2', 'capability_f0ffead428df']),
] }];

const started = performance.now();
const phase = message => console.error(`[map legend +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const forest = seed.tree.stories.find(story => story.title === 'The forest').id;
const listed = [...new Set(MAP_LEGEND.flatMap(({ draws }) => draws))].sort();
/** Each mark the selected island draws, by name up to its first colon, and the legend's entries as the panel shows them. */
const measure = page => page.evaluate(story => {
  const names = new Set();
  window.__globe.scene.getObjectByName(`planet:${story}`)?.traverse(object => {
    if ((object.isMesh || object.isLineSegments) && object.name !== '' && object.material?.colorWrite !== false) names.add(object.name.split(':')[0]);
  });
  return { drawn: [...names].sort(), entries: [...document.querySelectorAll('.panel-legend li')].map(li => li.textContent.trim()) };
}, forest);
const results = { listed };

await runCapture({
  folder: pictures, dist, seed, survey,
  answers: { boardArcs: async () => arcs, arcViews: async () => arcs },
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await settle(page);
  },
  views: [{
    name: 'the-forest-and-its-legend',
    prepare: async ({ page, settle }) => {
      const island = await page.evaluate(story => window.storytreeGlobe.islands().find(i => i.story === story), forest);
      await page.mouse.click(island.x, island.y);
      await until(page, 'The forest selected, its roads drawn', story => document.body.dataset.selected === story && (() => {
        let settlements = 0; window.__globe.scene.getObjectByName(`planet:${story}`)?.traverse(o => { if (o.name.startsWith('settlement:')) settlements++; }); return settlements > 0;
      })(), forest);
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await page.locator('.panel-legend').scrollIntoViewIfNeeded();
      await settle(page, 12);
    },
    measure: async ({ page }) => (results.forest = await measure(page)),
    expect: found => {
      for (const name of found.drawn) assert.ok(listed.includes(name), `the legend names ${name}`);
      assert.equal(found.entries.length, MAP_LEGEND.length);
    },
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
