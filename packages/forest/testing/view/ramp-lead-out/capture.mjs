// A road leaving a gate runs down its ramp (increment_24ae471597e5): storytree's own map (the code-rows snapshot and its
// survey) as the app opens it, every ramp on every island (where a road climbs from the open land onto a plateau) framed
// close on the middle of its slope. `node --import tsx capture.mjs --prefix <name>` (append --retake to write into
// src/view/evidence/ramp-lead-out). Run on a checkout of main as well, with `--at <this branch's measurements.json>`, so its
// pictures stand where this branch's ramps do.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'ramp-lead-out');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[ramp lead-out +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const prefix = process.argv.includes('--prefix') ? `${process.argv[process.argv.indexOf('--prefix') + 1]}-` : '';
const times = Number(process.argv.includes('--times') ? process.argv[process.argv.indexOf('--times') + 1] : 12);
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
/** Every ramp on the map: its island, whether a gate stands at its top, and the middle of its slope in the island's own frame. */
const rampsAt = page => page.evaluate(() => {
  const found = [];
  window.__globe.scene.traverse(island => {
    if (!island.name.startsWith('planet:') || island.name === 'planet:shell') return;
    const rings = island.getObjectByName('gate-ring');
    if (!rings) return;
    rings.updateWorldMatrix(true, false);
    const { relief, onSurface } = rings.userData;
    // In the island's own frame: the globe turns as it faces each point, so a point read in the scene goes stale.
    const local = island.matrixWorld.clone().invert().multiply(rings.matrixWorld);
    for (const r of relief.ramps) {
      const mid = { x: r.at.x + r.out.x * relief.rampDepth / 2, z: r.at.z + r.out.z * relief.rampDepth / 2 };
      found.push({ island: island.name.slice('planet:'.length), gate: r.gate !== undefined, at: onSurface(mid).applyMatrix4(local).toArray() });
    }
  });
  return found;
});
const faceOn = (page, island, at) => page.evaluate(({ island, at }) => {
  const object = window.__globe.scene.getObjectByName(`planet:${island}`);
  object.updateWorldMatrix(true, false);
  const world = new window.__globe.camera.position.constructor(...at).applyMatrix4(object.matrixWorld).toArray();
  return window.storytreeGlobe.face({ kind: 'point', at: world });
}, { island, at });
const results = {};
const before = process.argv.includes('--at') ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--at') + 1], 'utf8')).ramps : undefined;

await runCapture({
  folder: pictures, name: prefix.slice(0, -1) || undefined, dist, seed, survey,
  prepare: async ({ page, settle, bridge }) => {
    await bridge.ready(page);
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'every island laid out with its roads', () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('island-roads')) laid++; } }); return n > 0 && laid === n; });
    await settle(page);
  },
  views: [{
    name: 'ramps',
    picture: false,
    prepare: async ({ page, settle }) => {
      results.ramps = await rampsAt(page);
      for (const [k, ramp] of (before ?? results.ramps).entries()) {
        await zoomTo(page, settle, DETAIL_ZOOM.near);
        if (!await faceOn(page, ramp.island, ramp.at)) throw new Error(`no camera stop for ramp ${k + 1}`);
        await until(page, 'the globe still', () => window.storytreeGlobe.still());
        await zoomTo(page, settle, DETAIL_ZOOM.near * times);
        await page.screenshot({ path: path.join(captureOutput(pictures), `${prefix}ramp-${k + 1}.png`), timeout: 180_000 });
      }
    },
    measure: async () => ({ ramps: results.ramps.length, islands: [...new Set(results.ramps.map(r => r.island))].length }),
  }],
});
writeFileSync(path.join(captureOutput(pictures), `${prefix}measurements.json`), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify({ ramps: results.ramps.length, gated: results.ramps.filter(r => r.gate).length }));
