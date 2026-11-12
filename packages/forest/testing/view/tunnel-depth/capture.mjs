// Tunnels read as 3D (increment_2332a8f83f7b): storytree's own map (the code-rows snapshot and its survey) as the app opens
// it, with The library given extra links (`--links`) so its roads must go under a third territory, then every tunnel on
// every island framed on the middle of its two portals and on each portal. Counts what the tunnels add to the scene, and
// times each island's road routing in its worker, as island-tunnels' capture does. `node --import tsx capture.mjs --links
// <i:j,…> --prefix <name>` (append --retake to write into src/view/evidence/tunnel-depth). Run on a checkout of main as
// well, with `--at <this branch's measurements.json>`, so its pictures stand where this branch's tunnels do.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'tunnel-depth');
const { seed, survey } = captureSeed('code-rows');
// storytree's own map routes every road round a third territory today, so The library is given extra links that cannot be:
// `--links i:j,…` makes its i-th capability depend on its j-th (the seed's order).
const library = seed.tree.stories.find(story => story.title === 'The library');
const extra = process.argv.includes('--links') ? process.argv[process.argv.indexOf('--links') + 1].split(',').map(pair => pair.split(':').map(Number)) : [];
for (const [i, j] of extra) { const from = library.capabilities[i], to = library.capabilities[j]; from.dependsOn = [...new Set([...(from.dependsOn ?? []), to.id ?? to])]; }
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[tunnel depth +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
// `--prefix <name>` names this run's pictures, so runs on different extra links sit side by side.
const prefix = process.argv.includes('--prefix') ? `${process.argv[process.argv.indexOf('--prefix') + 1]}-` : '';
const times = Number(process.argv.includes('--times') ? process.argv[process.argv.indexOf('--times') + 1] : 8);
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
/** Every tunnel on the map: its island, the links it carries, and its portals' places on the island, paired by their links. */
const tunnelsAt = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, found = [];
  scene.traverse(island => {
    if (!island.name.startsWith('planet:') || island.name === 'planet:shell') return;
    const portals = [];
    island.traverse(o => {
      if (!o.name.startsWith('tunnel-portal:')) return;
      o.geometry.computeBoundingBox();
      // In the island's own frame: the globe turns as it faces each point, so a point read in the scene goes stale.
      const local = island.matrixWorld.clone().invert().multiply(o.matrixWorld);
      portals.push({ links: [...(o.userData.links ?? [])].join(','), at: o.geometry.boundingBox.getCenter(new camera.position.constructor()).applyMatrix4(local).toArray() });
    });
    const byLinks = new Map();
    for (const p of portals) byLinks.set(p.links, [...(byLinks.get(p.links) ?? []), p.at]);
    for (const [links, ats] of byLinks) for (let k = 0; k + 1 < ats.length; k += 2) {
      const [a, b] = [ats[k], ats[k + 1]];
      found.push({ island: island.name.slice('planet:'.length), links, portals: [a, b], at: a.map((v, i) => (v + b[i]) / 2) });
    }
  });
  return found;
});
/** Turn the globe to face `at` on `island`, read in the scene as it stands now. */
const faceOn = (page, island, at) => page.evaluate(({ island, at }) => {
  const object = window.__globe.scene.getObjectByName(`planet:${island}`);
  object.updateWorldMatrix(true, false);
  const world = new window.__globe.camera.position.constructor(...at).applyMatrix4(object.matrixWorld).toArray();
  return window.storytreeGlobe.face({ kind: 'point', at: world });
}, { island, at });
/** What the tunnels add to the scene, counted from it: their meshes (each a draw call), and the triangles they hold; and the
 * WebGL renderer the page drew with, since a software one makes any frame time a measure of the machine. */
const tunnelCost = page => page.evaluate(() => {
  const found = { meshes: 0, triangles: 0 };
  window.__globe.scene.traverse(o => {
    if (!o.isMesh || !/^(tunnel-|relief-rise)/.test(o.name)) return;
    found.meshes++;
    found.triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
  });
  const gl = document.createElement('canvas').getContext('webgl'), info = gl?.getExtension('WEBGL_debug_renderer_info');
  return { ...found, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown' };
});
const results = {};
// Main's tunnels may stand elsewhere: there the close-ups stand where this branch's do, read from its measurements (--at <file>).
const before = process.argv.includes('--at') ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--at') + 1], 'utf8')).tunnels : undefined;

await runCapture({
  folder: pictures, name: prefix.slice(0, -1) || undefined, dist, seed, survey,
  prepare: async ({ page, settle, bridge }) => {
    await page.addInitScript(() => {
      const Original = window.Worker;
      window.__routings = [];
      window.Worker = class extends Original {
        postMessage(message, ...rest) {
          if (message && message.roads) {
            const routing = { at: performance.now() };
            window.__routings.push(routing);
            this.addEventListener('message', () => { routing.ms = Math.round(performance.now() - routing.at); }, { once: true });
          }
          return super.postMessage(message, ...rest);
        }
      };
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await bridge.ready(page);
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'every island laid out with its roads', () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('island-roads')) laid++; } }); return n > 0 && laid === n; });
    await settle(page);
    const routings = await page.evaluate(() => window.__routings);
    results.routing = { islands: routings.length, slowestMs: Math.max(...routings.flatMap(r => (r.ms === undefined ? [] : [r.ms]))), totalMs: routings.reduce((n, r) => n + (r.ms ?? 0), 0) };
  },
  views: [{
    name: 'tunnels',
    picture: false,
    prepare: async ({ page, settle }) => {
      const mine = await tunnelsAt(page);
      results.tunnels = mine;
      results.cost = await tunnelCost(page);
      for (const [k, tunnel] of (before ?? mine).entries()) {
        await zoomTo(page, settle, DETAIL_ZOOM.near);
        if (!await faceOn(page, tunnel.island, tunnel.at)) throw new Error(`no camera stop for tunnel ${k + 1}`);
        await until(page, 'the globe still', () => window.storytreeGlobe.still());
        await zoomTo(page, settle, DETAIL_ZOOM.near * times);
        await page.screenshot({ path: path.join(captureOutput(pictures), `${prefix}tunnel-${k + 1}.png`), timeout: 180_000 });
        // Each of its ends close up, half as close again.
        for (const [e, end] of tunnel.portals.entries()) {
          await zoomTo(page, settle, DETAIL_ZOOM.near);
          if (!await faceOn(page, tunnel.island, end)) throw new Error(`no camera stop for tunnel ${k + 1}'s end ${e + 1}`);
          await until(page, 'the globe still', () => window.storytreeGlobe.still());
          await zoomTo(page, settle, DETAIL_ZOOM.near * Math.min(times * 1.5, 12));
          await page.screenshot({ path: path.join(captureOutput(pictures), `${prefix}tunnel-${k + 1}-end-${e + 1}.png`), timeout: 180_000 });
        }
      }
    },
    measure: async () => ({ tunnels: results.tunnels.length, islands: [...new Set(results.tunnels.map(t => t.island))].length }),
  }],
});
writeFileSync(path.join(captureOutput(pictures), `${prefix}measurements.json`), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify({ links: extra, routing: results.routing, cost: results.cost, tunnels: results.tunnels.map(t => ({ island: t.island, links: t.links })) }));
