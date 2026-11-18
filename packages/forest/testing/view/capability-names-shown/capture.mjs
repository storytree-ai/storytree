import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_SLACK, DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'capability-names-shown');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[names +${Math.round(performance.now() - started)}ms] ${message}`);
const until = (page, predicate, arg, timeout = 300_000) => page.waitForFunction(predicate, arg, { timeout, polling: 250 });
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const near = DETAIL_ZOOM.near * (1 + DETAIL_SLACK + 0.03);

const names = page => page.evaluate(() => {
  const inWindow = box => box.width > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
  const all = [...document.querySelectorAll('.planet-nameplate.capability')].filter(label => label.parentElement?.style.display !== 'none' && inWindow(label.getBoundingClientRect()));
  const hidden = all.filter(label => Number(getComputedStyle(label).opacity) < 0.05);
  return { drawn: all.length, hidden: hidden.map(label => label.textContent) };
});
const faceAt = async (page, settle, story, zoom) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), story)) return false;
  await until(page, () => window.storytreeGlobe.still());
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
  return true;
};

const results = { zoom: near, islands: {} };
const library = seed.tree.stories.find(story => story.title === 'The library').id;
await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle }) => {
    await until(page, () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('island-roads')) laid++; } }); return n > 0 && laid === n; });
    await settle(page);
  },
  views: [{
    name: 'every-island',
    picture: false,
    measure: async ({ page, settle }) => {
      for (const story of seed.tree.stories) if (await faceAt(page, settle, story.id, near)) { results.islands[story.title] = await names(page); phase(`${story.title}: ${JSON.stringify(results.islands[story.title])}`); }
      const all = Object.values(results.islands);
      results.total = { drawn: all.reduce((n, i) => n + i.drawn, 0), hidden: all.reduce((n, i) => n + i.hidden.length, 0) };
      return results.total;
    },
    expect: found => assert.ok(found.drawn > 0, 'facing each island, capability names are drawn'),
  }, {
    name: 'the-library-near',
    prepare: async ({ page, settle }) => { await faceAt(page, settle, library, near); },
    measure: async ({ page }) => (results.library = await names(page)),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify({ zoom: results.zoom, total: results.total, library: results.library }, null, 1));
