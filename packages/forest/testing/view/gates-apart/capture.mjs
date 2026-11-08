// Island gates stand apart where their border has room (increment_af16a373441d): storytree's own map (the code-rows
// snapshot and its survey, a fresh pair built in a scratch folder when the snapshot lacks an island `--islands` names, or a
// given pair: `--seed <folder holding seed.json.gz and survey.json>`) as the app opens it, every island's ask to route its roads written down (`--dump <asks.json>`,
// for gates.mjs to measure), and a picture of each island `--islands <title,…>` names, whole and close on each of its
// gates' clusters. `node --import tsx capture.mjs --prefix <name> [--islands "Code map"] [--dump asks.json]` (append
// --retake to write into src/view/evidence/gates-apart). Run on a checkout of main as well, with
// `--at <this branch's measurements.json>`, so its close pictures stand where this branch's do.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { seedHolding } from '../../../../../apps/desktop/src/capture/fresh-seed.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'gates-apart');
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const given = arg('--seed');
const named = (arg('--islands') ?? 'Code map').split(',').filter(Boolean);
const { seed, survey } = given === undefined ? await seedHolding(named) : {
  seed: JSON.parse(gunzipSync(readFileSync(path.join(given, 'seed.json.gz'))).toString('utf8')),
  survey: JSON.parse(readFileSync(path.join(given, 'survey.json'), 'utf8')),
};
const prefix = arg('--prefix') ?? 'map', dump = arg('--dump');
const stories = named.map(title => {
  const story = seed.tree.stories.find(s => s.id === title || s.title.toLowerCase() === title.toLowerCase());
  if (!story) throw new Error(`no story titled ${title}`);
  return story;
});
const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[gates apart +${Math.round(performance.now() - started)}ms] ${message}`);
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
/** Each gate's posts on an island, in the island's own frame, from the scene. */
const gatesOn = (page, island) => page.evaluate(island => {
  const object = window.__globe.scene.getObjectByName(`planet:${island}`), found = [];
  object.updateWorldMatrix(true, false);
  const local = object.matrixWorld.clone().invert();
  object.traverse(o => {
    if (!o.name.startsWith('gate-post')) return;
    o.updateWorldMatrix(true, false);
    o.geometry.computeBoundingBox();
    const middle = o.geometry.boundingBox.getCenter(new window.__globe.camera.position.constructor());
    found.push({ gate: o.name.split(':')[1], at: middle.applyMatrix4(o.matrixWorld).applyMatrix4(local).toArray() });
  });
  return found;
}, island);
const faceOn = (page, island, at) => page.evaluate(({ island, at }) => {
  const object = window.__globe.scene.getObjectByName(`planet:${island}`);
  object.updateWorldMatrix(true, false);
  const world = new window.__globe.camera.position.constructor(...at).applyMatrix4(object.matrixWorld).toArray();
  return window.storytreeGlobe.face({ kind: 'point', at: world });
}, { island, at });
const results = {};
const before = arg('--at') ? JSON.parse(readFileSync(arg('--at'), 'utf8')) : undefined;

await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle, bridge }) => {
    await page.addInitScript(() => {
      // Each island's ask to route its roads, written down as it is posted to the worker.
      window.__roads = [];
      const Original = window.Worker;
      window.Worker = class extends Original {
        postMessage(message, ...rest) {
          if (message && message.roads) window.__roads.push(message.roads);
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
    if (dump !== undefined) {
      const asks = await page.evaluate(() => window.__roads);
      const storyOf = new Map(seed.tree.stories.flatMap(story => (story.capabilities ?? []).map(c => [c.id ?? c, story])));
      const byStory = new Map();
      for (const ask of asks) {
        const story = storyOf.get(ask.map.territories.find(t => t.capability)?.capability);
        if (story) byStory.set(story.id, { story: story.id, title: story.title, ask });
      }
      writeFileSync(dump, JSON.stringify([...byStory.values()]) + '\n');
      phase(`${byStory.size} islands' road asks written to ${dump}`);
    }
  },
  views: stories.flatMap(story => [{
    name: `${prefix}-${slug(story.title)}`,
    prepare: async ({ page, settle }) => {
      if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), story.id)) throw new Error(`no camera stop for ${story.title}`);
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await zoomTo(page, settle, DETAIL_ZOOM.near * 1.4);
      results[story.id] = { posts: await gatesOn(page, story.id) };
    },
    measure: async () => ({ posts: results[story.id].posts.length }),
  }, ...(before?.[story.id]?.close ?? [undefined, undefined, undefined]).map((_, k) => ({
    name: `${prefix}-${slug(story.title)}-close-${k + 1}`,
    prepare: async ({ page, settle }) => {
      // Close on the k-th tightest pair of posts of different gates (main's, when `--at` gives them).
      const close = before?.[story.id]?.close ?? tightest(results[story.id].posts);
      results[story.id].close = close;
      const at = close[k];
      if (at === undefined) return;
      await zoomTo(page, settle, DETAIL_ZOOM.near);
      if (!await faceOn(page, story.id, at)) throw new Error(`no camera stop for ${story.title}'s cluster ${k + 1}`);
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await zoomTo(page, settle, DETAIL_ZOOM.near * 6);
    },
    measure: async () => ({}),
  }))]),
});
/** The middles of the three tightest pairs of posts of two different gates. */
function tightest(posts) {
  const pairs = [];
  posts.forEach(({ gate: g, at: p }, i) => posts.forEach(({ gate: h, at: q }, j) => { if (j > i && g !== h) pairs.push({ d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), at: p.map((v, k) => (v + q[k]) / 2) }); }));
  pairs.sort((a, b) => a.d - b.d);
  const picked = [];
  for (const p of pairs) if (picked.length < 3 && !picked.some(q => Math.hypot(...q.map((v, k) => v - p.at[k])) < 0.02)) picked.push(p.at);
  return picked;
}
writeFileSync(path.join(captureOutput(pictures), `${prefix}-measurements.json`), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.posts.length]))));
