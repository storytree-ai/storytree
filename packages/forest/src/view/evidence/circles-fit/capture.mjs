// Seeded, repeatable capture of one build of the actual desktop page: `node capture.mjs <before|after>`
// serves dist/<label>/ (made by build.mjs) to headless Chromium with a stand-in bridge answering from
// seed.json.gz and survey.json, the same for both builds; same 1440 x 960 viewport, same programmatic
// turns and zoom; nothing is hand-panned. Run under flock /tmp/storytree-heavy.lock. Writes
// <label>-front.png, <label>-world.png, <label>-crowded.png and measurements-<label>.json.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv.slice(2).find(arg => arg !== '--retake');
assert.ok(['before', 'after'].includes(label), 'usage: node capture.mjs <before|after>');
const dist = path.join(here, 'dist', label);
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
const WORLD = seed.tree.stories.find(s => s.title === 'The world').id;
const CROWDED = Object.entries(survey).sort((a, b) => b[1].files.length - a[1].files.length)[0][0];
const ZOOM = 2.6;
await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {

/**
 * Per island, in its own plate coordinates (x, z): circles against surveyed files; circles whose whole
 * disc is not inside their own territory (16 rim points plus the middle, each tested against the own
 * territory mesh's triangles) and those whose disc is not wholly on the ground (poking into the sea);
 * overlapping pairs (middles closer than the sum of radii); radii; the ground's area.
 */
function measure(page) {
  return page.evaluate(() => {
    const { scene, camera } = window.__globe;
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const islands = [];
    scene.traverse(object => {
      if (!object.name.startsWith('planet:story_')) return;
      const local = new V();
      const ground = [], territories = new Map(), circles = [];
      object.traverse(child => {
        if (child.name === 'island-ground') ground.push(child);
        if (child.name.startsWith('territory:')) territories.set(child.name.slice(10), child);
        if (child.name.startsWith('file:')) circles.push(child);
      });
      const xz = (mesh, i) => { const at = mesh.geometry.attributes.position; local.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld); object.worldToLocal(local); return [local.x, local.z]; };
      const trianglesOf = mesh => {
        const out = [], index = mesh.geometry.index, n = index ? index.count : mesh.geometry.attributes.position.count;
        for (let t = 0; t < n; t += 3) out.push([0, 1, 2].map(k => xz(mesh, index ? index.getX(t + k) : t + k)));
        return out;
      };
      const inside = ([px, pz], triangles) => triangles.some(([a, b, c]) => {
        const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (d === 0) return false;
        const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[1])) / d;
        const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[1])) / d;
        return u >= -1e-6 && v >= -1e-6 && 1 - u - v >= -1e-6;
      });
      const groundTriangles = ground.flatMap(trianglesOf);
      let groundArea = 0;
      for (const [a, b, c] of groundTriangles) groundArea += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      const territoryTriangles = new Map([...territories].map(([id, mesh]) => [id, trianglesOf(mesh)]));
      const worldScale = object.getWorldScale(new V()).x;
      const RIM = 16;
      const items = circles.map(c => {
        const p = c.getWorldPosition(new V()); object.worldToLocal(p);
        const radius = c.getWorldScale(new V()).x / worldScale;
        const own = territoryTriangles.get(c.userData.capability ?? 'unclaimed');
        const points = [[p.x, p.z], ...Array.from({ length: RIM }, (_, k) => [p.x + radius * Math.cos(2 * Math.PI * k / RIM), p.z + radius * Math.sin(2 * Math.PI * k / RIM)])];
        const outOfOwn = own === undefined ? points.length : points.filter(q => !inside(q, own)).length;
        const offGround = points.filter(q => !inside(q, groundTriangles)).length;
        return { file: c.userData.file, lines: c.userData.lines, capability: c.userData.capability ?? null, x: p.x, z: p.z, radius,
          ownTerritoryExists: own !== undefined, middleInsideOwn: own !== undefined && inside(points[0], own), outOfOwn, offGround };
      });
      const overlapping = [];
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const gap = Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z) - items[i].radius - items[j].radius;
        if (gap < 0) overlapping.push({ a: items[i].file, b: items[j].file, depth: -gap });
      }
      const radii = items.map(i => i.radius);
      const area = items.reduce((s, i) => s + Math.PI * i.radius * i.radius, 0);
      const poking = items.filter(i => i.outOfOwn > 0);
      islands.push({ story: object.name.slice(7), circles: items.length,
        notWhollyInOwnTerritory: poking.length, middlesOutsideOwnTerritory: items.filter(i => !i.middleInsideOwn).length,
        notWhollyOnGround: items.filter(i => i.offGround > 0).length,
        overlappingPairs: overlapping.length, deepestOverlap: overlapping.reduce((m, o) => Math.max(m, o.depth), 0),
        minRadius: Math.min(...radii), maxRadius: Math.max(...radii), groundArea, circleAreaOverGround: area / groundArea, islandWorldScale: worldScale,
        poking: poking.sort((a, b) => b.outOfOwn - a.outOfOwn).slice(0, 8).map(i => ({ file: i.file, capability: i.capability, radius: i.radius, rimPointsOutOfOwn: i.outOfOwn, rimPointsOffGround: i.offGround })),
        largest: [...items].sort((a, b) => b.lines - a.lines).slice(0, 3).map(i => ({ file: i.file, lines: i.lines, radius: i.radius })) });
    });
    return { zoom: camera.zoom, islands };
  });
}

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [], warnings = [], failed = [];
  page.on('response', r => { if (r.status() >= 400) failed.push(r.url()); });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    (message.type() === 'warning' ? warnings : errors).push(message.text());
  });
  // Seeded answers stay in the page; every other read uses the kit's typed quiet defaults.
  const bridge = fakeBridge({});
  await bridge.install(page);
  await page.addInitScript(({ data, survey }) => {
    const copy = value => structuredClone(value);
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.projects, current: 'storytree' }),
      chooseProject: async () => ({ projects: data.projects, current: 'storytree' }),
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []),
      codeSurvey: async () => copy(survey),
      windowReadings: async (_, sessions) => sessions.map(session => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] })),
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: [] }),
      contextReadings: async () => [], idleAfterMs: async () => 3600000, leaveAfterMs: async () => 3600000,
    };
  }, { data: seed, survey });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 120000 }).catch(async error => {
    console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + (document.querySelector('.empty')?.innerText ?? '')), errors, urls: failed, warnings: warnings.slice(0, 5) }));
    throw error;
  });
  // Territories and circles arrive with the survey, a beat after the ground: wait until they are drawn.
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  const results = { label, world: WORLD, crowded: CROWDED, zoom: ZOOM };
  results.surveyedFiles = Object.fromEntries(Object.entries(survey).map(([id, v]) => [id, v.files.length]));
  results.titles = Object.fromEntries(seed.tree.stories.map(s => [s.id, s.title]));
  results.measured = await measure(page);
  await page.screenshot({ path: path.join(out, `${label}-front.png`), timeout: 180000 });

  const faceIt = async story => {
    await page.evaluate(id => {
      const { scene, camera } = window.__globe, { rotation, onRotate } = window.__nav;
      const V = camera.position.constructor;
      const at = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize();
      const eye = camera.position.clone().normalize();
      const Q = camera.quaternion.constructor;
      onRotate(new Q().setFromUnitVectors(at, eye).multiply(rotation));
    }, story);
    await settle(page);
  };
  const base = await page.evaluate(() => window.__globe.camera.zoom);
  for (const [story, shot] of [[WORLD, 'world'], [CROWDED, 'crowded']]) {
    await faceIt(story);
    await page.evaluate(({ zoom }) => { const { camera, invalidate } = window.__globe; camera.zoom = zoom; camera.updateProjectionMatrix(); invalidate(); }, { zoom: base * ZOOM });
    await settle(page);
    await page.screenshot({ path: path.join(out, `${label}-${shot}.png`), timeout: 180000 });
  }

  results.browser = await browser.version(); results.errors = errors; results.warnings = [...new Set(warnings)];
  results.seed = seed.stats;
  writeFileSync(path.join(out, `measurements-${label}.json`), JSON.stringify(results, null, 2) + '\n');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results.measured.islands.map(i => [results.titles[i.story], results.surveyedFiles[i.story], i.circles, i.notWhollyInOwnTerritory, i.notWhollyOnGround, i.overlappingPairs, +i.maxRadius.toFixed(2), +i.groundArea.toFixed(0)])));
});
