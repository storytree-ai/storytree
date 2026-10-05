// Seeded before/after capture for "Retire the flat pine canvas" (ADR-0920): storytree's own globe on the actual
// desktop page, 1440 x 960, at its front and after a programmatic quarter turn about the poles (as more-sea's
// capture does), so the pictures can be compared pixel for pixel. Build first with build.mjs <before|after>.
// node capture.mjs <before|after> [--retake]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from '../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(/^(before|after)\w*$/.test(label ?? ''), 'pass a before/after build label');
const rows = path.resolve(here, '../../../forest/src/view/evidence/code-rows');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));

/** Face the globe's own front, then turn it `radians` about its poles, so a re-take reads the same. */
const turnTo = radians => async ({ page, settle }) => {
  await page.evaluate(radians => {
    const { camera } = window.__globe, { onRotate } = window.__nav;
    const Q = camera.quaternion.constructor, V = camera.position.constructor;
    onRotate(camera.quaternion.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), radians)));
  }, radians);
  await settle(page, 90);
};

await runCapture({
  folder: here, dist: path.join(here, 'dist', label.replace(/\d+$/, '')), seed, survey,
  prepare: async ({ page }) => {
    await page.waitForFunction(ids => document.body.dataset.state === 'ready' && window.__globe && window.__nav
      && ids.every(id => !!window.__globe.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground')), seed.tree.stories.map(s => s.id), { timeout: 120000 });
    await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: ['front', 'quarter'].map(view => ({
    name: `${label}-storytree-${view}`, picture: true,
    prepare: turnTo(view === 'quarter' ? Math.PI / 2 : 0),
  })),
});
