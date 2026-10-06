// Roads between islands before and after the chart is centred on the islands, on the code-rows seed (storytree's own
// 15 stories and their code). Run with <before|after>; --retake replaces the committed pictures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const rows = path.join(here, '../code-rows');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));
const story = title => seed.tree.stories.find(s => s.title === title).id;

/** Turn the globe so `id`'s island faces the eye, then step it `aside` radians round the globe's own up. */
const face = (id, aside = 0) => async ({ page }) => {
  await page.evaluate(({ id, aside }) => {
    const { scene, camera, invalidate } = window.__globe, { rotation, onRotate } = window.__nav;
    const V = camera.position.constructor, Q = camera.quaternion.constructor;
    const at = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize();
    const eye = camera.position.clone().normalize().applyAxisAngle(camera.up.clone().normalize(), aside);
    onRotate(new Q().setFromUnitVectors(at, eye).multiply(rotation));
    invalidate();
  }, { id, aside });
};

await runCapture({
  folder: here, dist: path.join(here, 'dist', label), seed, survey,
  prepare: async ({ page }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 120000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: [
    { name: `${label}-front`, prepare: async ({ page }) => { await page.evaluate(() => { window.__nav.onRotate(window.__globe.camera.quaternion.clone()); }); },
      measurement: `page-${label}.json`,
      measure: async ({ page, errors }) => ({ errors, roads: await page.evaluate(() => {
        let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('pathway:cross:')) n++; }); return n;
      }) }),
      expect: value => { assert.deepEqual(value.errors, []); assert.ok(value.roads > 0); } },
    { name: `${label}-the-world`, prepare: face(story('The world')) },
    { name: `${label}-librarian-to-world`, prepare: face(story('The librarian'), -0.6) },
  ],
});
