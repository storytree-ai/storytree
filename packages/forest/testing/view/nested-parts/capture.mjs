// Zooming into a capability draws its code's nested parts as territories with their own gates and roads (3.112-3.115,
// increment_4f63b96696c7; Mick, 2026-11-15: "suddenly that node would disappear, and instead you would get multiple smaller
// territories inside that capability as you zoom in"): The library's island alone, from a fresh seed and code survey built
// from the library and this checkout (the committed snapshot predates the survey's parts), as the app opens it. The library near,
// closed, then each of its capabilities `--capabilities <n>` (the largest with parts, 3 by default) faced and zoomed to the
// parts level. `node --import tsx capture.mjs <name>` (append --retake to write into src/view/evidence/nested-parts).
// Counts, from the scene and the page, each opened capability's parts, part roads, gates, draws and part names.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { seedHolding } from '../../../../../apps/desktop/src/capture/fresh-seed.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';
import { sceneParts } from '../../../src/render/scene-parts.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'nested-parts');
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const name = process.argv.slice(2).find(a => !a.startsWith('--') && a !== arg('--capabilities')) ?? 'after';
// Always fresh: the committed pair holds no parts.
const fresh = await seedHolding(['The library'], { committed: () => ({ seed: { tree: { stories: [] } }, survey: {} }) });
const library = fresh.seed.tree.stories.find(story => story.title === 'The library');
// The library alone: every island laid out from nothing takes the box tens of minutes, and its parts' roads in from other
// islands are drawn as its roads within it are.
const seed = { ...fresh.seed, tree: { ...fresh.seed.tree, stories: [library] } }, survey = { [library.id]: fresh.survey[library.id] };
const titles = new Map(library.capabilities.map(c => [c.id, c.title]));
const opened = sceneParts(survey, titles).filter(p => p.story === library.id)
  .sort((a, b) => b.shares.length - a.shares.length).slice(0, Number(arg('--capabilities') ?? 3));
console.error(`opening ${opened.map(p => `${titles.get(p.capability)} (${p.shares.length} parts)`).join(', ')}`);
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[nested parts +${Math.round(performance.now() - started)}ms] ${message}`);
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
/** What the island shows: the opened capability's marks and draws, its junction, and the part names on the page. */
const measure = (page, story) => page.evaluate(story => {
  const island = window.__globe.scene.getObjectByName(`planet:${story}`), found = { opened: [], territoryJunctions: 0, rolledUp: 0 };
  const shown = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  island.traverse(o => {
    if (o.name.startsWith('opened-capability:') && shown(o)) {
      const count = name => o.getObjectByName(name)?.geometry.getAttribute('position').count ?? 0;
      let draws = 0; o.traverse(m => { if (m.isMesh || m.isLineSegments) draws++; });
      found.opened.push({ capability: o.userData.capability, parts: o.userData.parts, draws, borderPoints: count('part-borders'), roadVertices: count('part-roads'), gatePosts: count('part-gates') / 36 });
    }
    if (o.name.startsWith('territory-junction:') && shown(o)) found.territoryJunctions++;
    if (o.name.startsWith('gate-post:') && o.userData.partRoads && o.name.endsWith(':1')) found.rolledUp++;
  });
  found.partNames = [...document.querySelectorAll('.planet-nameplate.part')].filter(l => l.checkVisibility()).map(l => l.textContent);
  return found;
}, story);
const results = {};
const views = [
  {
    name: `${name}-the-library-closed`,
    prepare: async ({ page, settle }) => {
      await until(page, 'The library laid out with its roads', story => !!window.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-roads'), library.id);
      if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), library.id)) throw new Error('no camera stop for The library');
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await zoomTo(page, settle, DETAIL_ZOOM.near * 4);
    },
    measure: async ({ page }) => (results['the-library-closed'] = await measure(page, library.id)),
  },
  ...opened.map(({ capability }) => {
    const slug = titles.get(capability).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      name: `${name}-${slug}-opened`,
      prepare: async ({ page, settle }) => {
        if (!await page.evaluate(capability => window.storytreeGlobe.face({ kind: 'capability', capability }), capability)) throw new Error(`no camera stop for ${capability}`);
        await until(page, 'the globe still', () => window.storytreeGlobe.still());
        await zoomTo(page, settle, DETAIL_ZOOM.parts * 1.6);
        await until(page, `${slug} opened with its roads`, capability => {
          const marks = window.__globe.scene.getObjectByName(`opened-capability:${capability}`);
          return marks?.userData.routed === true;
        }, capability);
        await settle(page, 12);
      },
      measure: async ({ page }) => (results[`${slug}-opened`] = await measure(page, library.id)),
    };
  }),
];

await runCapture({
  // The committed seed's kept layouts open the islands whose structure is unchanged laid out; the rest are searched.
  folder: pictures, dist, seed, survey, name, layouts: captureSeed('code-rows').layouts,
  prepare: async ({ page }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    await until(page, 'every island laid out', () => document.querySelector('[data-layout="laying-out"]') === null, undefined, 1_200_000);
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  },
  views,
});
writeFileSync(path.join(captureOutput(pictures, { name }), `${name}-measurements.json`), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results, null, 1));
