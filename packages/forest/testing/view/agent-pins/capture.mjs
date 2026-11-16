// Agents' pins drawn on the map, near and far (3.119, increment_9f3727958f79; Mick, by voice 2026-11-15: "when you zoom out,
// you can still see that inside that package there is a caching layer. It's just pinned."): The library's island alone, from a
// fresh seed and code survey built from the library and this checkout (as nested-parts' capture, whose committed pair holds no
// parts), with a shared store beside it. Four pins on the capability with the most parts (a cache on its first part, a setting
// on the capability itself, a job on a part gone from the code, read stale), an api on another capability, and one on the
// store's table. Zoomed out, near, and with the capability opened into its parts.
// `node --import tsx capture.mjs <name>` (append --retake to write into src/view/evidence/agent-pins).
// Counts, from the page, every pin mark shown: its place, its level, its icons and count, and each row's label and staleness.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { seedHolding } from '../../../../../apps/desktop/src/capture/fresh-seed.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';
import { sceneParts } from '../../../src/render/scene-parts.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'agent-pins');
const name = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'after';
const fresh = await seedHolding(['The library'], { committed: () => ({ seed: { tree: { stories: [] } }, survey: {} }) });
const library = fresh.seed.tree.stories.find(story => story.title === 'The library');
const seed = { ...fresh.seed, tree: { ...fresh.seed.tree, stories: [library] } }, survey = { [library.id]: fresh.survey[library.id] };
const titles = new Map(library.capabilities.map(c => [c.id, c.title]));
const [opened] = sceneParts(survey, titles).filter(p => p.story === library.id).sort((a, b) => b.shares.length - a.shares.length);
const capability = opened.capability, part = opened.shares.find(share => share.capability.includes('/')).capability;
const other = library.capabilities.find(c => c.id !== capability).id;
const gone = `${part.slice(0, part.lastIndexOf('/'))}/gone-from-the-code`;
console.error(`pinning ${titles.get(capability)} (part ${part}) and ${titles.get(other)}`);
const STORE = 'postgres://db/library';
// The shared store is drawn from a store link on a capability (ADR-1347 D3).
library.capabilities.find(c => c.id === other).storeLinks = [{ store: STORE, table: 'records', direction: 'read', cites: ['src/records.ts:1'] }];
const at = '2026-11-16T00:00:00.000Z';
const pin = (n, anchor, icon, label, stale) => ({ pin: { id: `pin_${String(n).padStart(12, '0')}`, type: 'pin', version: 1, createdAt: at, updatedAt: at,
  fields: { anchor, icon, label, evidence: 'read in the code', commit: 'f'.repeat(40), at } }, ...(stale === undefined ? {} : { stale }) });
const pins = [
  pin(1, { capability, part }, 'cache', 'Search results cached'),
  pin(2, { capability }, 'config', 'Library settings'),
  pin(3, { capability, part: gone }, 'job', 'Nightly reindex', `${capability} has no part ${gone}`),
  pin(4, { capability: other }, 'api', 'Public read routes'),
  pin(5, { store: STORE, table: 'records' }, 'store', 'Every record'),
];
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[agent pins +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 300_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
const face = async (page, target) => {
  if (!await page.evaluate(target => window.storytreeGlobe.face(target), target)) throw new Error(`no camera stop for ${JSON.stringify(target)}`);
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
};
/** Every pin mark on the page, by its place: its level, icons, count, and each row's label and staleness. */
const measure = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.planet-pin')].filter(mark => mark.checkVisibility()).map(mark => [mark.dataset.pinPlace, {
  level: mark.dataset.pinLevel, count: Number(mark.dataset.pinCount), icons: mark.dataset.pinIcons, stale: Number(mark.dataset.pinStale),
  rows: [...mark.querySelectorAll('[data-pin-id]')].map(row => `${row.querySelector('[data-icon]').dataset.icon} ${row.querySelector('.planet-pin-label').textContent}${row.dataset.stale === undefined ? '' : ' (stale)'}`),
}])));
const results = {};
const own = `${capability}/`, onPart = `${capability}/${part}`, onOther = `${other}/`, onStore = `store:${STORE}`;

await runCapture({
  folder: pictures, dist, seed, survey, name, layouts: captureSeed('code-rows').layouts,
  answers: { pins: async () => pins },
  prepare: async ({ page }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    await until(page, 'every island laid out', () => document.querySelector('[data-layout="laying-out"]') === null, undefined, 1_200_000);
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  },
  views: [{
    name: `${name}-far`,
    prepare: async ({ page, settle }) => { await face(page, { kind: 'story', story: library.id }); await zoomTo(page, settle, DETAIL_ZOOM.near * 0.7); },
    measure: async ({ page }) => (results.far = await measure(page)),
    expect: found => {
      assert.deepEqual([found[own]?.level, found[own]?.count, found[own]?.icons, found[own]?.stale], ['far', 3, 'cache config job', 1], 'zoomed out, the part\'s pins roll up to the capability: three icons, three pins, one stale');
      assert.deepEqual([found[onOther]?.count, found[onOther]?.icons], [1, 'api']);
      assert.equal(found[onStore]?.icons, 'store', 'the store\'s pin on its slab');
    },
  }, {
    name: `${name}-near`,
    prepare: async ({ page, settle }) => { await face(page, { kind: 'capability', capability }); await zoomTo(page, settle, DETAIL_ZOOM.near * 2); },
    measure: async ({ page }) => (results.near = await measure(page)),
    expect: found => {
      assert.equal(found[own]?.level, 'near');
      assert.deepEqual(found[own]?.rows, ['cache Search results cached', 'config Library settings', 'job Nightly reindex (stale)'], 'near, each pin\'s icon and label, the stale one marked');
    },
  }, {
    name: `${name}-opened`,
    prepare: async ({ page, settle }) => {
      await face(page, { kind: 'capability', capability });
      await zoomTo(page, settle, DETAIL_ZOOM.parts * 1.6);
      await until(page, 'the capability opened with its roads', capability => window.__globe.scene.getObjectByName(`opened-capability:${capability}`)?.userData.routed === true, capability);
      await until(page, 'the part\'s pin on its part', place => !!document.querySelector(`.planet-pin[data-pin-place="${CSS.escape(place)}"]`), onPart);
      await settle(page, 12);
    },
    measure: async ({ page }) => (results.opened = await measure(page)),
    expect: found => {
      assert.deepEqual(found[onPart]?.rows, ['cache Search results cached'], 'opened, the cache stands on its part');
      assert.deepEqual(found[own]?.rows, ['config Library settings', 'job Nightly reindex (stale)'], 'the capability keeps its own and the stale one, whose part is gone');
    },
  }],
});
writeFileSync(path.join(captureOutput(pictures, { name }), `${name}-measurements.json`), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results, null, 1));
