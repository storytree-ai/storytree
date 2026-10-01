// Raw headless Chromium evidence of the actual seeded desktop page.
// Run in the foreground under flock /tmp/storytree-heavy.lock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, fakeBridge } from '../../../../../../apps/desktop/src/capture/index.ts'; // the shared stand-in bridge: run with node --import tsx

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(here); // pictures and measurements: a scratch folder unless run with --retake
const seed = JSON.parse(readFileSync(path.join(here, 'seed.json'), 'utf8'));
const census = JSON.parse(readFileSync(path.join(here, 'measurements.json'), 'utf8'));
const server = createServer((req, res) => {
  const [variant, name] = new URL(req.url, 'http://localhost').pathname.slice(1).split('/');
  if (variant === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (!['production'].includes(variant) || !['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css', 'app-setup.css', 'forest.css'].includes(name)) {
    console.error(`Capture asset not found: ${name}`);
    res.writeHead(404).end(); return;
  }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css')
    ? 'text/css' : name.endsWith('.map') ? 'application/json' : 'text/html');
  res.end(readFileSync(path.join(here, 'dist', variant, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

async function settle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      window.__globe.invalidate();
      await new Promise(requestAnimationFrame);
    }
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const { scene, camera, gl, size, raycaster } = window.__globe;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const V = camera.position.constructor, Q = camera.quaternion.constructor;
    const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion), plates = [], pathways = [], points = [], threads = [];
    const knowledgeObjects = [];
    scene.getObjectByName('knowledge-points')?.traverse(object => {
      if (object.isMesh || object.isLine || object.isPoints) knowledgeObjects.push({ name: object.name, type: object.type });
    });
    scene.traverse(object => {
      if (object.name.startsWith('knowledge-point:')) {
        const ray = new raycaster.constructor(), hits = [];
        ray.set(camera.position, object.getWorldPosition(new V()).sub(camera.position).normalize());
        object.raycast(ray, hits);
        points.push({ ...object.userData, at: object.position.toArray(), world: object.getWorldPosition(new V()).toArray(), screen: object.getWorldPosition(new V()).project(camera).toArray(),
        material: { colour: object.material.color.getHexString(), opacity: object.material.opacity,
          transparent: object.material.transparent, depthTest: object.material.depthTest, depthWrite: object.material.depthWrite },
        radius: object.geometry.parameters.radius, rayHits: hits.length });
      }
      if (object.name.startsWith('knowledge-thread:')) threads.push(object.name);
      if (/pathway|trail/.test(object.name)) {
        pathways.push({ name: object.name, children: object.children.length, data: object.userData,
          vertices: object.geometry?.attributes.position?.count ?? 0 });
      }
      if (!object.name.startsWith('planet:story_')) return;
      const normal = new V(0, 1, 0).applyQuaternion(object.getWorldQuaternion(new Q()));
      let meshes = 0, vertices = 0, triangles = 0;
      object.traverse(mesh => {
        if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
        meshes++; vertices += mesh.geometry.attributes.position.count;
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
      });
      plates.push({ story: object.name.slice(7), facing: normal.dot(eye),
        screen: object.getWorldPosition(new V()).project(camera).toArray(),
        position: object.position.toArray(), meshes, vertices, triangles });
    });
    function visibleElement(el) {
      let opacity = 1, hidden = false;
      for (let node = el; node instanceof HTMLElement; node = node.parentElement) {
        const css = getComputedStyle(node);
        opacity *= Number(css.opacity);
        hidden ||= css.display === 'none' || css.visibility === 'hidden';
      }
      const rect = el.getBoundingClientRect();
      return { text: el.textContent, visible: !hidden && opacity > 0 && rect.width > 0 && rect.height > 0,
        opacity, bounds: rect.toJSON() };
    }
    // Count actual renderer submissions, separately from scene inventory and pixel occlusion.
    const submittedIslands = new Set(), submittedPoints = new Set(), submittedOther = new Set();
    const restore = [];
    scene.traverse(object => {
      if (!object.isMesh) return;
      const original = object.onBeforeRender;
      restore.push(() => { object.onBeforeRender = original; });
      object.onBeforeRender = function (...args) {
        original.apply(this, args);
        if (object.name.startsWith('knowledge-point:')) submittedPoints.add(object.userData.id);
        else {
          let plate = object;
          while (plate && !plate.name.startsWith('planet:story_')) plate = plate.parent;
          if (plate) submittedIslands.add(plate.name.slice(7));
          else submittedOther.add(object.name || object.type);
        }
      };
    });
    gl.info.reset();
    try { gl.render(scene, camera); } finally { for (const reset of restore) reset(); }
    const drawn = { islands: [...submittedIslands].sort(), points: [...submittedPoints].sort(), otherMeshes: [...submittedOther].sort() };
    const ctx = gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      sceneId: scene.uuid, cameraId: camera.uuid, pointLayerId: scene.getObjectByName('knowledge-points')?.uuid,
      zoom: camera.zoom, camera: camera.position.toArray(), cameraQuaternion: camera.quaternion.toArray(), rotation: window.__nav.rotation.toArray(),
      canvas: size, plates, pathways, points, threads, knowledgeObjects, drawn, render: { ...gl.info.render }, memory: { ...gl.info.memory },
      shellPresent: !!scene.getObjectByName('planet:shell'),
      seaPresent: !!scene.getObjectByName('planet:sea'), corePresent: !!scene.getObjectByName('placeholder-core'),
      labels: [...document.querySelectorAll('.forest-label')].map(el => ({
        story: el.dataset.storyId, ...visibleElement(el),
      })),
      markers: [...document.querySelectorAll('.forest-claim, .planet-edge-marker')].map(el => ({
        capability: el.dataset.capabilityId, failingStory: el.dataset.failingStory, ...visibleElement(el),
      })),
      mode: document.querySelector('.forest-views [aria-pressed="true"]')?.dataset.forestMode,
      drew: JSON.parse(document.body.dataset.drew), view: document.querySelector('.forest').dataset.view,
      selected: document.body.dataset.selected ?? null, panelVisible: !document.querySelector('.story-panel').hidden,
    };
  });
}

function checkPoints(result) {
  const expectedPoints = census.notes.map(note => note.id).sort();
  assert.deepEqual(result.points.map(point => point.id).sort(), expectedPoints);
  assert.equal(result.threads.length, 0);
  for (const point of result.points) {
    const expected = census.notes.find(note => note.id === point.id);
    assert.deepEqual(point.material, { colour: 'a5c5d1', opacity: 0.52, transparent: true, depthTest: true, depthWrite: false });
    assert.equal(point.radius, census.radius * 0.006);
    assert.equal(point.rayHits, 0, 'knowledge points cannot intercept clicks or occlude HTML labels');
    assert.equal(point.depth, expected.depth);
    assert.equal(point.home, expected.home);
    assert.ok(Math.hypot(...point.at.map((value, index) => value - Object.values(expected.at)[index])) < 1e-8);
  }
  assert.equal(result.knowledgeObjects.length, expectedPoints.length, 'knowledge adds only its artifact meshes');
  assert.ok(result.knowledgeObjects.every(object => object.type === 'Mesh' && object.name.startsWith('knowledge-point:')));
}

async function openPage(browser, variant, data) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [], warnings = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (message.type() === 'warning' || text.includes('Attempted to synchronously unmount a root')) warnings.push(text);
    else errors.push(text);
  });
  const bridge = fakeBridge({});
  await bridge.install(page);
  process.once('exit', () => console.log('Bridge methods left to the stand-in:', bridge.defaulted.join(', ') || 'none'));
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    let current = data.projects.includes("storytree") ? "storytree" : data.projects[0];
    window.storytreeAnswers = {
      projectSelection: async () => copy({ projects: data.projects, current }),
      chooseProject: async name => { current = name; return copy({ projects: data.projects, current }); },
      listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
      frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [],
    };
  }, data);
  await page.goto(`http://127.0.0.1:${server.address().port}/${variant}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
    return ids.every(id => {
      const plate = state.scene.getObjectByName(`planet:${id}`);
      let meshes = 0;
      plate?.traverse(mesh => { if (mesh.isMesh && mesh.geometry?.attributes.position?.count > 0) meshes++; });
      return meshes >= 2;
    });
  }, data.tree.stories.map(story => story.id), { timeout: 180000 });
  await settle(page);
  return { page, errors, warnings };
}

// Forest capability 3 / ADR-0660 D4: both modes share the live globe and camera.
function checkMode(result, mode) {
  assert.equal(result.mode, mode);
  assert.equal(result.view, 'globe');
  checkPoints(result);
  assert.equal(result.points.length, census.drawn);
  assert.equal(result.points.filter(point => point.depth === null).length, census.noShelf);
  assert.equal(result.plates.length, mode === 'forest' ? seed.stats.stories : 0, 'islands mounted');
  assert.deepEqual(result.drawn.islands, mode === 'forest' ? seed.tree.stories.map(s => s.id).sort() : [], 'islands submitted to renderer');
  assert.deepEqual(result.drawn.points, census.notes.map(n => n.id).sort(), 'every point submitted to renderer');
  assert.equal(result.labels.length, mode === 'forest' ? seed.stats.stories : 0, 'island DOM overlays follow mode');
  assert.equal(result.shellPresent, mode === 'forest', 'Library shows only the core');
  assert.equal(result.seaPresent, false);
  assert.equal(result.corePresent, false);
  if (mode === 'library') {
    assert.deepEqual(result.drawn.otherMeshes, [], 'Library submits only knowledge meshes');
    assert.equal(result.pathways.length, 0);
    assert.equal(result.markers.length, 0);
    assert.equal(result.panelVisible, false);
    assert.equal(result.selected, null);
  } else {
    const group = result.pathways.find(p => p.name === 'pathways:cross-island');
    assert.equal(group.data.links.length, seed.stats.links);
    assert.ok(result.pathways.some(p => p.name.startsWith('pathway:') && p.vertices >= 4));
  }
}

function sameGlobe(before, after) {
  for (const field of ['sceneId', 'cameraId', 'pointLayerId', 'zoom', 'camera', 'cameraQuaternion', 'rotation', 'points']) {
    assert.deepEqual(after[field], before[field], `switching mode preserves ${field}`);
  }
}

async function switchMode(page, mode) {
  await page.getByRole('button', { name: mode === 'forest' ? 'Forest' : 'Library', exact: true }).click();
  await page.waitForFunction(mode => document.querySelector(`.forest-views [data-forest-mode="${mode}"]`)?.getAttribute('aria-pressed') === 'true', mode);
  await settle(page);
}

async function turn(page, radians) {
  await page.evaluate(radians => {
    const { camera } = window.__globe, { rotation, onRotate } = window.__nav;
    const Q = camera.quaternion.constructor, V = camera.position.constructor;
    const turn = new Q().setFromAxisAngle(new V(0, 1, 0), radians);
    onRotate(camera.quaternion.clone().multiply(turn).multiply(camera.quaternion.clone().invert()).multiply(rotation));
  }, radians);
  await settle(page);
}

async function capture(page, browser, name, result) {
  result.browser = await browser.version();
  result.seed = seed.stats;
  result.counts = { islandsDrawn: result.drawn.islands.length, pointsDrawn: result.drawn.points.length,
    shelfPoints: result.points.filter(p => p.depth !== null).length,
    centreCluster: result.points.filter(p => p.depth === null).length };
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
  writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ name, browser: result.browser, renderer: result.renderer, ...result.counts }));
}

async function failureJourney(browser) {
  const data = structuredClone(seed);
  const story = data.tree.stories.find(s => /forest/i.test(s.title));
  const [failed, claimed] = story.capabilities;
  failed.health.reported.state = 'failing'; story.health.reported.state = 'failing';
  let seq = data.lines.cursor;
  const actor = { session: 'forest-toggle-diagnostic', harness: 'codex', project: 'storytree', at: new Date().toISOString() };
  for (const line of [
    { kind: 'session-started', source: 'hook' },
    { kind: 'claimed', capability: failed.id, reason: 'synthetic failure evidence' },
    { kind: 'landed', capability: failed.id },
    { kind: 'claimed', capability: claimed.id, reason: 'synthetic claim evidence' },
  ]) data.lines.lines.push({ ...actor, source: 'tool', ...line, seq: ++seq });
  data.lines.cursor = seq;
  const { page, errors, warnings } = await openPage(browser, 'production', data);
  const opening = await measure(page);
  checkMode(opening, 'forest');
  assert.ok(opening.plates.find(p => p.story === story.id).facing > 0.999999, 'Forest opens facing its failure');
  assert.equal(opening.drew.trees.find(t => t.capability === failed.id).form, 'dead');
  assert.ok(opening.markers.some(m => m.capability === claimed.id && m.visible));
  await turn(page, Math.PI);
  const hidden = await measure(page);
  assert.ok(hidden.plates.find(p => p.story === story.id).facing < -0.999999);
  assert.ok(hidden.markers.some(m => m.failingStory === story.id && m.visible), 'Forest never hides failure attention');
  await switchMode(page, 'library');
  const library = await measure(page);
  checkMode(library, 'library'); sameGlobe(hidden, library);
  await switchMode(page, 'forest');
  const restored = await measure(page);
  checkMode(restored, 'forest'); sameGlobe(library, restored);
  assert.ok(restored.markers.some(m => m.failingStory === story.id && m.visible), 'failure attention returns with Forest');
  await page.locator(`.planet-edge-marker[data-failing-story="${story.id}"]`).click();
  await settle(page);
  const focused = await measure(page);
  assert.ok(focused.plates.find(p => p.story === story.id).facing > 0.999999);
  const click = await page.evaluate(id => {
    const { scene, camera, gl } = window.__globe;
    const p = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).project(camera);
    const box = gl.domElement.getBoundingClientRect();
    return { x: box.left + (p.x + 1) * box.width / 2, y: box.top + (1 - p.y) * box.height / 2 };
  }, story.id);
  await page.mouse.click(click.x, click.y);
  await page.waitForFunction(id => document.body.dataset.selected === id, story.id);
  const picked = await measure(page);
  assert.equal(picked.panelVisible, true);
  await switchMode(page, 'library');
  const cleared = await measure(page);
  checkMode(cleared, 'library'); sameGlobe(picked, cleared);
  await page.mouse.click(click.x, click.y);
  await settle(page);
  assert.equal((await measure(page)).selected, null, 'Library cannot pick hidden islands');
  // The ordinary orbit controls work in Library too; toggling retains the new eye and zoom.
  await page.evaluate(() => {
    const { camera, controls, invalidate } = window.__globe;
    camera.position.x += 30; camera.zoom *= 1.2; camera.updateProjectionMatrix();
    controls.update(); invalidate();
  });
  await settle(page);
  const orbited = await measure(page);
  await switchMode(page, 'forest');
  sameGlobe(orbited, await measure(page));
  await switchMode(page, 'library');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Forest', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.forest-views [data-forest-mode="forest"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'interactions.json'), JSON.stringify({
    synthetic: 'Browser-only snapshot copy: one failing capability and one Codex claim. No library writes.',
    story: story.id, browser: await browser.version(), renderer: opening.renderer,
    checks: { opensFacingFailure: true, farSideFailureMarker: true, libraryHidesMarkers: true,
      forestRestoresFailureMarker: true, markerFocusesFailure: true, islandPicking: true,
      libraryClearsSelectionAndPanel: true, hiddenIslandsCannotBePicked: true,
      sceneCoreAndCameraSurviveToggle: true, libraryOrbitAndZoomRetained: true, launchDefaultsToForest: true },
    errors, warnings: [...new Set(warnings)],
  }, null, 2) + '\n');
  await page.close();
  console.log('PASS: failure attention, selection, camera, scene identity and launch default');
}

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLANET_CHROMIUM
      ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const { page, errors, warnings } = await openPage(browser, 'production', seed);
  for (const view of ['front', 'quarter-turn']) {
    if (view === 'quarter-turn') await turn(page, Math.PI / 2);
    const forest = await measure(page);
    checkMode(forest, 'forest');
    await capture(page, browser, `forest-${view}`, forest);
    await switchMode(page, 'library');
    const library = await measure(page);
    checkMode(library, 'library'); sameGlobe(forest, library);
    await capture(page, browser, `library-${view}`, library);
    await switchMode(page, 'forest');
    const returned = await measure(page);
    checkMode(returned, 'forest'); sameGlobe(library, returned);
    assert.deepEqual(returned.plates, forest.plates);
    assert.deepEqual(returned.pathways, forest.pathways);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ errors, warnings: [...new Set(warnings)] }));
  await page.close();
  await failureJourney(browser);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
