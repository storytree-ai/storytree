// Selecting an arc rings every gate its work names (F3.3 of research_e16161487f5a, verify first): storytree's own map (the
// code-rows snapshot and its survey), with The library's Library API given four links, each holding one contract, as
// plan_edge and plan_contract leave them: four edges whose dependsOn they replace. An arc's open increment names all four
// contracts in its links. Close up on The library with the arc selected: counts, from the scene, every gate ring shown and
// the gates its four links enter. `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/arc-gates).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'arc-gates');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const library = seed.tree.stories.find(story => story.title === 'The library');
const API = 'capability_75d059640d9d', api = library.capabilities.find(({ id }) => id === API);
const template = library.capabilities.flatMap(({ contracts }) => contracts)[0];
// Library API depends on four of The library's capabilities: each dependsOn becomes an edge holding one contract (ADR-1282 D2).
library.edges = api.dependsOn.map((to, i) => ({ id: `edge_api_${i}`, from: API, to, contracts: [{ ...template, id: `contract_api_${i}`, title: `7.${90 + i} · Library API reads ${to}` }] }));
const LINKS = library.edges.map(({ from, to }) => `${from}->${to}`);
const at = '2026-11-11T00:00:00.000Z';
const record = (id, type, fields) => ({ id, type, fields, version: 1, createdAt: at, updatedAt: at });
const arcs = [{ arc: record('arc_api', 'arc', { title: 'Library API reads through its links', intent: 'Each read safe', endState: 'Landed' }), state: 'active', questions: [], increments: [
  record('inc_api', 'increment', { arc: 'arc_api', title: 'Library API reads', objective: 'Library API reads', status: 'proposal', parked: at, capabilities: [API], links: library.edges.map(({ contracts }) => contracts[0].id) }),
] }];

const started = performance.now();
const phase = message => console.error(`[arc gates +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
/** The open-work rings and gate rings shown on The library, and every gate there with the links whose gate it is. */
const measure = page => page.evaluate(story => {
  const found = { rings: [], gateRings: [], gates: {}, caption: document.querySelector('.forest-arc-caption')?.textContent ?? null };
  const shown = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  const island = window.__globe.scene.getObjectByName(`planet:${story}`);
  island.traverse(object => {
    if (object.name.startsWith('open-work-ring:') && shown(object)) found.rings.push(object.name.slice('open-work-ring:'.length));
    if (object.name.startsWith('open-work-gate:') && shown(object)) found.gateRings.push(Number(object.name.slice('open-work-gate:'.length)));
    if (object.userData?.gate === true && object.userData.standing === true) found.gates[object.userData.index] = object.userData.entrances;
  });
  return found;
}, library.id);
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
const closeUp = async (page, settle) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), library.id)) throw new Error('no camera stop for The library');
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await zoomTo(page, settle, DETAIL_ZOOM.near * 1.4);
};
const results = { links: LINKS };

await runCapture({
  folder: pictures, dist, seed, survey,
  answers: { boardArcs: async () => arcs, arcViews: async () => arcs },
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'The library laid out with its roads', story => !!window.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-roads'), library.id, 1_800_000);
    await page.locator('[data-rail-tab="arcs"]').click().catch(() => {});
    await page.locator('[data-arc-select="arc_api"]').click();
    await until(page, 'the arc\'s ring', () => { let rings = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('open-work-ring:')) rings++; }); return rings > 0; });
    await closeUp(page, settle);
  },
  views: [{
    name: 'the-library-arc-selected',
    measure: async ({ page }) => (results.selected = await measure(page)),
    expect: found => {
      const entered = Object.entries(found.gates).filter(([, entrances]) => entrances.some(link => LINKS.includes(link))).map(([i]) => Number(i)).sort((a, b) => a - b);
      assert.deepEqual([...found.gateRings].sort((a, b) => a - b), entered, 'every gate one of its links enters is ringed');
    },
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
