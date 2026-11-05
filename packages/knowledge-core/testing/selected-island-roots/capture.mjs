// A selected island's notes with the camera still (ADR-1260, increment_ebd12caebc5c): storytree's own map (the code-rows
// seed) as the desktop page draws it, The knowledge core's island clicked, then the sheet tilted by a real right-drag to side
// on and to below, each shot on smoked glass and under the Library button's clear glass. Build the page of a checkout first:
//   node --import tsx packages/knowledge-core/testing/traversal-when-selected/build.mjs <checkout> before|after
// then, from the checkout root, in the foreground: node --import tsx packages/knowledge-core/testing/selected-island-roots/capture.mjs before|after [--retake]
// Counts, from the scene, the links and roots drawn and the faintest and brightest dot, so "no link web", "roots for the
// selected story's notes only" and "the rest faded back" are measured, not looked at.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFolder, captureSeed, fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts';
import { SHEET_TILT } from '../../../forest-world/src/planet/PlanetWorldCanvas.tsx';

const label = process.argv[2];
assert.ok(['before', 'after'].includes(label), 'pass a before/after build label');
const here = path.dirname(fileURLToPath(import.meta.url));
// Pictures and measurements go to the package's evidence set of this name (a scratch folder unless --retake).
const evidence = path.join(here, '../../src/view/evidence', 'selected-island-roots');
const dist = buildFolder(path.join(here, '../traversal-when-selected'), label);
const { seed, survey } = captureSeed('code-rows');
const viewport = { width: 1440, height: 960 };
const resting = Math.round(SHEET_TILT * 1800 / Math.PI) / 10;
const PER_DEGREE = 600 / 180;
const CLOSE = 3;
const TILTS = [{ name: 'side-on', deg: 80 }, { name: 'below', deg: 180 - resting }];
const story = seed.tree.stories.find(s => s.title === 'The knowledge core').id;

const measure = page => page.evaluate(() => {
  const { scene } = window.__globe;
  const under = scene.getObjectByName('sheet:under');
  let links = 0, roots = 0, dots = 0, shaded = 0;
  const opacities = [];
  under?.traverse(object => {
    if (object.name === 'knowledge-links') links += object.userData.links;
    if (object.name === 'knowledge-roots') roots += object.userData.roots;
    if (object.name.startsWith('knowledge-point:')) {
      dots++; opacities.push(object.material.opacity);
      if (object.material.type !== 'MeshBasicMaterial') shaded++;
    }
  });
  const round = x => Math.round(x * 1000) / 1000;
  return { selected: document.body.dataset.selected ?? null, dots, shaded, links, roots, faintest: round(Math.min(...opacities)), brightest: round(Math.max(...opacities)) };
});

const { results, out } = await withCapture({ folder: evidence, dist }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const copy = value => structuredClone(value);
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: seed.projects, current: 'storytree' }),
    chooseProject: async () => ({ projects: seed.projects, current: 'storytree' }),
    listProjects: async () => copy(seed.projects), projectTree: async () => copy(seed.tree),
    changesSince: async (_, cursor) => cursor === 0 ? copy(seed.changes) : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? copy(seed.lines) : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => copy(seed.covers[id] ?? []),
    ...(survey === undefined ? {} : { codeSurvey: async () => copy(survey) }),
  });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.waitForFunction(() => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !state.scene.getObjectByName('sheet:glass')) return false;
    let n = 0; state.scene.getObjectByName('sheet:under')?.traverse(o => { if (o.name.startsWith('knowledge-point:')) n++; }); return n > 0;
  }, undefined, { timeout: 180000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  await settle(page, 12);
  const island = await page.evaluate(id => window.storytreeGlobe.islands().find(i => i.story === id), story);
  await page.mouse.click(island.x, island.y);
  await page.waitForFunction(id => document.body.dataset.selected === id, story, { timeout: 60000 });
  await page.waitForFunction(() => window.storytreeGlobe.still(), undefined, { timeout: 60000 });
  await page.mouse.move(2, 2);
  await settle(page, 12);
  const box = await page.locator('canvas').first().boundingBox();
  const tiltBy = async by => {
    const x = box.x + box.width / 2, y = box.y + box.height / 2, steps = Math.max(1, Math.ceil(Math.abs(by)));
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    for (let k = 1; k <= steps; k++) await page.mouse.move(x, y - by * PER_DEGREE * k / steps);
    await page.mouse.up({ button: 'right' });
    await page.mouse.move(2, 2);
    await settle(page, 12);
  };
  const press = async which => { await page.locator(`[data-globe-switch="${which}"]`).click(); await page.mouse.move(2, 2); await page.waitForTimeout(1200); await settle(page, 12); };
  const results = {};
  let at = resting;
  for (const { name, deg } of TILTS) {
    await tiltBy(deg - at);
    at = deg;
    await page.screenshot({ path: path.join(out, `${label}-${name}.png`), timeout: 180000 });
    const smoked = await measure(page);
    await press('library');
    await page.screenshot({ path: path.join(out, `${label}-${name}-library.png`), timeout: 180000 });
    const clear = await measure(page);
    // Closer, the eye's zoom alone, so a ball's shading and a root's line can be seen; then back.
    const zoomBy = times => page.evaluate(times => { const { camera, invalidate } = window.__globe; camera.zoom *= times; camera.updateProjectionMatrix(); invalidate(); }, times);
    await zoomBy(CLOSE); await settle(page, 12);
    await page.screenshot({ path: path.join(out, `${label}-${name}-library-close.png`), timeout: 180000 });
    await zoomBy(1 / CLOSE); await settle(page, 12);
    await press('stories');
    assert.equal(smoked.selected, story, `${name}: The knowledge core stays selected`);
    results[name] = { smoked, clear };
  }
  assert.deepEqual(errors, []);
  return { results, out };
});
writeFileSync(path.join(out, `${label}-measurements.json`), JSON.stringify({ viewport, seed: 'code-rows', story, results }, null, 1) + '\n');
console.log(JSON.stringify(results));
