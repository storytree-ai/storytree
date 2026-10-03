// Seeded headless-Chromium evidence of the neighbour rings (forest contract 3.27).
// Same seed, viewport and turn every run; the only input is clicks on the real page.
// Run with node --import tsx, in the foreground under the machine's heavy-run lock (see README).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, 'seed.json'), 'utf8'));
const owner = new Map(seed.tree.stories.flatMap(story => story.capabilities.map(cap => [cap.id, story.id])));
const title = new Map(seed.tree.stories.map(story => [story.id, story.title]));

// The selected story: the one with the most cross-story links that has both an upstream and a downstream.
const counts = new Map(seed.tree.stories.map(story => [story.id, { up: 0, down: 0 }]));
for (const story of seed.tree.stories) for (const cap of story.capabilities) for (const to of cap.dependsOn) {
  if (owner.get(to) === story.id) continue;
  counts.get(story.id).up++; counts.get(owner.get(to)).down++;
}
const SELECTED = [...counts].filter(([, c]) => c.up > 0 && c.down > 0).sort((a, b) => b[1].up + b[1].down - (a[1].up + a[1].down))[0][0];
// Its neighbours from the seed, independently of the product: "up" it builds on them, "down" they build on it, "down" when both.
const expected = new Map();
for (const story of seed.tree.stories) for (const cap of story.capabilities) for (const to of cap.dependsOn) {
  const from = story.id, dep = owner.get(to);
  if (from === dep) continue;
  if (from === SELECTED && expected.get(dep) !== 'down') expected.set(dep, 'up');
  if (dep === SELECTED) expected.set(from, 'down');
}

await withCapture({ folder: here, dist: path.join(here, 'dist') }, async ({ browser, origin, out, settle }) => {
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
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page);

  await page.evaluate(() => {
    window.__clickedAt = undefined;
    document.addEventListener('pointerup', () => { window.__clickedAt = performance.now(); }, true);
    // Every neighbour-ring mesh, plus the selected island's yellow ring (colour ffd75e, no name).
    window.__rings = () => {
      const { scene } = window.__globe;
      scene.updateMatrixWorld(true);
      const V = scene.position.constructor;
      const rings = [], selectedRings = [];
      scene.traverse(object => {
        if (!object.isMesh || !object.geometry?.parameters || object.geometry.type !== 'RingGeometry') return;
        const { innerRadius, outerRadius } = object.geometry.parameters;
        const colour = '#' + object.material.color.getHexString();
        const world = object.getWorldPosition(new V());
        let plate = object.parent;
        while (plate && !plate.name.startsWith('planet:story_')) plate = plate.parent;
        const base = { name: object.name, story: plate?.name.slice(7), colour, opacity: object.material.opacity,
          innerRadius, outerRadius, width: outerRadius - innerRadius, renderOrder: object.renderOrder, visible: object.visible,
          depthTest: object.material.depthTest, depthWrite: object.material.depthWrite, localY: object.position.y };
        if (object.name.startsWith('neighbour-ring:')) rings.push({ ...base, relation: object.name.split(':')[1], ringStory: object.name.split(':')[2] });
        else if (colour === '#ffd75e') selectedRings.push(base);
        void world;
      });
      return { rings, selectedRings };
    };
    window.__faceCentre = (ids, left = 0.3) => {
      const { camera, scene } = window.__globe, { rotation, onRotate } = window.__nav;
      scene.updateMatrixWorld(true);
      const V = camera.position.constructor, Q = camera.quaternion.constructor;
      const centre = new V();
      for (const id of ids) centre.add(scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize());
      centre.normalize();
      const eye = new V(-Math.sin(left), 0, Math.cos(left)).applyQuaternion(camera.quaternion);
      onRotate(new Q().setFromUnitVectors(centre, eye).multiply(rotation));
    };
    window.__screenOf = id => {
      const { camera, scene } = window.__globe;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      const at = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone());
      const ndc = at.clone().project(camera);
      return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height,
        facing: at.normalize().dot(camera.position.clone().normalize()) };
    };
  });

  const rings = () => page.evaluate(() => window.__rings());
  const group = [SELECTED, ...expected.keys()];
  const result = { browser: await browser.version(), viewport: { width: 1440, height: 960 },
    selectedStory: SELECTED, selectedTitle: title.get(SELECTED),
    expectedFromSeed: Object.fromEntries([...expected].map(([story, relation]) => [`${story} (${title.get(story)})`, relation])) };

  await page.evaluate(ids => window.__faceCentre(ids), group);
  await settle(page, 20);
  result.unselected = await rings();
  assert.equal(result.unselected.rings.length, 0, 'no neighbour ring with nothing selected');
  assert.equal(result.unselected.selectedRings.length, 0, 'no selection ring with nothing selected');
  await page.mouse.move(2, 2);

  // Pulse attempts: select, screenshot ~0.1 s later; keep the first whose rings were still settling after the picture.
  const reading = async () => ({ sinceClickMs: await page.evaluate(() => performance.now() - window.__clickedAt), ...await rings() });
  const open = async () => {
    await page.evaluate(ids => window.__faceCentre(ids), group);
    await settle(page, 20);
    const target = await page.evaluate(id => window.__screenOf(id), SELECTED);
    assert.ok(target.facing > 0.2, `the selected story faces the viewer (facing ${target.facing})`);
    result.click = target;
    await page.mouse.click(target.x, target.y);
    await page.mouse.move(2, 2);
  };
  const deselect = async () => {
    await page.mouse.click(200, 480); // open sea: left of the globe's rim at this viewport and turn, on no island
    await page.mouse.move(2, 2);
    await settle(page, 20);
  };
  result.pulse = { attempts: [] };
  for (let attempt = 1; attempt <= 8; attempt++) {
    await open();
    const before = await reading();
    await page.screenshot({ path: path.join(out, 'pulse.png'), timeout: 180000 });
    const after = await reading();
    const settling = after.rings.filter(r => r.opacity < 0.9 - 1e-6).length;
    result.pulse.attempts.push({ attempt, beforeScreenshotMs: Math.round(before.sinceClickMs), afterScreenshotMs: Math.round(after.sinceClickMs),
      ringsStillSettlingAfter: settling });
    if (settling > 0) {
      const brief = r => ({ story: r.ringStory, relation: r.relation, opacity: +r.opacity.toFixed(3), width: +r.width.toFixed(3) });
      Object.assign(result.pulse, { kept: attempt, beforeScreenshot: { sinceClickMs: before.sinceClickMs, rings: before.rings.map(brief) },
        afterScreenshot: { sinceClickMs: after.sinceClickMs, rings: after.rings.map(brief) } });
      break;
    }
    await page.waitForTimeout(1500);
    await deselect();
  }

  // Settled: wait past the 0.72 s pulse, re-face (selection may turn the globe), then the picture.
  await page.waitForTimeout(1600);
  await settle(page, 20);
  await page.evaluate(ids => window.__faceCentre(ids), group);
  await settle(page, 20);
  result.selected = await rings();
  await page.screenshot({ path: path.join(out, 'selected.png'), timeout: 180000 });

  await deselect();
  result.deselected = await rings();
  await page.screenshot({ path: path.join(out, 'deselected.png'), timeout: 180000 });

  // Assertions on the measured facts.
  const ringed = new Map(result.selected.rings.map(r => [r.ringStory, r.relation]));
  assert.deepEqual([...ringed].sort(), [...expected].sort(), 'the ringed stories and their relations are the selected story\'s cross-story neighbours');
  assert.ok(!ringed.has(SELECTED), 'the selected story has no neighbour ring');
  for (const r of result.selected.rings) {
    assert.equal(r.story, r.ringStory, 'each ring sits on its own story\'s plate');
    assert.equal(r.colour, r.relation === 'up' ? '#0d8fb0' : '#6a5fee');
    assert.ok(Math.abs(r.opacity - 0.9) < 1e-9, `settled opacity 0.9 (got ${r.opacity})`);
    assert.ok(Math.abs(r.width - 1.5) < 0.06, `settled width 1.5 (got ${r.width})`);
  }
  assert.equal(result.selected.selectedRings.length, 1, 'the selected island keeps its one yellow ring');
  assert.equal(result.deselected.rings.length, 0, 'no neighbour ring after deselect');
  assert.equal(result.deselected.selectedRings.length, 0, 'no selection ring after deselect');
  assert.deepEqual(errors, []);
  result.summary = {
    neighbourRingsUnselected: result.unselected.rings.length,
    neighbourRingsSelected: result.selected.rings.length,
    up: result.selected.rings.filter(r => r.relation === 'up').length,
    down: result.selected.rings.filter(r => r.relation === 'down').length,
    ringedStoriesEqualSeedNeighbours: true,
    colours: Object.fromEntries(['up', 'down'].map(dir => [dir, [...new Set(result.selected.rings.filter(r => r.relation === dir).map(r => r.colour))]])),
    settledOpacity: [...new Set(result.selected.rings.map(r => r.opacity))],
    settledWidth: [...new Set(result.selected.rings.map(r => +r.width.toFixed(3)))],
    selectedIslandRings: result.selected.selectedRings.length,
    neighbourRingsDeselected: result.deselected.rings.length,
    pulseKeptAttempt: result.pulse.kept ?? null, pageErrors: errors.length,
  };
  result.errors = errors; result.warnings = [...new Set(warnings)];
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
  await page.close();
});
