// Seeded, repeatable capture of the actual desktop page: same seed (the knowledge-under-islands
// snapshot, so the pictures compare with its production-*.png), same 1440 x 960 viewport, same
// programmatic turns; nothing is hand-panned. Run under flock /tmp/storytree-heavy.lock after
// `node build.mjs`. Measures what can be counted before anyone looks, and writes measurements.json.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
// survey.json is readCodeSurvey(<this checkout>, seed.tree), precomputed by `tsx survey.mjs`.
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
await withCapture({ folder: here, dist: path.join(here, 'dist') }, async ({ browser, origin, out, settle }) => {


/** Per island: its territories, borders and whether every territory vertex lies inside the coast (the ground's triangles, in plate-local x/z). */
function measure(page) {
  return page.evaluate(() => {
    const { scene, camera, gl, size } = window.__globe;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const islands = [];
    scene.traverse(object => {
      if (!object.name.startsWith('planet:story_')) return;
      const local = new V();
      const ground = [], territories = [], borders = [];
      object.traverse(child => {
        if (child.name === 'island-ground') ground.push(child);
        if (child.name.startsWith('territory:')) territories.push(child);
        if (child.name === 'territory-borders') borders.push(child);
      });
      const xz = (mesh, i) => { const at = mesh.geometry.attributes.position; local.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld); object.worldToLocal(local); return [local.x, local.z]; };
      const triangles = [];
      for (const mesh of ground) {
        const index = mesh.geometry.index;
        for (let t = 0; t < index.count; t += 3) triangles.push([0, 1, 2].map(k => xz(mesh, index.getX(t + k))));
      }
      const outside = ([px, pz]) => {
        let best = Infinity;
        for (const [a, b, c] of triangles) {
          const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
          if (d === 0) continue;
          const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[1])) / d;
          const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[1])) / d;
          const w = 1 - u - v;
          if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) return 0;
          // distance to the triangle's edges
          for (const [p, q] of [[a, b], [b, c], [c, a]]) {
            const ex = q[0] - p[0], ez = q[1] - p[1], len = ex * ex + ez * ez || 1;
            const t = Math.max(0, Math.min(1, ((px - p[0]) * ex + (pz - p[1]) * ez) / len));
            best = Math.min(best, Math.hypot(px - p[0] - t * ex, pz - p[1] - t * ez));
          }
        }
        return best;
      };
      let worst = 0, vertices = 0, worstTerritory = 0, worstBorder = 0, offending = [];
      for (const mesh of [...territories, ...borders]) {
        const at = mesh.geometry.attributes.position;
        for (let i = 0; i < at.count; i++) {
          vertices++; const d = outside(xz(mesh, i)); worst = Math.max(worst, d);
          if (mesh.name === 'territory-borders') worstBorder = Math.max(worstBorder, d); else worstTerritory = Math.max(worstTerritory, d);
          if (d > 0.05 && !offending.includes(mesh.name)) offending.push(mesh.name);
        }
      }
      let borderSegments = 0;
      for (const b of borders) borderSegments += b.geometry.attributes.position.count / 2;
      islands.push({ story: object.name.slice(7), territoryMeshes: territories.length,
        claimed: territories.filter(t => t.userData.capability).map(t => ({ capability: t.userData.capability, triangles: t.geometry.attributes.position.count / 3 })).length,
        unclaimed: territories.filter(t => t.name === 'territory:unclaimed').length,
        territories: territories.map(t => ({ name: t.name, triangles: t.geometry.attributes.position.count / 3, opacity: t.material.opacity, depthWrite: t.material.depthWrite })),
        worstTerritory, worstBorder, offending, borderSegments, borderMeshes: borders.length, verticesChecked: vertices, worstDistanceOutsideCoast: worst,
        groundTriangles: triangles.length });
    });
    const canvas = gl.domElement.getBoundingClientRect();
    const ctx = gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL), zoom: camera.zoom, canvas: { w: canvas.width, h: canvas.height, size }, islands };
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
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(({ data, survey }) => {
    const copy = value => structuredClone(value);
    let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
    window.storytreeAnswers = {
      projectSelection: async () => copy({ projects: data.projects, current }),
      chooseProject: async name => { current = name; return copy({ projects: data.projects, current }); },
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => copy(survey),
    };
  }, { data: seed, survey });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 60000 }).catch(async error => {
    console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + (document.querySelector('.empty')?.innerText ?? '')), errors, urls: failed, warnings: warnings.slice(0, 5) }));
    throw error;
  });
  // Territories arrive with the survey, a beat after the ground: wait until they are drawn.
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('territory:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);
  const results = {};
  results.front = await measure(page);
  await page.screenshot({ path: path.join(out, 'front.png'), timeout: 180000 });

  // The densest island: the one with the most territories (ties: most border segments).
  const densest = [...results.front.islands].sort((a, b) => b.territoryMeshes - a.territoryMeshes || b.borderSegments - a.borderSegments)[0];
  results.densest = densest.story;
  // Face it: the world rotation that takes the island's direction onto the camera's.
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
  await faceIt(densest.story);
  results.densestFaced = await measure(page);
  await page.screenshot({ path: path.join(out, 'densest-resting.png'), timeout: 180000 });
  await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom *= 2.6; camera.updateProjectionMatrix(); invalidate(); });
  await settle(page);
  results.closeUp = await measure(page);
  await page.screenshot({ path: path.join(out, 'close-up.png'), timeout: 180000 });

  // Diagnostic: the island whose territories reach furthest past its coast, faced at the same close-up zoom.
  const worstIsland = [...results.front.islands].sort((a, b) => b.worstDistanceOutsideCoast - a.worstDistanceOutsideCoast)[0];
  results.worstOutside = { story: worstIsland.story, distance: worstIsland.worstDistanceOutsideCoast, offending: worstIsland.offending };
  await faceIt(worstIsland.story);
  await page.screenshot({ path: path.join(out, 'worst-outside-close-up.png'), timeout: 180000 });
  await faceIt(densest.story);

  // Click one territory of the densest island (its largest claimed one, at its biggest triangle's centre).
  const target = await page.evaluate(id => {
    const { scene, camera, gl } = window.__globe;
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const island = scene.getObjectByName(`planet:${id}`);
    let best;
    island.traverse(o => { if (o.name.startsWith('territory:') && o.userData.capability && (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o; });
    const at = best.geometry.attributes.position, tri = [0, 1, 2].map(k => new V().fromBufferAttribute(at, k).applyMatrix4(best.matrixWorld));
    // the centroid of the territory's own first triangles (up to 6), so the ray lands inside it
    const pts = []; for (let i = 0; i < Math.min(at.count, 3); i++) pts.push(new V().fromBufferAttribute(at, i).applyMatrix4(best.matrixWorld));
    const c = pts.reduce((s, p) => s.add(p), new V()).multiplyScalar(1 / pts.length);
    const p = c.clone().project(camera), box = gl.domElement.getBoundingClientRect();
    return { name: best.name, capability: best.userData.capability, x: box.left + (p.x + 1) * box.width / 2, y: box.top + (1 - p.y) * box.height / 2 };
  }, densest.story);
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(id => document.body.dataset.selected === id, densest.story, { timeout: 10000 });
  await settle(page);
  const opened = await page.evaluate(() => ({ selected: document.body.dataset.selected,
    detail: [...document.querySelectorAll('.panel-detail')].map(n => ({ capability: n.dataset.capabilityId, heading: n.querySelector('h1,h2,h3,h4,summary')?.textContent?.trim() })),
    marked: [...document.querySelectorAll('.panel-diagram .selected')].map(n => n.dataset.capabilityId) }));
  results.click = { target, opened, opensOnClickedCapability: opened.marked.includes(target.capability) && opened.detail.some(d => d.capability === target.capability) };
  results.clickView = await measure(page);
  await page.screenshot({ path: path.join(out, 'click-territory.png'), timeout: 180000 });
  // Full picture with the panel, zoomed back to rest.
  await page.evaluate(() => { const { camera, invalidate } = window.__globe; camera.zoom /= 2.6; camera.updateProjectionMatrix(); invalidate(); });
  await settle(page);
  await page.screenshot({ path: path.join(out, 'click-territory-resting.png'), timeout: 180000 });

  // Reported, not asserted: a territory vertex further than 0.05 ground units outside the coast is a finding, not a failed capture.
  results.insideCoast = Object.fromEntries(['front', 'densestFaced', 'closeUp', 'clickView'].map(view => [view, results[view].islands.every(i => i.worstDistanceOutsideCoast < 0.05)]));
  results.browser = await browser.version(); results.errors = errors; results.warnings = [...new Set(warnings)];
  results.seed = seed.stats;
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  assert.ok(results.click.opensOnClickedCapability, 'the click opens the story on the clicked capability');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: results.browser, islands: results.front.islands.map(i => [i.story, i.territoryMeshes, i.borderSegments, +i.worstDistanceOutsideCoast.toFixed(4)]), densest: results.densest, click: results.click.opensOnClickedCapability, errors }));
});
