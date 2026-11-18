import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'junction-plaza');
const name = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'after';
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[junction plaza +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const storyOf = title => seed.tree.stories.find(story => story.title === title).id;
const islands = [['the-library', 'The library'], ['the-agent-link', 'The agent link'], ['the-command-line', 'The command line'], ['the-dev-loop', 'The dev loop']];
const measure = (page, story) => page.evaluate(story => {
  const found = { settlements: 0, territoryJunctions: 0, raised: [] };
  const shown = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  window.__globe.scene.getObjectByName(`planet:${story}`).traverse(object => {
    if (!shown(object)) return;
    if (object.name.startsWith('settlement:')) found.settlements++;
    if (object.name.startsWith('territory-junction:')) {
      found.territoryJunctions++;
      const p = object.geometry.getAttribute('position');
      let low = Infinity, high = -Infinity;
      for (let k = 0; k < p.count; k++) { low = Math.min(low, p.getY(k)); high = Math.max(high, p.getY(k)); }
      found.raised.push(Math.round((high - low) * 1000) / 1000);
    }
  });
  return found;
}, story);
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const closeUp = async (page, settle, story, times) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), story)) throw new Error(`no camera stop for ${story}`);
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom: DETAIL_ZOOM.near * times, ...eye });
  await settle(page, 12);
};
const results = {};
const library = async (page, settle, on) => {
  const button = page.locator('[data-globe-switch="library"]');
  if ((await button.getAttribute('aria-pressed') === 'true') !== on) await button.click();
  await page.mouse.move(2, 2);
  await settle(page, 12);
  await page.waitForTimeout(1500);
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
};
const view = (file, title, times, tilted = false) => ({
  name: `${name}-${file}`,
  prepare: async ({ page, settle }) => {
    const story = storyOf(title);
    await until(page, `${title} laid out with its roads`, story => !!window.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-roads'), story);
    await library(page, settle, false);
    await closeUp(page, settle, story, times);
    if (tilted) await library(page, settle, true);
  },
  measure: async ({ page }) => (results[`${file}`] = await measure(page, storyOf(title))),
});

await runCapture({
  folder: pictures, dist, seed, survey, name,
  prepare: async ({ page }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  },
  views: [
    view('the-library-near', 'The library', 4),
    view('the-library-far', 'The library', 1.2),
    ...islands.slice(1).map(([file, title]) => view(`${file}-near`, title, 3)),
    view('the-library-near-tilted', 'The library', 4, true),
    view('the-library-far-tilted', 'The library', 1.2, true),
    view('the-agent-link-near-tilted', 'The agent link', 3, true),
  ],
});
writeFileSync(path.join(captureOutput(pictures, { name }), `${name}-measurements.json`), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
