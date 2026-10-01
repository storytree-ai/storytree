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
      selected: document.body.dataset.selected ?? null, noteSelected: document.body.dataset.note ?? null,
      card: document.querySelector('.core-card')?.innerText ?? null, panelVisible: !document.querySelector('.story-panel').hidden,
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
    assert.equal(point.rayHits, 0, 'mesh raycasts stay disabled; selection uses the projected dot centre');
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

// Actual submissions and the DOM are checked independently of the model census.
function checkMode(result, mode) {
  assert.equal(result.mode, mode);
  assert.equal(result.view, 'globe');
  checkPoints(result);
  assert.equal(result.points.length, census.drawn);
  assert.equal(result.points.filter(point => point.depth === null).length, census.noShelf);
  assert.ok(result.points.every(point => !census.excludedIds.includes(point.id)));
  assert.equal(result.plates.length, mode === 'forest' ? seed.stats.stories : 0);
  assert.deepEqual(result.drawn.islands, mode === 'forest' ? seed.tree.stories.map(s => s.id).sort() : []);
  assert.deepEqual(result.drawn.points, census.notes.map(n => n.id).sort(), 'every eligible dot reaches the renderer in either mode');
  assert.equal(result.shellPresent, mode === 'forest');
  if (mode === 'library') {
    assert.deepEqual(result.drawn.otherMeshes, [], 'hidden islands submit no meshes');
    assert.equal(result.pathways.length, 0);
    assert.equal(result.labels.length, 0);
  }
}

async function switchMode(page, mode) {
  await page.getByRole('button', { name: mode === 'forest' ? 'Forest' : 'Library', exact: true }).click();
  await page.waitForFunction(mode => document.querySelector(`.forest-views [data-forest-mode="${mode}"]`)?.getAttribute('aria-pressed') === 'true', mode);
  await settle(page);
}

async function capture(page, browser, name) {
  const result = await measure(page);
  checkMode(result, name.startsWith('forest') ? 'forest' : 'library');
  result.browser = await browser.version();
  result.seed = seed.stats;
  result.counts = { islandsDrawn: result.drawn.islands.length, pointsDrawn: result.drawn.points.length,
    shelfPoints: result.points.filter(p => p.depth !== null).length, loosePoints: result.points.filter(p => p.depth === null).length,
    excludedStoryText: census.excludedStoryText };
  result.spread = census.spread;
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
  writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ name, browser: result.browser, renderer: result.renderer, ...result.counts }));
  return result;
}

// These hooks only observe scene geometry. Selection always uses real browser pointer events.
async function candidates(page) {
  return page.evaluate(() => {
    const { scene, camera, gl, raycaster } = window.__globe;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const V = camera.position.constructor, box = gl.domElement.getBoundingClientRect();
    const result = [];
    scene.traverse(object => {
      if (!object.name.startsWith('knowledge-point:')) return;
      const world = object.getWorldPosition(new V()), projected = world.clone().project(camera);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) return;
      const x = box.left + (projected.x + 1) * box.width / 2, y = box.top + (1 - projected.y) * box.height / 2;
      if (document.elementFromPoint(x, y) !== gl.domElement) return;
      const ray = new raycaster.constructor();
      ray.setFromCamera({ x: projected.x, y: projected.y }, camera);
      let land;
      for (const hit of ray.intersectObject(scene, true)) {
        let plate = hit.object;
        while (plate && !plate.name.startsWith('planet:story_')) plate = plate.parent;
        if (plate) { land = { id: plate.name.slice(7), distance: hit.distance }; break; }
      }
      const distance = world.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      result.push({ id: object.userData.id, title: object.userData.title, x, y,
        near: world.dot(ray.ray.direction) <= 0, land: land && land.distance < distance ? land.id : null });
    });
    return result;
  });
}

async function hoverDot(page, farSide = false) {
  const mode = await page.locator('.forest-views [aria-pressed="true"]').getAttribute('data-forest-mode');
  const points = (await candidates(page)).filter(point => (mode === 'library' || point.near && !point.land) && (!farSide || !point.near));
  // A compact description makes the screenshot useful; hit eligibility remains the production picker.
  points.sort((a, b) => {
    const compact = id => { const note = census.notes.find(n => n.id === id); return note.summary && note.summary.length < 400 ? 0 : 1; };
    return compact(a.id) - compact(b.id) || a.x - b.x;
  });
  for (const point of points) {
    await page.mouse.move(point.x + 1, point.y + 1);
    await page.mouse.move(point.x, point.y);
    await settle(page);
    const title = await page.locator('.knowledge-tooltip').count() ? await page.locator('.knowledge-tooltip').textContent() : null;
    if (!title || farSide && title !== point.title) continue;
    assert.equal(await page.locator('canvas').evaluate(node => node.style.cursor), 'pointer');
    return { ...point, hoveredTitle: title };
  }
  throw new Error(`No ${mode} dot produced a hover tooltip (${points.length} candidates).`);
}

async function openDot(page, farSide = false) {
  const point = await hoverDot(page, farSide);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.core-card');
  await settle(page);
  const chosen = await page.evaluate(() => document.body.dataset.note);
  assert.ok(chosen, 'real click selected an artifact');
  assert.equal(await page.evaluate(() => document.body.dataset.selected), undefined, 'opening a card clears the story selection');
  assert.equal(await page.locator('.panel-head').count(), 0, 'the card replaces story panel content');
  const card = page.locator('.core-card');
  assert.equal(await card.locator('h3').textContent(), point.hoveredTitle);
  const expected = census.notes.find(note => note.id === chosen);
  assert.equal(await card.locator('.core-card-kind').textContent(), expected.kind);
  if (expected.summary) assert.equal(await card.locator('.core-card-text').textContent(), expected.summary);
  assert.equal(await card.locator('.core-links, dl').count(), 0, 'no links list, read counts, depth or entrances metadata');
  assert.doesNotMatch(await card.innerText(), /(?:^|\n)\s*(?:Links(?: to a replaced decision)?|Recorded|Depth|Entrances)\s*:/i);
  return { ...point, chosen };
}

async function assertDismissed(page) {
  await page.waitForFunction(() => document.body.dataset.note === undefined && document.querySelector('.story-panel').hidden);
  assert.equal(await page.locator('.core-card').count(), 0);
}

async function openLand(page) {
  const points = (await candidates(page)).filter(point => point.near && point.land);
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    await settle(page);
    const selected = await page.evaluate(() => document.body.dataset.selected);
    if (!selected) continue;
    assert.equal(await page.evaluate(() => document.body.dataset.note), undefined, 'foreground land wins over its occluded dot');
    assert.equal(await page.locator('.core-card').count(), 0, 'opening a story removes the artifact card');
    assert.ok(await page.locator('.panel-head').isVisible());
    return { ...point, selected };
  }
  throw new Error(`No foreground island opened over its occluded dot (${points.length} candidates).`);
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
  const front = await capture(page, browser, 'forest-front');
  const hovered = await hoverDot(page);
  await capture(page, browser, 'forest-tooltip');
  const forestCard = await openDot(page);
  await capture(page, browser, 'forest-card');
  const land = await openLand(page); // card -> story, while proving the land hides the dot behind it
  const replacing = await openDot(page); // story -> card
  await page.getByRole('button', { name: 'Close the library panel', exact: true }).click();
  await assertDismissed(page);
  await openDot(page);
  await page.keyboard.press('Escape');
  await assertDismissed(page);

  await switchMode(page, 'library');
  const libraryFront = await capture(page, browser, 'library-front');
  assert.equal(libraryFront.pointLayerId, front.pointLayerId, 'toggle retains the drawn point layer');
  assert.equal(libraryFront.cameraId, front.cameraId, 'toggle retains the camera');
  await page.mouse.click(land.x, land.y);
  await settle(page);
  assert.equal(await page.evaluate(() => document.body.dataset.selected), undefined, 'Library cannot pick hidden islands');
  await page.keyboard.press('Escape');
  await assertDismissed(page);
  const libraryCard = await openDot(page, true);
  await capture(page, browser, 'library-card');
  await page.keyboard.press('Escape');
  await assertDismissed(page);

  // Return to the same pointer position after crossing the drag threshold: still no click.
  const start = await hoverDot(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y, { steps: 2 });
  await page.mouse.move(start.x, start.y, { steps: 2 });
  await page.mouse.up();
  await settle(page);
  await assertDismissed(page);
  const afterDrag = await measure(page);
  assert.notDeepEqual(afterDrag.cameraQuaternion, libraryFront.cameraQuaternion, 'the synthetic drag exercises globe rotation');
  await hoverDot(page);
  await page.mouse.wheel(0, 25);
  await settle(page);
  assert.equal(await page.locator('.knowledge-tooltip').count(), 0, 'zoom clears a now-stale hover tooltip');
  assert.equal(await page.locator('canvas').evaluate(node => node.style.cursor), '');

  // A read-side news batch models retirement elsewhere; this harness never writes the library.
  const retiring = await openDot(page);
  const last = seed.changes.changes.filter(change => change.recordId === retiring.chosen).at(-1);
  const batch = { changes: [{ ...last, action: 'retired', seq: seed.changes.cursor + 1 }], cursor: seed.changes.cursor + 1 };
  await page.evaluate(batch => {
    window.storytree.changesSince = async (_, cursor) => cursor < batch.cursor
      ? structuredClone(batch) : { changes: [], cursor: batch.cursor };
  }, batch);
  await assertDismissed(page);
  await page.waitForFunction(id => !window.__globe.scene.getObjectByName(`knowledge-point:${id}`), retiring.chosen);
  assert.deepEqual(errors, []);
  const report = {
    browser: await browser.version(), renderer: front.renderer, seed: seed.stats, counts: front.counts, spread: census.spread,
    picked: { forest: forestCard.chosen, library: libraryCard.chosen, story: land.selected, replacedStoryWith: replacing.chosen },
    checks: { realPointerClickInBothModes: true, libraryFarSidePickable: true, hoverTitleAndPointer: true, foregroundLandWins: true,
      cardReplacesStory: true, storyReplacesCard: true, closeDismisses: true, escapeDismisses: true,
      dragIsNotClick: true, hiddenIslandsUnpickable: true, noCardInspectionMetadata: true,
      wheelClearsHover: true, liveRetirementClosesCardAndRemovesDot: true,
      storyTextExcluded: true, allEligibleDotsSubmittedInBothModes: true },
    errors, warnings: [...new Set(warnings)],
  };
  writeFileSync(path.join(out, 'interactions.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  await page.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
