// Seeded headless-Chromium evidence of the selection lanes drawing on (world 6.8–6.9, forest 3.27). Run with
// `node --import tsx capture.mjs before <main checkout>` or `... after`, under the machine's heavy-run lock (see README);
// --retake replaces the committed pictures. Same seed (lanes-at-the-coast's), viewport and turn for both builds; the
// only inputs are clicks. Frames are taken at wall-clock moments after the click and say how far each lane had drawn.
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, runCapture, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const [label, checkout] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
assert.ok(label === 'before' ? checkout !== undefined : label === 'after', 'pass `before <checkout>` or `after`');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '..', 'lanes-at-the-coast', 'seed.json.gz'))).toString('utf8'));
const byTitle = title => seed.tree.stories.find(story => story.title === title).id;
const SELECTED = byTitle('The library'), KEYS = byTitle('Keys'), FACING = [SELECTED, byTitle('The map'), KEYS];
const MOMENTS = [0.15, 0.4, 0.7, 1.0, 1.4, 1.9, 2.6, 4.0];
const dist = path.join(here, 'dist', label);
await buildCapture({ dist, ...(checkout ? { root: path.resolve(checkout) } : {}) });

// In-page: turn the globe so the given islands' middle faces the viewer, a little left of the story panel.
const face = (page, ids, left = 0.3) => page.evaluate(([ids, left]) => {
  const { camera, scene, invalidate } = window.__globe, { rotation, onRotate } = window.__nav;
  scene.updateMatrixWorld(true);
  const V = camera.position.constructor, Q = camera.quaternion.constructor;
  const centre = new V();
  for (const id of ids) centre.add(scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).normalize());
  centre.normalize();
  const eye = new V(-Math.sin(left), 0, Math.cos(left)).applyQuaternion(camera.quaternion);
  onRotate(new Q().setFromUnitVectors(centre, eye).multiply(rotation));
  invalidate();
}, [ids, left]);

const click = async (page, id) => {
  const at = await page.evaluate(id => {
    const { camera, scene } = window.__globe;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const ndc = scene.getObjectByName(`planet:${id}`).getWorldPosition(camera.position.clone()).project(camera);
    return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  }, id);
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(2, 2);
  return page.evaluate(() => performance.now());
};

// In-page: how far each lane has drawn (the shader's front over the lane's length after; the draw range before),
// its head's brightness after, and each neighbour ring's state.
const reading = (page, since) => page.evaluate(since => {
  const { scene } = window.__globe;
  const lanes = [], rings = [];
  scene.traverse(object => {
    if (object.name.startsWith('lane:')) {
      const uniforms = object.material.uniforms;
      const drawn = uniforms ? Math.max(0, uniforms.uDrawn.value) / object.userData.length
        : Math.min(object.geometry.drawRange.count, object.geometry.index.count) / object.geometry.index.count;
      lanes.push({ name: object.name, drawn: +drawn.toFixed(3), ...(uniforms ? { head: +uniforms.uHead.value.toFixed(3) } : {}) });
    }
    if (object.name.startsWith('neighbour-ring:')) rings.push({ name: object.name, visible: object.visible, opacity: +object.material.opacity.toFixed(3) });
  });
  const group = scene.getObjectByName('pathways:selection-lanes');
  return { secondsSinceClick: +((performance.now() - since) / 1000).toFixed(2), lanes, rings, timing: group?.userData.lanes };
}, since);

const all = drawn => drawn.lanes.length > 0 && drawn.lanes.every(lane => lane.drawn >= 0.999);
const frames = [];
let reduced;
await runCapture({
  folder: here, dist, seed,
  prepare: async ({ page, out }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 180000 });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await face(page, FACING);
    await page.waitForTimeout(500);
    // Keys first, so the library's click is a fresh selection drawn from an already settled globe.
    await click(page, KEYS);
    await page.waitForTimeout(4000);
    await face(page, FACING);
    await page.waitForTimeout(500);
    const since = await click(page, SELECTED);
    for (const [i, moment] of MOMENTS.entries()) {
      await page.waitForFunction(([since, moment]) => performance.now() - since >= moment * 1000, [since, moment], { polling: 10 });
      const value = await reading(page, since);
      await page.screenshot({ path: path.join(out, `${label}-frame-${i + 1}.png`), timeout: 180000 });
      frames.push({ frame: i + 1, ...value });
    }
    writeFileSync(path.join(out, `${label}-frames.json`), JSON.stringify({ label, selected: 'The library', frames }, null, 2) + '\n');
    await page.waitForFunction(() => { window.__globe.invalidate(); return true; });
    // Reduced motion: select Keys and The library again with the preference on; the first frame is the last.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await click(page, KEYS);
    await page.waitForTimeout(1000);
    const again = await click(page, SELECTED);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    reduced = await reading(page, again);
  },
  views: [
    { name: `${label}-reduced-motion`, measure: async () => ({ label, reducedMotion: true, ...reduced }),
      expect: value => assert.ok(all(value), 'under reduced motion every lane is whole at once') },
  ],
});

// One picture: the globe's part of each frame side by side, four to a row, each labelled with its moment.
assert.ok(all(frames.at(-1)), 'every lane is whole by the last frame');
await runStrip();
async function runStrip() {
  await withCapture({ folder: here, softwareGL: false }, async ({ browser, out }) => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 700 }, deviceScaleFactor: 1 });
    const cells = frames.map(({ frame, secondsSinceClick, lanes }) => {
      const src = `data:image/png;base64,${readFileSync(path.join(out, `${label}-frame-${frame}.png`)).toString('base64')}`;
      const whole = lanes.filter(lane => lane.drawn >= 0.999).length;
      return `<figure><div><img src="${src}"></div><figcaption>${secondsSinceClick.toFixed(2)} s · ${whole}/${lanes.length} lanes whole</figcaption></figure>`;
    }).join('');
    await page.setContent(`<style>body{margin:0;background:#101418;color:#ddd;font:15px system-ui}main{display:grid;grid-template-columns:repeat(4,480px)}
      figure{margin:0}div{width:480px;height:480px;overflow:hidden}img{width:1152px;margin:-152px 0 0 -272px;display:block}figcaption{padding:4px 8px}</style><main>${cells}</main>`);
    await page.screenshot({ path: path.join(out, `${label}-strip.png`), fullPage: true });
    // The strip holds every frame; only the after build's mid-draw frame is kept whole, at full size.
    for (const { frame } of frames) if (label !== 'after' || frame !== 2) unlinkSync(path.join(out, `${label}-frame-${frame}.png`));
  });
}
