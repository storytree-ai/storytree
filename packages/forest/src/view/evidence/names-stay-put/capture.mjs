// Story names that stay put (ADR-0917): the five-story row and chain (1.10) and storytree's own globe as the app opens them,
// the same quarter turn by real pointer drags, and The agent link selected with its capability names (3.33), on the shared runner.
// `node --import tsx build.mjs <checkout> before|after`, then `node --import tsx capture.mjs before|after` (append --retake to
// replace the committed pictures). Measures every story name: shown or faded, overlapping pairs among the shown, and where each
// name's top middle lies on its own island's plate before and after the turn, in ground units, so "unmoved" is measured.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, runCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const titles = ['Have an account', 'Comment on articles', 'Browse the home page feed', 'Read and write articles', 'Follow people and favourite articles'];
const health = { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
/** A five-story project as a first build makes it, as ../five-stories makes it. */
function fiveStories(chain) {
  const ids = titles.map((_, i) => `story_conduit${i}`);
  const stories = ids.map((id, i) => ({ id, title: titles[i], description: '', health, capabilities: [{
    id: `capability_conduit${i}`, title: '1 · First capability', description: '', dependsOn: chain && i > 0 ? [`capability_conduit${i - 1}`] : [],
    proposed: true, status: 'proposed', contracts: [], health }] }));
  const changes = stories.map((s, i) => ({ seq: i + 1, recordId: s.id, type: 'story', action: 'created',
    record: { id: s.id, type: 'story', fields: { title: s.title, description: '' }, version: 1, createdAt: `2026-10-01T10:0${i}:00.000Z`, updatedAt: `2026-10-01T10:0${i}:00.000Z` } }));
  return { seed: { projects: ['storytree'], tree: { stories, arcs: [] }, changes: { changes, cursor: changes.length }, lines: { lines: [], cursor: 0 }, covers: {} }, survey: {} };
}
const own = { seed: JSON.parse(gunzipSync(readFileSync(path.join(here, '../code-rows/seed.json.gz'))).toString('utf8')),
  survey: JSON.parse(readFileSync(path.join(here, '../code-rows/survey.json'), 'utf8')) };
const agentLink = own.seed.tree.stories.find(s => s.title === 'The agent link').id;

/** Every story name: its box, whether it shows (facing, not behind the sphere, not faded or hidden as crowded), and where its top middle lies on its island's plate. */
const names = page => page.evaluate(() => {
  const { scene, camera, gl } = window.__globe, V = camera.position.constructor;
  const box = gl.domElement.getBoundingClientRect();
  scene.updateMatrixWorld(true);
  return [...document.querySelectorAll('.planet-nameplate[data-story-id]')].map(el => {
    const r = el.getBoundingClientRect(), wrapper = el.closest('div[style*="position: absolute"]') ?? el;
    const shown = el.style.visibility !== 'hidden' && r.width > 0 && getComputedStyle(wrapper).display !== 'none' && !el.classList.contains('crowded');
    // The ray through the name's top middle, met with the surface its anchor lies on (onIslandSurface with a lift of 2: a sphere
    // as big as the plate's, its middle 2 above the globe's), in the plate's own ground. Unprojected at the near and far planes,
    // so the ray holds for an orthographic camera as for a perspective one.
    const plate = scene.getObjectByName(`planet:${el.dataset.storyId}`), toPlate = plate.matrixWorld.clone().invert();
    const nx = (r.left + r.width / 2 - box.left) / box.width * 2 - 1, ny = 1 - (r.top - box.top) / box.height * 2;
    const o = new V(nx, ny, -1).unproject(camera).applyMatrix4(toPlate), d = new V(nx, ny, 1).unproject(camera).applyMatrix4(toPlate).sub(o).normalize();
    const sphere = plate.position.length(), c = new V(0, 2 - sphere, 0), oc = o.clone().sub(c);
    const half = oc.dot(d), t = -half - Math.sqrt(Math.max(half * half - (oc.lengthSq() - sphere * sphere), 0));
    const local = o.clone().add(d.multiplyScalar(t));
    return { story: el.dataset.storyId, title: el.textContent, box: [r.left, r.top, r.right, r.bottom].map(Math.round), shown,
      faded: el.classList.contains('crowded'), facing: +(+el.dataset.facing || 0).toFixed(2), onPlate: { x: +local.x.toFixed(1), z: +local.z.toFixed(1) } };
  });
});
const overlapping = list => {
  // As the view judges it: boxes running into each other by more than NAME_OVERLAP_SLACK (4 px) both ways.
  const shown = list.filter(p => p.shown), slack = 4;
  return shown.flatMap((a, i) => shown.slice(i + 1).filter(b => a.box[0] + slack < b.box[2] && b.box[0] + slack < a.box[2] && a.box[1] + slack < b.box[3] && b.box[1] + slack < a.box[3]).map(b => [a.title, b.title]));
};
/** Wait out the fade, then draw a few frames. */
const rest = async (page, settle) => { await page.waitForTimeout(400); await settle(page, 24); };

const results = { label, forests: {} };
const forests = { row: fiveStories(false), chain: fiveStories(true), storytree: own };
for (const [name, { seed, survey }] of Object.entries(forests)) {
  const views = [{
    name: `${label}-${name}`, measurement: `measurements-${label}.json`,
    prepare: ({ page, settle }) => rest(page, settle),
    measure: async ({ page, browser, errors }) => {
      results.browser = await browser.version();
      const plates = await names(page);
      results.forests[name] = { errors, shown: `${plates.filter(p => p.shown).length} of ${plates.length}`, overlaps: overlapping(plates), plates };
      console.log(label, name, 'shown', results.forests[name].shown, 'overlapping pairs', results.forests[name].overlaps.length);
      return results;
    },
  }];
  if (name === 'storytree') views.push({
    // A quarter turn east by a real pointer drag: a quarter of the canvas's height turns the globe a quarter round (dragTurn).
    name: `${label}-storytree-quarter-turn`, measurement: `measurements-${label}.json`,
    prepare: async ({ page, settle }) => {
      const canvas = await page.locator('canvas').first().boundingBox();
      const y = canvas.y + canvas.height * 0.3, from = canvas.x + canvas.width / 2 - canvas.height / 8;
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(from + canvas.height / 4, y, { steps: 30 });
      await page.mouse.up();
      await page.mouse.move(2, 2);
      await rest(page, settle);
    },
    measure: async ({ page }) => {
      const plates = await names(page), opening = new Map(results.forests.storytree.plates.map(p => [p.story, p]));
      // Each name shown both before and after the turn, its island facing the eye at 0.2 or more both times (nearer the rim,
      // a pixel is many ground units on the slanted plate): how far its top middle moved on its own island's plate.
      const moved = plates.filter(p => p.shown && p.facing >= 0.2 && opening.get(p.story)?.shown && opening.get(p.story).facing >= 0.2).map(p => {
        const was = opening.get(p.story).onPlate;
        return { title: p.title, moved: +Math.hypot(p.onPlate.x - was.x, p.onPlate.z - was.z).toFixed(1) };
      });
      results.forests.storytreeTurned = { shown: `${plates.filter(p => p.shown).length} of ${plates.length}`, overlaps: overlapping(plates), moved,
        mostMoved: Math.max(0, ...moved.map(m => m.moved)), plates };
      console.log(label, 'quarter turn', 'shown', results.forests.storytreeTurned.shown, 'furthest a name moved on its plate', results.forests.storytreeTurned.mostMoved);
      return results;
    },
  }, {
    // The agent link faced a little left of the middle, selected by a click, and zoomed in, as ../capability-names looks at it.
    name: `${label}-agent-link-selected`, measurement: `measurements-${label}.json`,
    prepare: async ({ page, settle }) => {
      await page.evaluate(id => {
        const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
        const d = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).applyQuaternion(window.__nav.rotation.clone().invert()).normalize();
        const turn = (axis, angle) => new Q().setFromAxisAngle(new V(...axis), angle);
        window.__nav.onRotate(camera.quaternion.clone().multiply(turn([0, 1, 0], -0.2).multiply(turn([1, 0, 0], Math.asin(d.y))).multiply(turn([0, 1, 0], -Math.atan2(d.x, d.z)))));
      }, agentLink);
      await settle(page);
      const where = () => page.evaluate(id => {
        const { scene, camera, gl } = window.__globe, V = camera.position.constructor, box = gl.domElement.getBoundingClientRect();
        const s = scene.getObjectByName(`planet:${id}`).getWorldPosition(new V()).project(camera);
        return { x: box.left + (s.x + 1) * box.width / 2, y: box.top + (1 - s.y) * box.height / 2 };
      }, agentLink);
      let at = await where();
      await page.mouse.click(at.x, at.y);
      await page.mouse.move(2, 2);
      await settle(page);
      at = await where();
      await page.mouse.move(at.x, at.y);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await settle(page, 4); }
      await page.mouse.move(2, 2);
      await rest(page, settle);
    },
    measure: async ({ page }) => {
      const capabilities = await page.evaluate(() => [...document.querySelectorAll('.planet-nameplate.capability')].filter(p => p.getBoundingClientRect().width > 0).map(p => {
        const r = p.getBoundingClientRect();
        return { title: p.textContent, box: [r.left, r.top, r.right, r.bottom].map(Math.round), shown: !p.classList.contains('crowded') };
      }));
      results.forests.agentLinkSelected = { capabilities: `${capabilities.filter(p => p.shown).length} of ${capabilities.length} shown`,
        overlaps: overlapping(capabilities), faded: capabilities.filter(p => !p.shown).map(p => p.title), list: capabilities };
      console.log(label, 'agent link', results.forests.agentLinkSelected.capabilities, 'overlapping pairs', results.forests.agentLinkSelected.overlaps.length);
      return results;
    },
  });
  await runCapture({
    folder: here, dist: path.join(here, 'dist', label), seed, survey,
    prepare: async ({ page }) => {
      await page.waitForFunction(ids => {
        const state = window.__globe;
        if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
        return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
      }, seed.tree.stories.map(s => s.id), { timeout: 120000 });
      if (name === 'storytree') await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 60000 });
      for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
      await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    },
    views,
  });
}
writeFileSync(path.join(captureOutput(here), `measurements-${label}.json`), JSON.stringify(results, null, 1) + '\n');
