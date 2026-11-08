// Tunnels as a last resort (increment_fb8987cfd45e): storytree's own map as the app opens it, from the code-rows snapshot
// and its survey (a fresh pair built in a scratch folder when the snapshot lacks an island `--islands` names), or a
// given pair (`--seed <folder holding seed.json.gz and survey.json>`).
//
// - `--dump <asks.json>`: every island's ask to the territory search, answered at once with nothing so the next is asked,
//   written with its story, for search.mjs to search with the score of either side.
// - `--kept <arrangements.json> --prefix <name>`: the map drawn from the arrangements given (each story's seeds, kept under
//   its structure as the page keys it, so nothing is searched), each island's tunnel portals counted from the scene, and a
//   picture of each island `--islands <story,…>` names (append --retake to write into src/view/evidence/tunnel-last-resort).
//
// `node --import tsx capture.mjs …`
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { seedHolding } from '../../../../../apps/desktop/src/capture/fresh-seed.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';
import { structureKey } from '../../../src/territories/kept-layout.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'tunnel-last-resort');
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const given = arg('--seed');
const islands = (arg('--islands') ?? '').split(',').filter(Boolean);
const { seed, survey } = given === undefined ? await seedHolding(islands) : {
  seed: JSON.parse(gunzipSync(readFileSync(path.join(given, 'seed.json.gz'))).toString('utf8')),
  survey: JSON.parse(readFileSync(path.join(given, 'survey.json'), 'utf8')),
};
const storyOf = new Map(seed.tree.stories.flatMap(story => (story.capabilities ?? []).map(c => [c.id ?? c, story.id])));
const titleOf = new Map(seed.tree.stories.map(story => [story.id, story.title]));
const dump = arg('--dump'), keptFile = arg('--kept'), prefix = arg('--prefix') ?? 'map';
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[tunnel last resort +${Math.round(performance.now() - started)}ms] ${message}`);
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
/** Each island's tunnel portals, counted from the scene (a tunnel has two). */
const portals = page => page.evaluate(() => {
  const found = {};
  window.__globe.scene.traverse(island => {
    if (!island.name.startsWith('planet:') || island.name === 'planet:shell') return;
    let n = 0;
    island.traverse(o => { if (o.name.startsWith('tunnel-portal:')) n++; });
    found[island.name.slice('planet:'.length)] = n;
  });
  return found;
});

// The arrangements to draw from, each kept under its island's structure as the page keys it.
const shelf = {};
if (keptFile !== undefined) {
  for (const { story, ask, seeds } of JSON.parse(readFileSync(keptFile, 'utf8'))) {
    shelf[`storytree.territories.${story}`] = JSON.stringify({ key: structureKey(ask.shares), seeds });
  }
}
const results = {};

await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle, bridge }) => {
    await page.addInitScript(({ shelf, dump }) => {
      for (const [key, value] of Object.entries(shelf)) localStorage.setItem(key, value);
      window.__asks = [];
      if (!dump) return;
      // Each search asked is written down and answered with nothing at once, so the next island is asked.
      const Original = window.Worker;
      window.Worker = class extends Original {
        postMessage(message, ...rest) {
          if (message && message.shares && message.coast) {
            window.__asks.push(message);
            setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { found: undefined } })));
            return;
          }
          return super.postMessage(message, ...rest);
        }
      };
    }, { shelf, dump: dump !== undefined });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await bridge.ready(page);
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, 'every island laid out with its roads', () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('island-roads')) laid++; } }); return n > 0 && laid === n; });
    await settle(page);
    if (dump !== undefined) {
      // The asks come one at a time: wait until a second passes with none new.
      let seen = -1;
      for (let count = await page.evaluate(() => window.__asks.length); count !== seen; count = await page.evaluate(() => window.__asks.length)) { seen = count; await page.waitForTimeout(1000); }
      const asks = await page.evaluate(() => window.__asks);
      const byStory = new Map();
      for (const ask of asks) {
        const story = storyOf.get(ask.shares.find(s => s.capability)?.capability);
        const { kept: _, ...rest } = ask;
        byStory.set(story, { story, title: titleOf.get(story), ask: rest });
      }
      writeFileSync(dump, JSON.stringify([...byStory.values()]) + '\n');
      phase(`${byStory.size} islands' asks written to ${dump}`);
    }
    results.portals = await portals(page);
  },
  views: islands.map(story => ({
    name: `${prefix}-${titleOf.get(story).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    prepare: async ({ page, settle }) => {
      if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), story)) throw new Error(`no camera stop for ${story}`);
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await zoomTo(page, settle, DETAIL_ZOOM.near * 1.4);
    },
    measure: async () => ({ portals: results.portals[story] ?? 0 }),
  })),
});
const tunnels = Object.fromEntries(Object.entries(results.portals).map(([story, n]) => [titleOf.get(story) ?? story, n / 2]));
if (dump === undefined) writeFileSync(path.join(captureOutput(pictures), `${prefix}-measurements.json`), JSON.stringify({ tunnels }, null, 1) + '\n');
console.log(JSON.stringify({ tunnels }));
