// Storytree's own globe from ../derived-roads' seed and survey (2026-10-11), unlit and with The library selected, each
// whole and close up, before and after every road and lit lane is drawn solid, type-only or not (the owner's direction,
// resteer_354c8423f114). Run with <before|after>; --retake replaces committed evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture, settle, zoomGlobe } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../derived-roads/seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, '../derived-roads/survey.json'), 'utf8'));
const titles = new Map(seed.tree.stories.map(s => [s.id, s.title]));
const owner = new Map(seed.tree.stories.flatMap(s => [[s.id, s.id], ...s.capabilities.map(c => [c.id, s.id])]));
const ids = seed.tree.stories.map(s => s.id);
const story = title => seed.tree.stories.find(s => s.title === title).id;

/** Where the middle of an island's drawn ground is, in CSS pixels, and whether it faces the eye. */
const onScreen = (page, id) => page.evaluate(id => {
  const { scene, camera } = window.__globe, V = camera.position.constructor;
  const ground = scene.getObjectByName(`planet:${id}`).getObjectByName('island-ground');
  scene.updateMatrixWorld(true);
  const world = new V(), points = [];
  ground.traverse(mesh => {
    const position = mesh.geometry?.attributes?.position;
    if (position) for (let i = 0; i < position.count; i += 7) points.push(new V().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  });
  points.forEach(point => world.add(point));
  world.divideScalar(points.length);
  const p = world.clone().project(camera), rect = document.querySelector('canvas').getBoundingClientRect();
  return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2, facing: world.clone().normalize().applyQuaternion(camera.quaternion.clone().invert()).z };
}, id);

/** Turn the globe about its poles only, so north stays up, until the island faces the eye. */
const face = (page, id) => page.evaluate(id => {
  const { scene, camera } = window.__globe, { rotation, onRotate } = window.__nav;
  const V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true);
  const own = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).applyQuaternion(rotation.clone().invert());
  const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion).applyQuaternion(rotation.clone().invert());
  const spin = Math.atan2(eye.x, eye.z) - Math.atan2(own.x, own.z);
  onRotate(rotation.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), spin)));
}, id);

/** Every lit lane: its stories, direction, whether it is type-only, its length and how much of it runs over land. */
const lanes = page => page.evaluate(() => {
  const { scene } = window.__globe, out = [];
  const group = scene.getObjectByName('pathways:selection-lanes');
  scene.traverse(object => {
    if (!object.name.startsWith('lane:')) return;
    const { from, to, dir, length, typeOnly } = object.userData;
    out.push({ dir, from, to, typeOnly: typeOnly === true, length: +length.toFixed(1) });
  });
  const marks = [];
  group?.traverse(object => { if (object.name.startsWith('lane-entrance:')) marks.push(object.name); });
  return { lanes: out, marks: marks.length };
});

/** The roads, how many carry a type-only link, and how long the globe takes to draw a frame, in milliseconds. */
const frame = page => page.evaluate(() => {
  const { scene, camera, gl } = window.__globe;
  let roads = 0, typed = 0, cores = 0;
  scene.traverse(object => {
    if (object.name.startsWith('pathway:')) { roads++; if (object.userData.typeOnlyLinks) typed++; }
    if (object.name.startsWith('pathway-core:')) cores++;
  });
  const times = [];
  for (let i = 0; i < 25; i++) {
    const at = performance.now();
    gl.render(scene, camera);
    gl.getContext().finish();
    times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b);
  return { roadSegments: roads, typedSegments: typed, cores, frameMs: +times[12].toFixed(1) };
});

const named = lit => lit.map(l => ({ ...l, from: titles.get(owner.get(l.from)) ?? l.from, to: titles.get(owner.get(l.to)) ?? l.to }));
let opening;

const select = title => ({
  name: `${label}-${title.toLowerCase().replaceAll(' ', '-')}-selected`,
  prepare: async ({ page }) => {
    await zoomGlobe(page, opening);
    await face(page, story(title));
    await settle(page, 20);
    const at = await onScreen(page, story(title));
    assert.ok(at.facing > 0, `${title} faces the eye`);
    await page.mouse.click(at.x, at.y);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(3500);
    await settle(page);
  },
  measure: async ({ page, errors }) => {
    const lit = await lanes(page);
    return { label, errors, ...await frame(page), marks: lit.marks, lanes: named(lit.lanes) };
  },
  expect: results => {
    assert.deepEqual(results.errors, []);
    console.log(label, title, 'lanes', results.lanes.length, 'type-only', results.lanes.filter(l => l.typeOnly).length, 'frame ms', results.frameMs);
  },
});

/** Turn the globe the shortest way until the island's middle faces the eye squarely, for a close-up. */
const centre = (page, id) => page.evaluate(id => {
  const { scene, camera } = window.__globe, { rotation, onRotate } = window.__nav;
  const V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true);
  const own = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize();
  const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
  onRotate(new Q().setFromUnitVectors(own, eye).multiply(rotation));
}, id);

const close = title => ({
  name: `${label}-${title.toLowerCase().replaceAll(' ', '-')}-close`,
  prepare: async ({ page }) => {
    await centre(page, story(title));
    await settle(page, 20);
    // Zoom at the island, left of the story panel's edge where it lies under the panel.
    const at = await onScreen(page, story(title));
    await zoomGlobe(page, opening * 3, at);
    await page.mouse.move(2, 2);
    await settle(page);
  },
});

await runCapture({
  folder: here, dist: path.join(here, 'dist', label), seed, survey,
  prepare: async ({ page, errors, failed, warnings }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, ids, { timeout: 180000 }).catch(async error => {
      console.error(JSON.stringify({ errors, urls: failed, warnings: warnings.slice(0, 5) }));
      throw error;
    });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    opening = await page.evaluate(() => window.__globe.camera.zoom);
  },
  views: [
    { name: `${label}-unlit`,
      prepare: async ({ page }) => {
        await face(page, story('The library'));
        await settle(page, 20);
      },
      measure: async ({ page, errors }) => ({ label, errors, ...await frame(page) }),
      expect: results => {
        assert.deepEqual(results.errors, []);
        console.log(label, 'unlit', results);
      },
    },
    { name: `${label}-unlit-close`, prepare: close('The library').prepare },
    select('The library'), close('The library'),
  ],
});
