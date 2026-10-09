// Seeded headless-Chromium evidence of lanes stopping at the coast (world 6.8, forest 3.26). Run with
// `node --import tsx capture.mjs before <main checkout>` or `... after`, under the machine's heavy-run lock (see README);
// --retake replaces the committed pictures. Same seed, viewport and turn for both builds; the only input is a click.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const [label, checkout] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
assert.ok(label === 'before' ? checkout !== undefined : label === 'after', 'pass `before <checkout>` or `after`');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const byTitle = title => seed.tree.stories.find(story => story.title === title).id;
const SELECTED = byTitle('The library'), FACING = [SELECTED, byTitle('The map'), byTitle('Keys')];
const dist = path.join(here, 'dist', label);
await buildCapture({ dist, ...(checkout ? { root: path.resolve(checkout) } : {}) });

// In-page: turn the globe so the given directions' middle faces the viewer, a little left of the story panel.
const face = (page, ids, left = 0.3) => page.evaluate(([ids, left]) => {
  const { camera, scene, invalidate } = window.__globe, { rotation, onRotate } = window.__nav;
  scene.updateMatrixWorld(true);
  const V = camera.position.constructor, Q = camera.quaternion.constructor;
  const centre = new V();
  for (const id of ids) centre.add(typeof id === 'string' ? scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize()
    : new V(...id).normalize());
  centre.normalize();
  const eye = new V(-Math.sin(left), 0, Math.cos(left)).applyQuaternion(camera.quaternion);
  onRotate(new Q().setFromUnitVectors(centre, eye).multiply(rotation));
  invalidate();
}, [ids, left]);

// In-page: every lane and entrance mark, and how far each lane's ends sit from the nearest end of a road between islands.
const reading = page => page.evaluate(() => {
  const { scene } = window.__globe;
  scene.updateMatrixWorld(true);
  const V = scene.position.constructor;
  const mid = (object, i) => new V().fromBufferAttribute(object.geometry.attributes.position, 2 * i)
    .add(new V().fromBufferAttribute(object.geometry.attributes.position, 2 * i + 1)).multiplyScalar(0.5).applyMatrix4(object.matrixWorld);
  const roadEnds = [];
  scene.traverse(object => {
    if (!object.name.startsWith('pathway:cross:')) return;
    roadEnds.push(mid(object, 0), mid(object, object.geometry.attributes.position.count / 2 - 1));
  });
  const nearestRoadEnd = p => Math.min(...roadEnds.map(end => end.distanceTo(p)));
  const lanes = [], marks = [];
  scene.traverse(object => {
    if (object.name.startsWith('lane:')) {
      const pairs = object.geometry.attributes.position.count / 2;
      lanes.push({ name: object.name, colour: '#' + object.material.color.getHexString(),
        drawn: object.geometry.drawRange.count === Infinity || object.geometry.drawRange.count >= object.geometry.index.count,
        startToNearestRoadEnd: +nearestRoadEnd(mid(object, 0)).toFixed(3), endToNearestRoadEnd: +nearestRoadEnd(mid(object, pairs - 1)).toFixed(3) });
    }
    if (object.name.startsWith('lane-entrance:')) marks.push({ name: object.name, colour: '#' + object.material.color.getHexString(),
      visible: object.visible, radius: +object.scale.x.toFixed(3), lanes: object.userData.lanes.length });
  });
  return { lanes, marks };
});

let trunk;
await runCapture({
  folder: here, dist, seed,
  prepare: async ({ page }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 180000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await face(page, FACING);
    await page.waitForTimeout(500);
    const at = await page.evaluate(id => {
      const { camera, scene } = window.__globe;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      const ndc = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).project(camera);
      return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
    }, SELECTED);
    await page.mouse.click(at.x, at.y);
    await page.mouse.move(2, 2);
    await page.waitForFunction(() => {
      const group = window.__globe.scene.getObjectByName('pathways:selection-lanes');
      let lanes = 0, drawn = 0;
      group?.traverse(o => { if (o.name.startsWith('lane:')) { lanes++; if (o.geometry.drawRange.count >= o.geometry.index.count) drawn++; } });
      window.__globe.invalidate();
      return lanes > 0 && lanes === drawn;
    }, undefined, { timeout: 120000, polling: 250 });
    await face(page, FACING); // selecting may have turned the globe: the same turn for both builds
  },
  views: [
    { name: `${label}-library-selected`, measure: async ({ page }) => ({ label, selected: 'The library', ...await reading(page) }),
      expect: value => {
        assert.ok(value.lanes.length > 0 && value.lanes.every(lane => lane.drawn), 'every lane fully drawn');
        if (label === 'after') {
          assert.ok(value.lanes.every(lane => lane.startToNearestRoadEnd < 0.5 && lane.endToNearestRoadEnd < 0.5), 'every lane ends on a dock');
          assert.ok(value.marks.length > 0 && value.marks.every(mark => mark.visible), 'every mark shows once its lanes are drawn');
        }
      } },
    { name: `${label}-shared-trunk`,
      prepare: async ({ page }) => {
        // The road between islands carrying the most lit links, both directions first, framed at its end on the selected island.
        trunk = await page.evaluate(id => {
          const { scene } = window.__globe, V = scene.position.constructor;
          scene.updateMatrixWorld(true);
          const lit = scene.getObjectByName('pathways:selection-lanes').userData.lanes;
          const dir = new Map(lit.map(l => [`${l.from}->${l.to}`, l.dir]));
          const home = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V());
          let best;
          scene.traverse(object => {
            if (!object.name.startsWith('pathway:cross:')) return;
            const dirs = object.userData.links.map(link => dir.get(link)).filter(Boolean);
            if (dirs.length < 2) return;
            const both = dirs.includes('up') && dirs.includes('down');
            const p = object.geometry.attributes.position, n = p.count / 2;
            const ends = [0, n - 1].map(i => new V().fromBufferAttribute(p, 2 * i).applyMatrix4(object.matrixWorld));
            const end = ends.sort((a, b) => a.distanceTo(home) - b.distanceTo(home))[0];
            if (!best || both > best.both || (both === best.both && dirs.length > best.lit)) best = { road: object.name, lit: dirs.length, both, at: end.toArray() };
          });
          return best;
        }, SELECTED);
        assert.ok(trunk, 'a road between islands carries two or more lit lanes');
        await face(page, [trunk.at], 0.06);
        // As close as the eye goes before the globe trades its islands for the library's notes (framing 0.3, ADR-0919 D3).
        await page.evaluate(id => {
          const { camera, scene, size, invalidate } = window.__globe, V = scene.position.constructor;
          const radius = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).length();
          camera.zoom = Math.min(size.width, size.height) / (2 * 0.36 * radius); camera.updateProjectionMatrix(); invalidate();
        }, SELECTED);
      },
      measure: async ({ page }) => ({ label, trunk, ...await reading(page) }) },
  ],
});
