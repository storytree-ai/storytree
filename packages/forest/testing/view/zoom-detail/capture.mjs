// Every island carries the capability tree's detail, shown by zoom (ADR-1253 D2 as narrowed by ADR-1272 D1, 3.86): storytree's own map (the code-rows
// snapshot and its survey, its 15 islands) as the app opens it, nothing selected. `node --import tsx capture.mjs` (append
// --retake to write into src/view/evidence/zoom-detail). It reads the eye's zoom (CSS pixels per ground unit, `sheetEyeZoom`)
// at the whole-map opening, at the wheel's floor and near The library, counts the islands showing territories, roads and
// capability names at each, times the frames of a slow pan at each and with every island's near marks forced on at once, and
// lists the page's long tasks from opening until every island's roads are routed.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_SLACK, DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'zoom-detail');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[zoom detail +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 300_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 250 }); };
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const library = seed.tree.stories.find(story => story.title === 'The library').id;

/** The eye's zoom, and how many islands show their territories and their roads, each as drawn (it and all it hangs from visible). */
const measure = page => page.evaluate(({ radius, fov }) => {
  const { camera, size, scene } = window.__globe;
  const zoom = Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / (camera.position.length() - radius);
  const shown = object => { for (let at = object; at; at = at.parent) if (!at.visible) return false; return true; };
  const islands = { total: 0, laidOut: 0, territories: 0, roads: 0, capabilityNames: document.querySelectorAll('.planet-nameplate.capability').length };
  scene.traverse(object => {
    if (!object.name.startsWith('planet:') || object.name === 'planet:shell') return;
    islands.total++;
    const borders = object.getObjectByName('territory-borders'), roads = object.getObjectByName('island-roads');
    if (roads !== undefined) islands.laidOut++;
    if (borders !== undefined && shown(borders)) islands.territories++;
    if (roads !== undefined && shown(roads)) islands.roads++;
  });
  return { zoom, ...islands };
}, eye);
/** Stands the eye on its line of sight at `zoom`, as the wheel would, and lets the map draw it. */
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
/** Frame times, in milliseconds, while the eye pans across the map in `steps` small moves, one asked for each frame. */
const frameTimes = (page, steps = 120) => page.evaluate(steps => new Promise(resolve => {
  const { camera, invalidate } = window.__globe, start = camera.position.clone(), times = [];
  let last = performance.now(), step = 0;
  const next = now => {
    times.push(now - last); last = now;
    if (++step > steps) { camera.position.copy(start); invalidate(); times.shift(); resolve(times); return; }
    camera.position.applyAxisAngle({ x: 0, y: 1, z: 0, isVector3: true }, 0.0004);
    camera.lookAt(0, 0, 0); invalidate();
    requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
}), steps);
const summary = times => { const sorted = [...times].sort((a, b) => a - b), at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; return { frames: times.length, median: at(0.5), p95: at(0.95), worst: sorted.at(-1), over50: times.filter(t => t > 50).length }; };

const results = { thresholds: DETAIL_ZOOM, slack: DETAIL_SLACK };
/** Every task over 50 ms the page has run so far, longest first, in milliseconds. */
const longTasks = page => page.evaluate(() => new Promise(resolve => {
  new PerformanceObserver((list, observer) => { observer.disconnect(); resolve(list.getEntries().map(e => Math.round(e.duration)).sort((a, b) => b - a)); })
    .observe({ type: 'longtask', buffered: true });
  setTimeout(() => resolve([]), 2000);
}));
await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    const ready = performance.now();
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'every island laid out with its roads', () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('island-roads')) laid++; } }); return n > 0 && laid === n; });
    results.load = { everyIslandRoutedAfterReadyMs: Math.round(performance.now() - ready), longTasksMs: await longTasks(page) };
    await settle(page);
  },
  views: [{
    name: 'opening-territories',
    measure: async ({ page }) => {
      results.opening = await measure(page);
      results.opening.panFrames = summary(await frameTimes(page));
      return results.opening;
    },
    expect: found => assert.ok(found.territories === found.total && found.roads === 0 && found.capabilityNames === 0, 'the whole map opens on every island\'s territories, no roads, no capability names'),
  }, {
    name: 'floor',
    prepare: async ({ page, settle }) => zoomTo(page, settle, results.opening.zoom / 2),
    measure: async ({ page }) => (results.floor = await measure(page)),
    expect: found => assert.ok(found.territories === found.total && found.roads === 0, 'at the wheel\'s floor, every island\'s territories still, no roads (ADR-1272 D1)'),
  }, {
    name: 'near-the-library',
    prepare: async ({ page, settle }) => {
      await zoomTo(page, settle, results.opening.zoom);
      if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), library)) throw new Error('no camera stop for The library');
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await zoomTo(page, settle, DETAIL_ZOOM.near * 1.4);
    },
    measure: async ({ page }) => {
      results.near = await measure(page);
      results.near.panFrames = summary(await frameTimes(page));
      return results.near;
    },
    expect: found => assert.ok(found.roads === found.total && found.capabilityNames > 0, 'near, every island shows its roads and its capabilities\' names, nothing selected'),
  }, {
    name: 'every-island-near',
    picture: false,
    // Every island's roads, relief and names drawn at once, at the whole map's zoom: more than any view the wheel reaches
    // shows, so the frames are timed at the most the map can draw. The eye stands where the opening framed it.
    prepare: async ({ page, settle }) => zoomTo(page, settle, results.opening.zoom),
    measure: async ({ page }) => {
      const forced = await page.evaluate(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name === 'island-roads' || o.name === 'island-relief') { o.visible = true; n++; } }); window.__globe.invalidate(); return n; });
      results.everyIslandNear = { marksForced: forced, panFrames: summary(await frameTimes(page)) };
      return results.everyIslandNear;
    },
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results, null, 1));
