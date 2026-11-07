// This round's stills: the desktop app's own page (built per option by build.mjs) on storytree's own map (the capture
// kit's code-rows seed and its survey), each option at the same views: The library at rest, close round one gate, and a
// second island at rest. The gate is the one today's look draws between two of The library's capabilities carrying the
// most links; every option is framed on its gate for the same links. Counted from the scene for each option: the
// territories' land on both islands (against today's: what the option takes from the territories, or how much bigger an
// island would have to be to give it back) and the gates drawn.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/r-room/tools/capture.mjs [option ...] [--retake]
// (today first: the other options read the gate it picked from its measurements). --retake writes into r-room/stills.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../../packages/forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../../../packages/forest/src/view/zoom-detail.ts';
import { buildOption } from './build.mjs';
import { OPTIONS } from './variants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(path.dirname(here), 'stills');
const { seed, survey } = captureSeed('code-rows');
const storyOf = title => seed.tree.stories.find(story => story.title === title).id;
const ISLANDS = { library: storyOf('The library'), second: storyOf(process.env.SECOND ?? 'The command line') };
const REST = Number(process.env.REST ?? 2.8), CLOSE = Number(process.env.CLOSE ?? 7), SECOND_REST = Number(process.env.SECOND_REST ?? 4.4);
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const names = asked.length ? asked : Object.keys(OPTIONS);
const out = captureOutput(pictures);
const measuresFile = path.join(out, 'measurements.json');

const until = (page, predicate, arg, timeout = 600_000) => page.waitForFunction(predicate, arg, { timeout, polling: 250 });
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
const faceStory = async (page, settle, story, zoom) => {
  if (!await page.evaluate(s => window.storytreeGlobe.face({ kind: 'story', story: s }), story)) throw new Error(`no camera stop for ${story}`);
  await until(page, () => window.storytreeGlobe.still());
  await zoomTo(page, settle, zoom);
};
/** An island's territories' land (the area of its territory meshes, in the island's own units), and its gates. */
const islandMeasures = (page, story) => page.evaluate(s => {
  const island = window.__globe.scene.getObjectByName(`planet:${s}`), V = window.__globe.camera.position.constructor;
  let land = 0;
  const gates = new Set();
  island.traverse(o => {
    if (o.userData?.gate === true) gates.add(o.userData.index);
    if (!o.isMesh || !/^territory:/.test(o.name) || o.name === 'territory:unclaimed' || o.name === 'territory:mapped') return;
    const p = o.geometry.getAttribute('position'), a = new V(), b = new V(), c = new V();
    for (let k = 0; k + 2 < p.count; k += 3) {
      a.fromBufferAttribute(p, k); b.fromBufferAttribute(p, k + 1); c.fromBufferAttribute(p, k + 2);
      land += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    }
  });
  return { territoryLand: Math.round(land * 10) / 10, gates: gates.size };
}, story);
/** The gate posts of The library, each with its links, pair and place in the island's frame, nearest the middle of the view first. */
const gatesOf = (page, story) => page.evaluate(s => {
  const { scene, camera } = window.__globe, island = scene.getObjectByName(`planet:${s}`), found = [];
  scene.updateMatrixWorld(true);
  island.traverse(o => {
    if (o.userData?.gate !== true || !/:1$/.test(o.name)) return;
    o.geometry.computeBoundingBox();
    const centre = o.geometry.boundingBox.getCenter(new camera.position.constructor());
    const world = centre.clone().applyMatrix4(o.matrixWorld), screen = world.clone().project(camera);
    const local = world.clone().applyMatrix4(island.matrixWorld.clone().invert());
    found.push({ links: [...o.userData.links], between: [...o.userData.between], at: local.toArray(), off: Math.hypot(screen.x, screen.y) });
  });
  return found.sort((a, b) => a.off - b.off);
}, story);
const facePoint = (page, story, at) => page.evaluate(({ s, at }) => {
  const island = window.__globe.scene.getObjectByName(`planet:${s}`);
  island.updateWorldMatrix(true, false);
  const world = new window.__globe.camera.position.constructor(...at).applyMatrix4(island.matrixWorld).toArray();
  return window.storytreeGlobe.face({ kind: 'point', at: world });
}, { s: story, at });

const all = existsSync(measuresFile) ? JSON.parse(readFileSync(measuresFile, 'utf8')) : {};
for (const name of names) {
  const dist = await buildOption(name);
  const started = performance.now(), found = { title: OPTIONS[name].title };
  const phase = m => console.error(`[${name} +${Math.round((performance.now() - started) / 1000)}s] ${m}`);
  await runCapture({
    folder: pictures, dist, seed, survey,
    prepare: async ({ page, settle }) => {
      await until(page, () => document.body.dataset.state === 'ready');
      for (const button of ['Close help', 'Close app menu', 'Hide sidebar']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
      phase('waiting for both islands laid out with their roads');
      await until(page, ids => ids.every(id => !!window.__globe.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-roads')), Object.values(ISLANDS));
      phase('laid out');
      await settle(page);
    },
    views: [{
      name: `${name}-library-rest`,
      prepare: async ({ page, settle }) => { await faceStory(page, settle, ISLANDS.library, DETAIL_ZOOM.near * REST); },
      measure: async ({ page }) => {
        found.library = await islandMeasures(page, ISLANDS.library);
        if (name === 'today') {
          const gate = (await gatesOf(page, ISLANDS.library)).filter(g => !g.between.includes('open')).sort((a, b) => b.links.length - a.links.length)[0];
          found.gateLinks = gate.links; found.gateBetween = gate.between; found.gateAt = gate.at;
        }
        return undefined;
      },
    }, {
      name: `${name}-library-gate`,
      prepare: async ({ page, settle }) => {
        const wanted = new Set(name === 'today' ? found.gateLinks : all.today.gateLinks);
        const gates = await gatesOf(page, ISLANDS.library);
        // An option that draws no gate posts (E) keeps today's layout, so it is framed where today's gate stands.
        const best = gates.length === 0 ? { links: [], between: [], at: all.today.gateAt, shared: 0 }
          : gates.map(g => ({ ...g, shared: g.links.filter(l => wanted.has(l)).length })).sort((a, b) => b.shared - a.shared)[0];
        if (gates.length > 0 && !best.shared) throw new Error(`${name}: no gate carries today's gate's links`);
        found.gate = { links: best.links, between: best.between, shared: best.shared };
        await zoomTo(page, settle, DETAIL_ZOOM.near);
        if (!await facePoint(page, ISLANDS.library, best.at)) throw new Error('no camera stop for the gate');
        await until(page, () => window.storytreeGlobe.still());
        await zoomTo(page, settle, DETAIL_ZOOM.near * CLOSE);
        // The camera stop leaves the gate a little off the middle: drag it there, as a hand would.
        const at = await page.evaluate(({ s, at }) => {
          const { scene, camera } = window.__globe, island = scene.getObjectByName(`planet:${s}`), box = document.querySelector('canvas').getBoundingClientRect();
          scene.updateMatrixWorld(true);
          const p = new camera.position.constructor(...at).applyMatrix4(island.matrixWorld).project(camera);
          return { x: box.left + (p.x + 1) / 2 * box.width, y: box.top + (1 - p.y) / 2 * box.height, middle: { x: box.left + box.width / 2, y: box.top + box.height / 2 } };
        }, { s: ISLANDS.library, at: best.at });
        await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.middle.x, at.middle.y, { steps: 16 }); await page.mouse.up();
        await settle(page, 12);
      },
    }, {
      name: `${name}-second-rest`,
      prepare: async ({ page, settle }) => { await faceStory(page, settle, ISLANDS.second, DETAIL_ZOOM.near * SECOND_REST); },
      measure: async ({ page }) => { found.second = await islandMeasures(page, ISLANDS.second); return undefined; },
    }],
  });
  all[name] = found;
  writeFileSync(measuresFile, JSON.stringify(all, null, 1) + '\n');
  phase(JSON.stringify(found));
}
