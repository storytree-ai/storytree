// Storytree's own globe (rows-on-screen's seed and survey) with The website selected: which lanes light and where
// each runs. Run with <before|after>; --retake replaces committed evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture, settle } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const rows = path.join(here, '../rows-on-screen');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));
const titles = new Map(seed.tree.stories.map(s => [s.id, s.title]));
const owner = new Map(seed.tree.stories.flatMap(s => [[s.id, s.id], ...s.capabilities.map(c => [c.id, s.id])]));
const ids = seed.tree.stories.map(s => s.id);
const WEBSITE = seed.tree.stories.find(s => s.title === 'The website').id;

/** Where the middle of an island's drawn ground is, in CSS pixels, and whether it faces the eye. */
const onScreen = (page, id) => page.evaluate(id => {
  const { scene, camera, size } = window.__globe, V = camera.position.constructor;
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

/** Every lit lane: its stories, colour, and the share of its points on the globe's far side. */
const lanes = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, toEye = camera.quaternion.clone().invert();
  scene.updateMatrixWorld(true);
  const out = [];
  scene.traverse(object => {
    if (!object.name.startsWith('lane:')) return;
    const [, dir, link] = object.name.split(':');
    const [from, to] = link.split('->');
    const position = object.geometry.attributes.position, V = camera.position.constructor;
    let behind = 0;
    for (let i = 0; i < position.count; i++) {
      const p = new V().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (p.normalize().applyQuaternion(toEye).z < 0) behind++;
    }
    out.push({ dir, from, to, behind: +(behind / Math.max(1, position.count)).toFixed(2) });
  });
  return out;
});

await runCapture({
  folder: here, dist: path.join(here, 'dist', label), seed, survey,
  prepare: async ({ page, errors, failed, warnings }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, ids, { timeout: 120000 }).catch(async error => {
      console.error(JSON.stringify({ errors, urls: failed, warnings: warnings.slice(0, 5) }));
      throw error;
    });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: [
    { name: `${label}-website-selected`,
      prepare: async ({ page }) => {
        // Turn the globe about its poles only, so north stays up, until The website faces the eye.
        await page.evaluate(id => {
          const { scene, camera } = window.__globe, { rotation, onRotate } = window.__nav;
          const V = camera.position.constructor, Q = camera.quaternion.constructor;
          scene.updateMatrixWorld(true);
          const own = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).applyQuaternion(rotation.clone().invert());
          const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion).applyQuaternion(rotation.clone().invert());
          const spin = Math.atan2(eye.x, eye.z) - Math.atan2(own.x, own.z);
          onRotate(rotation.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), spin)));
        }, WEBSITE);
        await settle(page, 20);
        const at = await onScreen(page, WEBSITE);
        assert.ok(at.facing > 0, 'The website faces the eye at the opening');
        await page.mouse.click(at.x, at.y);
        await page.mouse.move(2, 2);
        await page.waitForTimeout(3500);
        await settle(page);
      },
      measure: async ({ page, errors }) => {
        const lit = await lanes(page);
        return { label, errors, lanes: lit.map(l => ({ ...l, from: titles.get(owner.get(l.from)) ?? l.from, to: titles.get(owner.get(l.to)) ?? l.to })),
          rowDependencies: survey[WEBSITE].dependsOn.map(id => titles.get(id)) };
      },
      expect: results => {
        assert.deepEqual(results.errors, []);
        console.log(label, JSON.stringify(results.lanes), JSON.stringify(results.rowDependencies));
      },
    },
    { name: `${label}-website-turned`,
      prepare: async ({ page }) => {
        // The same selection with the globe spun 75° about its poles, so The website nears the rim and its lanes run round the back.
        await page.evaluate(() => {
          const { camera } = window.__globe, { rotation, onRotate } = window.__nav, V = camera.position.constructor, Q = camera.quaternion.constructor;
          onRotate(rotation.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), 75 * Math.PI / 180)));
        });
        await page.waitForTimeout(500);
        await settle(page, 20);
      },
      measure: async ({ page, errors }) => ({ label, errors, lanes: (await lanes(page)).map(l => ({ ...l, from: titles.get(owner.get(l.from)) ?? l.from, to: titles.get(owner.get(l.to)) ?? l.to })) }),
      expect: results => {
        assert.deepEqual(results.errors, []);
        console.log(label, 'turned', JSON.stringify(results.lanes));
      },
    },
  ],
});
