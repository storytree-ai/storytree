// The mini globe, the tilt stop, the wheel floor and Home on the actual desktop page, on storytree's own globe
// (rows-on-screen's seed and survey). Build, then capture (--retake replaces committed pictures):
//   node --import tsx capture.mjs build
//   node --import tsx capture.mjs --retake
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist', 'after');
if (process.argv[2] === 'build') { await buildCapture({ dist }); process.exit(0); }
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../rows-on-screen/seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, '../rows-on-screen/survey.json'), 'utf8'));
const ids = seed.tree.stories.map(s => s.id);

/** How far the globe is spun and tilted (north's lean toward the eye), its zoom, and the mini globe's mark, read off the page. */
const reading = page => page.evaluate(ids => {
  const { scene, camera, gl } = globalThis.__globe, V = camera.position.constructor;
  scene.updateMatrixWorld(true);
  const toEye = camera.quaternion.clone().invert(), turn = window.__nav.rotation;
  const north = new V(0, 1, 0).applyQuaternion(turn).applyQuaternion(toEye);
  const globe = scene.getObjectByName('globe'), centre = globe.getWorldPosition(new V()), eyeward = camera.getWorldDirection(new V()).negate();
  const readable = ids.filter(id => scene.getObjectByName('planet:' + id).getWorldPosition(new V()).sub(centre).normalize().dot(eyeward) >= 0.5).length;
  const mini = document.querySelector('.planet-mini-globe');
  const mark = mini?.querySelector('.mini-globe-facing circle');
  const canvas = gl.domElement.getBoundingClientRect(), box = mini?.getBoundingClientRect();
  return {
    tiltDegrees: +(Math.asin(Math.max(-1, Math.min(1, north.z))) * 180 / Math.PI).toFixed(1),
    northBearingDegrees: +(Math.atan2(north.x, north.y) * 180 / Math.PI).toFixed(1),
    zoom: +camera.zoom.toFixed(3), readable, of: ids.length,
    miniGlobe: mini === null ? null : { right: Math.round(canvas.right - box.right), top: Math.round(box.top - canvas.top), width: Math.round(box.width),
      mark: { x: +(+mark.getAttribute('cx')).toFixed(1), y: +(+mark.getAttribute('cy')).toFixed(1), behind: mark.parentElement.classList.contains('behind') } },
  };
}, ids);

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
  await page.mouse.move(2, 400);
}
/** Thirty wheel steps out from the middle of the canvas: far past where the floor stops it. */
async function wheelOut(page) {
  const box = await page.evaluate(`(() => { const b = globalThis.__globe.gl.domElement.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await page.mouse.move(box.x, box.y);
  for (let step = 0; step < 30; step++) { await page.mouse.wheel(0, 240); await page.evaluate('new Promise(requestAnimationFrame)'); }
  await page.mouse.move(2, 400);
}
const eased = page => page.waitForTimeout(1200);

let opening;
await runCapture({
  folder: here, dist, seed, survey,
  prepare: async ({ page, errors, failed, warnings }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, ids, { timeout: 180000 }).catch(async error => {
      console.error(JSON.stringify({ state: await page.evaluate(() => document.body.dataset.state), errors, urls: failed, warnings: warnings.slice(0, 5) }));
      throw error;
    });
    await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  },
  views: [
    { name: 'opening', measure: async ({ page, errors }) => ({ ...(opening = await reading(page)), errors }),
      expect: seen => { assert.deepEqual(seen.errors, []); assert.ok(seen.miniGlobe); console.log('opening', JSON.stringify(seen)); } },
    // Half the canvas's height sideways: the globe half-way round; the mark goes behind the mini globe.
    { name: 'spun-half-round', prepare: ({ page }) => drag(page, 0.5, 0), measure: ({ page }) => reading(page),
      expect: seen => { assert.equal(seen.miniGlobe.mark.behind, true); console.log('spun', JSON.stringify(seen)); } },
    // Back, then a long drag down: the tilt holds at its stop.
    { name: 'tilted-to-the-stop', prepare: async ({ page }) => { await drag(page, -0.5, 0); await drag(page, 0, 0.4); }, measure: ({ page }) => reading(page),
      expect: seen => { assert.ok(Math.abs(Math.abs(seen.tiltDegrees) - 50) < 0.5, `tilt ${seen.tiltDegrees}`); console.log('tilted', JSON.stringify(seen)); } },
    // A suggestion only, drawn by this script and built into nothing: the poles marked on the main globe too.
    { name: 'suggestion-poles-on-the-globe', prepare: ({ page }) => page.evaluate(() => {
        const { scene, camera, gl } = globalThis.__globe, V = camera.position.constructor;
        scene.updateMatrixWorld(true);
        const globe = scene.getObjectByName('globe'), box = gl.domElement.getBoundingClientRect();
        let island; scene.traverse(o => { if (!island && o.name.startsWith('planet:') && o.name !== 'planet:shell') island = o; });
        const radius = island.getWorldPosition(new V()).distanceTo(globe.getWorldPosition(new V()));
        for (const [label, y] of [['N', 1], ['S', -1]]) {
          const at = globe.localToWorld(new V(0, y * radius, 0)), ndc = at.clone().project(camera);
          const front = at.clone().sub(globe.getWorldPosition(new V())).dot(camera.getWorldDirection(new V())) < 0;
          const mark = document.createElement('div');
          mark.textContent = label;
          mark.style.cssText = `position:fixed;z-index:60;left:${box.left + (ndc.x + 1) * box.width / 2 - 13}px;top:${box.top + (1 - ndc.y) * box.height / 2 - 13}px;width:22px;height:22px;border:2px solid #e6ecf0;border-radius:50%;color:#e6ecf0;background:#101418cc;font:700 12px/22px system-ui;text-align:center;opacity:${front ? 1 : 0.4}`;
          document.body.append(mark);
        }
      }), measure: ({ page }) => reading(page), expect: () => {} },
    // The Home key: back to the opening view.
    { name: 'home-by-key', prepare: async ({ page }) => { await page.evaluate(() => { for (const m of [...document.body.children].filter(e => /^[NS]$/.test(e.textContent ?? '') && e.style.position === 'fixed')) m.remove(); }); await drag(page, 0.3, -0.1); await page.keyboard.press('Home'); await eased(page); }, measure: ({ page }) => reading(page),
      expect: seen => { assert.equal(seen.tiltDegrees, opening.tiltDegrees); assert.deepEqual(seen.miniGlobe.mark, opening.miniGlobe.mark); console.log('home', JSON.stringify(seen)); } },
    // The wheel out as far as it goes: half the opening size.
    { name: 'zoomed-out-to-the-floor', prepare: async ({ page }) => { await wheelOut(page); }, measure: ({ page }) => reading(page),
      expect: seen => { assert.ok(Math.abs(seen.zoom - opening.zoom / 2) < 0.01, `zoom ${seen.zoom} from ${opening.zoom}`); console.log('floor', JSON.stringify(seen)); } },
    // A click on the mini globe: back to the opening turn and size.
    { name: 'home-by-click', prepare: async ({ page }) => { await drag(page, -0.35, 0.2); await page.locator('.planet-mini-globe').click(); await eased(page); }, measure: ({ page }) => reading(page),
      expect: seen => { assert.equal(seen.zoom, opening.zoom); assert.deepEqual(seen.miniGlobe.mark, opening.miniGlobe.mark); console.log('click home', JSON.stringify(seen)); } },
  ],
});
