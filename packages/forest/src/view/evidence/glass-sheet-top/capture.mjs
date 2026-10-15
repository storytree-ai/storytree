// The forest page's glass sheet, top face (increment_5e1d982b32a6, ADR-1043 D1, D2, D4), drawn by the actual desktop page from
// a read-only snapshot of storytree's own library: the spike's (branch spike/glass-sheet, its evidence seed.json.gz and
// survey.json), kept out of this repository for its size. Every pan is a real pointer drag or a real sideways scroll, every
// zoom a real wheel, Home a real key press. Run from the checkout root, in the foreground, with the snapshot's folder:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/glass-sheet-top/capture.mjs <seed folder> --retake
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (from === undefined) throw new Error('Name the folder holding the snapshot (seed.json.gz and survey.json).');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(from, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(from, 'survey.json'), 'utf8'));
const dist = path.join(here, 'dist');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

/** What the eye sees now: the eye's zoom and whether it looks straight down, each island's facing and screen place, the names shown. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const islands = [];
  scene.traverse(object => {
    if (!object.name.startsWith('planet:story_')) return;
    const facing = new V(0, 1, 0).applyQuaternion(object.getWorldQuaternion(new Q())).dot(eye);
    const p = object.getWorldPosition(new V()).project(camera);
    const ground = object.getObjectByName('island-ground');
    ground.geometry.computeBoundingBox();
    const box = ground.geometry.boundingBox;
    islands.push({ story: object.name.slice(7), facing: Math.round(facing * 100000) / 100000,
      x: Math.round((p.x + 1) / 2 * canvas.width), y: Math.round((1 - p.y) / 2 * canvas.height),
      onScreen: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
      acrossPx: Math.round(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * camera.zoom * 10) / 10 });
  });
  const shown = [...document.querySelectorAll('.planet-nameplate:not(.capability)')].filter(el => {
    const r = el.getBoundingClientRect();
    let visible = getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.right > canvas.left && r.left < canvas.right && r.bottom > canvas.top && r.top < canvas.bottom;
    for (let at = el; at && visible; at = at.parentElement) if (getComputedStyle(at).display === 'none' || Number(getComputedStyle(at).opacity) === 0) visible = false;
    return visible;
  });
  const glass = scene.getObjectByName('sheet:glass');
  const pane = glass.getObjectByName('sheet:pane');
  pane.geometry.computeBoundingBox();
  const corners = [pane.geometry.boundingBox.min, pane.geometry.boundingBox.max].map(c => pane.localToWorld(c.clone()).project(camera));
  return {
    debug: { frustum: [camera.left, camera.right, camera.top, camera.bottom, camera.zoom, camera.view?.enabled], canvas: [canvas.width, canvas.height],
      glassPx: corners.map(c => [Math.round((c.x + 1) / 2 * canvas.width), Math.round((1 - c.y) / 2 * canvas.height)]),
      glassUnits: [pane.geometry.boundingBox.max.x - pane.geometry.boundingBox.min.x, pane.geometry.boundingBox.max.y - pane.geometry.boundingBox.min.y] },
    zoomPxPerUnit: Math.round(camera.zoom * 1000) / 1000,
    leastFacing: Math.min(...islands.map(i => i.facing)),
    islands: islands.length, islandsOnScreen: islands.filter(i => i.onScreen).length,
    medianIslandAcrossPx: islands.map(i => i.acrossPx).sort((a, b) => a - b)[Math.floor(islands.length / 2)],
    namesShown: shown.length, miniGlobe: document.querySelector('.planet-mini-globe') !== null, glass: glass !== undefined,
    selected: document.body.dataset.selected ?? null,
    perIsland: islands,
  };
});

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const results = {};
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const copy = value => structuredClone(value);
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: seed.projects, current: 'storytree' }),
    chooseProject: async () => ({ projects: seed.projects, current: 'storytree' }),
    listProjects: async () => copy(seed.projects), projectTree: async () => copy(seed.tree),
    changesSince: async (_, cursor) => cursor === 0 ? copy(seed.changes) : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? copy(seed.lines) : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => copy(seed.covers[id] ?? []),
    codeSurvey: async () => copy(survey),
  });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !state.scene.getObjectByName('sheet:glass')) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 180000 });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.getObjectByName('globe-roads')?.traverse(o => { if (o.isMesh) n++; }); return n > 0; }, undefined, { timeout: 180000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  const box = await page.locator('canvas').first().boundingBox();
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const shoot = async name => {
    await page.mouse.move(2, 2);
    await settle(page, 30);
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    results[name] = await measure(page);
    const { perIsland, ...summary } = results[name];
    console.log(name, JSON.stringify(summary));
  };
  const drag = async (dx, dy) => {
    await page.mouse.move(middle.x - dx / 2, middle.y - dy / 2);
    await page.mouse.down();
    await page.mouse.move(middle.x + dx / 2, middle.y + dy / 2, { steps: 30 });
    await page.mouse.up();
  };
  const where = async story => (await measure(page)).perIsland.find(i => i.story === story);

  await shoot('sheet-top');
  const rest = results['sheet-top'];
  assert.equal(rest.miniGlobe, false, 'the sheet has no mini globe');
  assert.ok(rest.leastFacing > Math.cos(Math.PI / 180), 'every island faces the eye square-on');
  // A real drag left by 500 px: every island moves 500 px left, and the sheet stays square-on.
  const probe = rest.perIsland.find(i => i.onScreen).story, before = await where(probe);
  await drag(-500, 0);
  await settle(page, 10);
  const after = await where(probe);
  assert.ok(Math.abs(after.x - before.x + 500) <= 2 && Math.abs(after.y - before.y) <= 2, `a drag pans the sheet: ${JSON.stringify({ before, after })}`);
  // A real sideways scroll east: the sheet moves on west under the eye.
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(400, 0);
  await settle(page, 10);
  assert.ok((await where(probe)).x < after.x - 300, 'a sideways scroll pans the sheet');
  await shoot('sheet-scrolled-east');
  // The wheel zooms in, about the view's middle.
  await page.mouse.move(middle.x, middle.y);
  for (let k = 0; k < 12; k++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(120); }
  await shoot('sheet-zoomed');
  assert.ok(results['sheet-zoomed'].zoomPxPerUnit > 1.5 * rest.zoomPxPerUnit, 'the wheel zooms in');
  assert.ok(results['sheet-zoomed'].leastFacing > Math.cos(Math.PI / 180), 'still square-on');
  // Home eases back to the opening view.
  await page.keyboard.press('Home');
  await page.waitForTimeout(1200);
  await shoot('sheet-home');
  const home = results['sheet-home'];
  assert.ok(Math.abs(home.zoomPxPerUnit - rest.zoomPxPerUnit) < 1e-3, 'Home restores the opening zoom');
  for (const island of home.perIsland) {
    const opened = rest.perIsland.find(i => i.story === island.story);
    assert.ok(Math.abs(island.x - opened.x) <= 1 && Math.abs(island.y - opened.y) <= 1, `Home puts ${island.story} back where it opened`);
  }
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ viewport, seed: seed.stats, results }, null, 1) + '\n');
});
