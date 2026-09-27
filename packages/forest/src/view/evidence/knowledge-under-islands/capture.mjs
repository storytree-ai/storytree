// Raw headless Chromium evidence of the actual seeded desktop page.
// Run in the foreground under flock /tmp/storytree-heavy.lock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLANET_PLAYWRIGHT
  ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = here;
const seed = JSON.parse(readFileSync(path.join(out, 'seed.json'), 'utf8'));
const census = JSON.parse(readFileSync(path.join(out, 'measurements.json'), 'utf8'));
const server = createServer((req, res) => {
  const [variant, name] = new URL(req.url, 'http://localhost').pathname.slice(1).split('/');
  if (variant === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (!['baseline', 'production'].includes(variant) || !['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css'].includes(name)) {
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
    gl.info.reset(); gl.render(scene, camera);
    const ctx = gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      zoom: camera.zoom, camera: camera.position.toArray(), rotation: window.__nav.rotation.toArray(),
      canvas: size, plates, pathways, points, threads, knowledgeObjects, render: { ...gl.info.render }, memory: { ...gl.info.memory },
      shellPresent: !!scene.getObjectByName('planet:shell'),
      seaPresent: !!scene.getObjectByName('planet:sea'), corePresent: !!scene.getObjectByName('placeholder-core'),
      labels: [...document.querySelectorAll('.forest-label')].map(el => ({
        story: el.dataset.storyId, ...visibleElement(el),
      })),
      markers: [...document.querySelectorAll('.forest-claim, .planet-edge-marker')].map(el => ({
        capability: el.dataset.capabilityId, failingStory: el.dataset.failingStory, ...visibleElement(el),
      })),
      drew: JSON.parse(document.body.dataset.drew), view: document.querySelector('.forest').dataset.view,
      selected: document.body.dataset.selected ?? null, panelVisible: !document.querySelector('.story-panel').hidden,
    };
  });
}

function unchanged(result, baseline) {
  assert.deepEqual(result.labels, baseline.labels, 'knowledge changes no name visibility or bounds');
  assert.deepEqual(result.markers, baseline.markers, 'knowledge changes no marker visibility or bounds');
  assert.deepEqual(result.plates, baseline.plates, 'island/tree geometry and transforms stay unchanged');
  assert.deepEqual(result.pathways, baseline.pathways, 'the pathways stay unchanged');
}

function checkPoints(result, variant) {
  const expectedPoints = variant === 'baseline' ? [] : census.notes.map(note => note.id).sort();
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
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.storytree = {
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

// A diagnostic browser copy of the seed proves states absent from the real seed.
// These reports and activity lines never reach the exported seed or its database.
async function interactions(browser) {
  const data = structuredClone(seed);
  const story = data.tree.stories.find(story => story.title === 'Forest')
    ?? data.tree.stories.find(story => story.capabilities.length >= 2);
  assert.ok(story && story.capabilities.length >= 2);
  const [failed, claimed] = story.capabilities;
  failed.health.reported.state = 'failing';
  story.health.reported.state = 'failing';
  const lines = data.lines.lines;
  const at = new Date().toISOString();
  const actor = { session: 'knowledge-capture-diagnostic', harness: 'codex', project: 'storytree', at };
  let seq = Math.max(data.lines.cursor, ...lines.map(line => line.seq), 0);
  const add = line => lines.push({ ...actor, source: 'tool', ...line, seq: ++seq });
  add({ kind: 'session-started', source: 'hook' });
  add({ kind: 'claimed', capability: failed.id, reason: 'synthetic failure evidence' });
  add({ kind: 'landed', capability: failed.id });
  add({ kind: 'claimed', capability: claimed.id, reason: 'synthetic claim evidence' });
  data.lines.cursor = seq;
  const evidence = {
    synthetic: 'Browser-only seed copy: one landed failing capability and one current Codex claim. No library writes.',
    story: { id: story.id, title: story.title }, failed: failed.id, claimed: claimed.id,
    browser: await browser.version(), variants: {},
  };
  for (const variant of ['baseline', 'production']) {
    console.log(`Rendering ${variant} synthetic failure/claim journey`);
    const { page, errors, warnings } = await openPage(browser, variant, data);
    await page.evaluate(() => {
      const label = document.createElement('div');
      label.textContent = 'SYNTHETIC: one failing capability + one Codex claim; browser copy only';
      label.style.cssText = 'position:fixed;left:16px;bottom:12px;z-index:1000;padding:8px 12px;background:#171a20;color:#eee;font:12px sans-serif;pointer-events:none';
      document.body.append(label);
    });
    const opening = await measure(page);
    assert.ok(opening.plates.find(plate => plate.story === story.id).facing > 0.999999,
      'the page opens facing its failing island');
    assert.equal(opening.drew.trees.find(tree => tree.capability === failed.id).form, 'dead');
    assert.ok(opening.markers.some(marker => marker.capability === claimed.id && marker.visible
      && marker.text.includes('Codex: synthetic claim evidence')), 'the claim is visible over its tree');
    await page.evaluate(() => {
      const { camera } = window.__globe, { rotation, onRotate } = window.__nav;
      const Q = camera.quaternion.constructor, V = camera.position.constructor;
      const turn = new Q().setFromAxisAngle(new V(0, 1, 0), Math.PI);
      onRotate(camera.quaternion.clone().multiply(turn).multiply(camera.quaternion.clone().invert()).multiply(rotation));
    });
    await settle(page);
    const hidden = await measure(page);
    assert.ok(hidden.plates.find(plate => plate.story === story.id).facing < -0.999999);
    assert.ok(hidden.markers.some(marker => marker.failingStory === story.id && marker.visible),
      'a failing island on the far side retains its visible edge marker');
    await page.screenshot({ path: path.join(out, `${variant}-synthetic-failure-hidden.png`), timeout: 180000 });
    await page.locator(`.planet-edge-marker[data-failing-story="${story.id}"]`).click();
    await settle(page);
    const focused = await measure(page);
    assert.ok(focused.plates.find(plate => plate.story === story.id).facing > 0.999999,
      'clicking its marker brings the failure to the front');
    assert.ok(!focused.markers.some(marker => marker.failingStory === story.id), 'the revealed failure no longer needs an edge marker');
    assert.ok(focused.labels.some(label => label.story === story.id && label.visible));
    assert.ok(focused.markers.some(marker => marker.capability === claimed.id && marker.visible));
    const click = await page.evaluate(id => {
      const { scene, camera, gl } = window.__globe;
      const p = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).project(camera);
      const box = gl.domElement.getBoundingClientRect();
      return { x: box.left + (p.x + 1) * box.width / 2, y: box.top + (1 - p.y) * box.height / 2 };
    }, story.id);
    await page.mouse.click(click.x, click.y);
    await page.waitForFunction(id => document.body.dataset.selected === id, story.id, { timeout: 10000 });
    await settle(page);
    const picked = await measure(page);
    assert.equal(picked.selected, story.id, 'the focused island remains pickable through the knowledge layer');
    assert.equal(picked.panelVisible, true, 'picking the island opens its story panel');
    assert.ok(picked.markers.some(marker => marker.capability === claimed.id && marker.visible));
    assert.deepEqual(errors, []);
    const stages = { opening, hidden, focused, picked };
    for (const [stage, result] of Object.entries(stages)) {
      checkPoints(result, variant);
      if (variant === 'production') unchanged(result, evidence.variants.baseline.stages[stage]);
    }
    await page.screenshot({ path: path.join(out, `${variant}-synthetic-failure-focused.png`), timeout: 180000 });
    evidence.variants[variant] = { stages, errors, warnings: [...new Set(warnings)], checks: {
      openingFacesFailure: true, claimVisible: true, hiddenFailureMarkerVisible: true,
      clickRevealsFailure: true, islandPicking: true, panelOpens: true, pointsNeverPick: true,
      pointsMatchCensus: true, noThreads: true,
    } };
    console.log(JSON.stringify({ variant, synthetic: true, renderer: picked.renderer,
      story: story.title, points: picked.points.length, checks: evidence.variants[variant].checks }));
    await page.close();
  }
  writeFileSync(path.join(out, 'interactions.json'), JSON.stringify(evidence, null, 2) + '\n');
}

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLANET_CHROMIUM
      ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const requested = process.argv.slice(2);
  const cases = ['baseline', 'production'].flatMap(variant => ['front', 'quarter-turn'].map(view => ({ variant, view, name: `${variant}-${view}` })));
  for (const { variant, view, name } of cases.filter(({ name }) => !requested.length || requested.includes(name))) {
    console.log(`Rendering ${name}`);
    const { page, errors, warnings } = await openPage(browser, variant, seed);
    const frontRotation = await page.evaluate(() => window.__nav.rotation.toArray());
    if (view === 'quarter-turn') {
      await page.evaluate(() => {
        const { camera } = window.__globe, { rotation, onRotate } = window.__nav;
        const Q = camera.quaternion.constructor, V = camera.position.constructor;
        const turn = new Q().setFromAxisAngle(new V(0, 1, 0), Math.PI / 2);
        onRotate(camera.quaternion.clone().multiply(turn).multiply(camera.quaternion.clone().invert()).multiply(rotation));
      });
      await settle(page);
    }
    const result = await measure(page);
    result.browser = await browser.version(); result.errors = errors; result.warnings = [...new Set(warnings)];
    result.seed = seed.stats; result.variant = variant;
    const dot = result.rotation.reduce((sum, number, index) => sum + number * frontRotation[index], 0);
    result.turnDegrees = 2 * Math.acos(Math.min(1, Math.abs(dot))) * 180 / Math.PI;
    assert.equal(result.view, 'globe');
    assert.equal(result.shellPresent, true);
    assert.equal(result.seaPresent, false);
    assert.equal(result.corePresent, false);
    assert.equal(result.plates.length, seed.stats.stories);
    assert.equal(result.drew.stories.length, seed.stats.stories);
    assert.equal(result.drew.trees.length, seed.stats.capabilities);
    const owners = new Map(seed.tree.stories.flatMap(story => story.capabilities.map(cap => [cap.id, story.id])));
    const expectedLinks = seed.tree.stories.flatMap(story => story.capabilities.flatMap(cap => cap.dependsOn
      .map(to => `${cap.id}->${to}`))).sort();
    const group = result.pathways.find(pathway => pathway.name === 'pathways:cross-island');
    assert.deepEqual(group.data.links.map(link => `${link.from}->${link.to}`).sort(), expectedLinks,
      'the mounted pathway plan carries every native link');
    result.pathwayPlan = { links: group.data.links.length, segments: group.data.segmentCount,
      localSegments: group.data.localSegmentCount, crossSegments: group.children };
    const expectedCross = seed.tree.stories.flatMap(story => story.capabilities.flatMap(cap => cap.dependsOn
      .filter(to => owners.get(to) !== story.id).map(to => `${cap.id}->${to}`))).sort();
    const ribbons = result.pathways.filter(pathway => pathway.name.startsWith('pathway:'));
    result.crossLinksDrawn = [...new Set(ribbons.flatMap(ribbon => ribbon.data.links))].sort();
    assert.deepEqual(result.crossLinksDrawn, expectedCross, 'the browser actually draws every native cross-story link');
    assert.ok(ribbons.every(ribbon => ribbon.vertices >= 4), 'the browser has drawable ribbon meshes');
    assert.deepEqual(errors, []);
    if (view === 'quarter-turn') assert.ok(Math.abs(result.turnDegrees - 90) < 1e-6);
    checkPoints(result, variant);
    // Names are compared to the same seed/view's unchanged baseline, including exact screen bounds.
    if (variant !== 'baseline') {
      const baseline = JSON.parse(readFileSync(path.join(out, `baseline-${view}.json`), 'utf8'));
      unchanged(result, baseline);
    }
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ name, browser: result.browser, renderer: result.renderer, stories: result.plates.length,
      trees: result.drew.trees.length, visibleLabels: result.labels.filter(label => label.visible).length,
      points: result.points.length, threads: result.threads.length, markers: result.markers, pathways: result.pathways.length, draws: result.render.calls, errors }));
    await page.close();
  }
  if (!requested.length || requested.includes('interactions')) await interactions(browser);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
