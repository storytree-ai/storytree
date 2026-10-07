// Raw headless Chromium evidence of the actual seeded desktop page.
// Run in the foreground under `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --` (absolute checkout path).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, 'seed.json'), 'utf8'));
await withCapture({ folder: here, dist: path.join(here, 'dist') }, async ({ browser, origin, out, settle }) => {

async function measure(page) {
  return page.evaluate(() => {
    const { scene, camera, gl, size } = window.__globe;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const V = camera.position.constructor, Q = camera.quaternion.constructor;
    const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion), plates = [], pathways = [];
    scene.traverse(object => {
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
      canvas: size, plates, pathways, render: { ...gl.info.render }, memory: { ...gl.info.memory },
      shellPresent: !!scene.getObjectByName('planet:shell'),
      seaPresent: !!scene.getObjectByName('planet:sea'), corePresent: !!scene.getObjectByName('placeholder-core'),
      labels: [...document.querySelectorAll('.forest-label')].map(el => ({
        story: el.dataset.storyId, ...visibleElement(el),
      })),
      markers: [...document.querySelectorAll('.forest-claim, .planet-edge-marker')].map(el => ({
        capability: el.dataset.capabilityId, failingStory: el.dataset.failingStory, ...visibleElement(el),
      })),
      drew: JSON.parse(document.body.dataset.drew), view: document.querySelector('.forest').dataset.view,
    };
  });
}

  const requested = process.argv.slice(2).filter(arg => arg !== '--retake');
  for (const name of ['front', 'quarter-turn'].filter(name => !requested.length || requested.includes(name))) {
    console.log(`Rendering ${name}`);
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
      window.storytreeAnswers = {
        listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
        changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
        linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
        frontCovers: async () => [], relatedNotes: async () => [],
      };
    }, seed);
    await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => {
        const plate = state.scene.getObjectByName(`planet:${id}`);
        let meshes = 0;
        plate?.traverse(mesh => { if (mesh.isMesh && mesh.geometry?.attributes.position?.count > 0) meshes++; });
        return meshes >= 2;
      });
    }, seed.tree.stories.map(story => story.id), { timeout: 180000 });
    await settle(page);
    const frontRotation = await page.evaluate(() => window.__nav.rotation.toArray());
    if (name === 'quarter-turn') {
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
    result.seed = seed.stats;
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
    if (name === 'quarter-turn') assert.ok(Math.abs(result.turnDegrees - 90) < 1e-6);
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ name, browser: result.browser, renderer: result.renderer, stories: result.plates.length,
      trees: result.drew.trees.length, visibleLabels: result.labels.filter(label => label.visible).length,
      markers: result.markers, pathways: result.pathways.length, draws: result.render.calls, errors }));
    await page.close();
  }
});
