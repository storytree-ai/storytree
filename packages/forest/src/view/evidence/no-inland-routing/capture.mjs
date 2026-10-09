// Seeded headless-Chromium check that no longer routing inside islands changes nothing on screen (ADR-0951 D3): the
// desktop globe with The library selected, from two checkouts. Run with `node --import tsx capture.mjs before <main
// checkout>` or `... after`, under the machine's heavy-run lock (see README); --retake replaces the committed pictures.
// Reduced motion, so every lane shows drawn at once; same seed, viewport, turn and click for both builds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const [label, checkout] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
assert.ok(label === 'before' ? checkout !== undefined : label === 'after', 'pass `before <checkout>` or `after`');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../lanes-at-the-coast/seed.json.gz'))).toString('utf8'));
const byTitle = title => seed.tree.stories.find(story => story.title === title).id;
const SELECTED = byTitle('The library'), FACING = [SELECTED, byTitle('The map'), byTitle('Keys')];
const dist = path.join(here, 'dist', label);
await buildCapture({ dist, ...(checkout ? { root: path.resolve(checkout) } : {}) });

// In-page: turn the globe so the given islands' middle faces the viewer, a little left of the story panel.
const face = (page, ids) => page.evaluate(ids => {
  const { camera, scene, invalidate } = window.__globe, { rotation, onRotate } = window.__nav;
  scene.updateMatrixWorld(true);
  const V = camera.position.constructor, Q = camera.quaternion.constructor;
  const centre = new V();
  for (const id of ids) centre.add(scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize());
  centre.normalize();
  const eye = new V(-Math.sin(0.3), 0, Math.cos(0.3)).applyQuaternion(camera.quaternion);
  onRotate(new Q().setFromUnitVectors(centre, eye).multiply(rotation));
  invalidate();
}, ids);

// In-page: what the globe draws of its pathways: the roads between islands and the selection's lanes.
const reading = page => page.evaluate(() => {
  const names = [];
  window.__globe.scene.traverse(object => { if (/^(pathway|lane):/.test(object.name)) names.push(object.name); });
  return { roads: names.filter(n => n.startsWith('pathway:')).length, lanes: names.filter(n => n.startsWith('lane:')).sort() };
});

await runCapture({
  folder: here, dist, seed,
  prepare: async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
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
    await page.waitForFunction(() => !!window.__globe.scene.getObjectByName('pathways:selection-lanes')?.children.length, undefined, { timeout: 120000 });
    await face(page, FACING); // selecting may have turned the globe: the same turn for both builds
    await page.waitForTimeout(3000);
  },
  views: [
    { name: `${label}-library-selected`, measure: async ({ page }) => ({ label, selected: 'The library', ...await reading(page) }),
      expect: value => assert.ok(value.roads > 0 && value.lanes.length > 0, 'roads and lanes are drawn') },
  ],
});
