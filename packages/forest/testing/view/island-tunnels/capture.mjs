// One gate per linked pair, and tunnels under a third territory (ADR-1253 D3): storytree's own map (the code-rows snapshot and
// its survey) as the app opens it, then The library close up, where its roads crossed third territories. Counts, from the
// scene, The library's gates and tunnel portals, and times each island's road routing in its worker, from the island's ask
// posted to its roads answered. `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/island-tunnels).
// Run on a checkout of main as well, for the pictures before.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'island-tunnels');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[island tunnels +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const library = seed.tree.stories.find(story => story.title === 'The library');
const libraryCapabilities = (library.capabilities ?? []).map(c => c.id ?? c);
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
const closeUp = async (page, settle, times) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), library.id)) throw new Error('no camera stop for The library');
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await zoomTo(page, settle, DETAIL_ZOOM.near * times);
};
/** A picture round the `nth` tunnel portal on The library at `times` the near zoom: the globe turns to face The library, then
 * the portal, read where it stands as The library faces the viewer (a face turns the globe, so a point read before is stale),
 * so the eye the globe's controls own looks straight at it. */
const around = async (page, settle, name, nth, times) => {
  await closeUp(page, settle, 1);
  const at = before === undefined ? (await portalsAt(page))[nth] : before[nth];
  if (!await page.evaluate(at => window.storytreeGlobe.face({ kind: 'point', at }), at)) throw new Error(`no camera stop for portal ${nth}`);
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await zoomTo(page, settle, DETAIL_ZOOM.near * times);
  await page.screenshot({ path: path.join(captureOutput(pictures), `${name}.png`), timeout: 180_000 });
};
/** Where in the scene each tunnel portal on The library stands. */
const portalsAt = page => page.evaluate(story => {
  const { scene, camera } = window.__globe, found = [];
  scene.getObjectByName(`planet:${story}`)?.traverse(o => {
    if (!o.name.startsWith('tunnel-portal:')) return;
    o.geometry.computeBoundingBox();
    found.push(o.geometry.boundingBox.getCenter(new camera.position.constructor()).applyMatrix4(o.matrixWorld).toArray());
  });
  return found;
}, library.id);
/** The library's road marks, counted from the scene: gates (a post either side), tunnel portals and road ribbons. */
const measure = page => page.evaluate(story => {
  const island = window.__globe.scene.getObjectByName(`planet:${story}`), found = { gates: 0, portals: 0, roads: 0 };
  island?.traverse(o => {
    if (/^gate-post:\d+:1$/.test(o.name)) found.gates++;
    if (o.name.startsWith('tunnel-portal:')) found.portals++;
    if (/^road:\d+$/.test(o.name)) found.roads++;
  });
  return found;
}, library.id);
const results = {};
// Main draws no tunnel: there the close-ups stand where this branch's portals do, read from its measurements (--at <file>).
const before = process.argv.includes('--at') ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--at') + 1], 'utf8')).portalsAt : undefined;

await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle, bridge }) => {
    // Every island's ask to the territory worker, timed until its answer, from a fresh load.
    await page.addInitScript(() => {
      const Original = window.Worker;
      window.__routings = [];
      window.Worker = class extends Original {
        postMessage(message, ...rest) {
          if (message && message.roads) {
            const routing = { capabilities: message.roads.names.map(n => n.capability), lanes: message.roads.docks.reduce((n, d) => n + d.links.length, 0), at: performance.now() };
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
    const mine = routings.filter(r => r.capabilities.some(c => libraryCapabilities.includes(c)));
    results.routing = {
      islands: routings.length,
      theLibraryMs: mine.map(r => r.ms), theLibraryLanesAshore: mine.map(r => r.lanes),
      slowestMs: Math.max(...routings.flatMap(r => (r.ms === undefined ? [] : [r.ms]))), unanswered: routings.filter(r => r.ms === undefined).length, totalMs: routings.reduce((n, r) => n + (r.ms ?? 0), 0),
    };
  },
  views: [{
    name: 'the-library',
    prepare: async ({ page, settle }) => closeUp(page, settle, 1.4),
    measure: async ({ page }) => (results.theLibrary = await measure(page)),
  }, {
    name: 'the-library-tunnels',
    picture: false,
    // Round each tunnel's first portal; on main, which draws none, round where this branch's stand (--at <its measurements.json>).
    prepare: async ({ page, settle }) => {
      results.portalsAt = before === undefined ? await portalsAt(page) : before;
      for (const [k, nth] of [0, 2].entries()) if (results.portalsAt[nth] !== undefined) await around(page, settle, `the-library-tunnel-${k + 1}`, nth, 10);
    },
    measure: async ({ page }) => measure(page),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
