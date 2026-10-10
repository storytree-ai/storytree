// The desktop page on measure.mts's seed and survey: the view it opens on, the unturned front, and how far a
// person's drag and wheel can take it. Build first (the same call as ../rows/build.mjs), then run with --retake
// to replace the committed pictures:
//   node --import tsx capture.mjs build
//   node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs --retake
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, runCapture, zoomGlobe } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
// `--variant <name>` builds and captures a second page (a checkout with README.md's one-constant change), its level view only.
const variant = process.argv.includes('--variant') ? process.argv[process.argv.indexOf('--variant') + 1] : undefined;
const dist = path.join(here, variant === undefined ? 'dist' : `dist-${variant}`);
if (process.argv[2] === 'build') { await buildCapture({ dist }); process.exit(0); }
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
const titles = Object.fromEntries(seed.tree.stories.map(s => [s.id, s.title]));

/** Where each island's middle is on the page, and how squarely it faces the eye (1 face on, 0 edge on, below 0 behind the globe). */
const islandsOnScreen = page => page.evaluate(`(titles => {
  const { scene, camera, gl } = globalThis.__globe;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld();
  const globe = scene.getObjectByName('globe'), V = camera.position.constructor;
  const centre = globe.getWorldPosition(new V()), toEye = camera.getWorldDirection(new V()).negate();
  const box = gl.domElement.getBoundingClientRect();
  const islands = Object.keys(titles).map(id => {
    const at = scene.getObjectByName('planet:' + id).getWorldPosition(new V());
    const facing = at.clone().sub(centre).normalize().dot(toEye), ndc = at.clone().project(camera);
    return { title: titles[id], x: Math.round(box.left + (ndc.x + 1) * box.width / 2), y: Math.round(box.top + (1 - ndc.y) * box.height / 2), facing: +facing.toFixed(2) };
  });
  return { zoom: +camera.zoom.toFixed(3), canvas: { width: Math.round(box.width), height: Math.round(box.height) },
    readable: islands.filter(i => i.facing >= 0.5).length, atTheRim: islands.filter(i => i.facing > 0 && i.facing < 0.5).length, behindTheGlobe: islands.filter(i => i.facing <= 0).length, islands };
})(${JSON.stringify(titles)})`);

/** A person's drag from the middle of the globe, in fractions of the canvas's height (a full height turns it once round). */
async function drag(page, across, down) {
  const box = await page.evaluate(`(() => { const b = globalThis.__globe.gl.domElement.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, height: b.height }; })()`);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let step = 1; step <= 24; step++) {
    await page.mouse.move(box.x + across * box.height * step / 24, box.y + down * box.height * step / 24);
    await page.evaluate('new Promise(requestAnimationFrame)');
  }
  await page.mouse.up();
}

let opening;
await runCapture({
  folder: here, dist, seed, survey,
  prepare: async ({ page, errors, failed, warnings }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 180000 }).catch(async error => {
      console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state + ' | ' + (document.querySelector('.empty')?.innerText ?? '')), errors, urls: failed, warnings: warnings.slice(0, 5) }));
      throw error;
    });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: variant !== undefined ? [
    { name: `variant-${variant}`, prepare: ({ page }) => page.evaluate(() => { window.__nav.onRotate(window.__globe.camera.quaternion.clone()); }), measure: ({ page }) => islandsOnScreen(page),
      expect: seen => console.log(variant, seen.readable, seen.atTheRim, seen.behindTheGlobe) },
  ] : [
    { name: 'opening', measure: async ({ page }) => (opening = await islandsOnScreen(page)),
      expect: seen => console.log('opening', seen.readable, seen.atTheRim, seen.behindTheGlobe) },
    // Half the canvas's height sideways: the globe half-way round, the far side of the opening view.
    { name: 'spun-half-round', prepare: ({ page }) => drag(page, 0.5, 0), measure: ({ page }) => islandsOnScreen(page),
      expect: seen => console.log('spun-half-round', seen.readable, seen.atTheRim, seen.behindTheGlobe) },
    // Back, then down as far as the tilt goes (88 degrees): the rows seen from over the north pole.
    { name: 'tilted-to-the-limit', prepare: async ({ page }) => { await drag(page, -0.5, 0); await drag(page, 0, 0.4); }, measure: ({ page }) => islandsOnScreen(page),
      expect: seen => console.log('tilted-to-the-limit', seen.readable, seen.atTheRim, seen.behindTheGlobe) },
    // The unturned globe, no spin and no tilt: every row a level line.
    { name: 'front', prepare: ({ page }) => page.evaluate(() => { window.__nav.onRotate(window.__globe.camera.quaternion.clone()); }), measure: ({ page }) => islandsOnScreen(page),
      expect: seen => console.log('front', seen.readable, seen.atTheRim, seen.behindTheGlobe) },
    // The wheel out as far as it goes.
    { name: 'zoomed-out-to-the-limit', prepare: async ({ page }) => { const min = await page.evaluate('globalThis.__globe.controls.minZoom'); await zoomGlobe(page, min * 1.02); }, measure: ({ page }) => islandsOnScreen(page),
      expect: seen => { assert.ok(seen.zoom < opening.zoom / 10); console.log('zoomed-out', seen.zoom, 'from', opening.zoom); } },
  ],
});
