// The unchanged website's step 3 consuming world 6.17. Build and evidence stay inside the engine's lane.
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWebsite } from '../../../website/src/build.ts';
import { withCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'site-out');
try {
  await buildWebsite(dist);
  await withCapture({ folder: path.join(here, 'reveal'), dist }, async ({ browser, origin, out }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem('storytree-opening-seen', 'yes');
      window.roadFrames = [];
      window.__storytreeCaptureGlobe = get => {
        window.getGlobe = get;
        const gl = get().gl, render = gl.render;
        gl.render = function (...args) {
          if (window.roadStopped) return;
          const result = render.apply(this, args);
          const state = get();
          if (!window.takeRoadFrames || !state.scene.getObjectByName('globe-roads')?.visible) return result;
          const roads = [];
          state.scene.traverse(node => {
            if (node.name.startsWith('pathway:')) {
              const g = node.geometry, reveal = g.userData.pathwayReveal;
              roads.push({ name: node.name, links: node.userData.links,
                progress: reveal?.progress ?? Math.min(1, g.drawRange.count / g.index.count),
                length: reveal?.totalLength ?? 0 });
            }
          });
          if (roads.length === 0) return result;
          const total = roads.reduce((sum, road) => sum + road.length, 0);
          const progress = roads.reduce((sum, road) => sum + road.progress * road.length, 0) / total;
          window.roadFrames.push({ at: performance.now(), progress, roads });
          if (progress >= window.stopAt) {
            state.setFrameloop('never');
            window.roadStopped = true;
          }
          return result;
        };
      };
    });
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
    await page.locator('#tour-pips [data-step="map-together"]').click();
    await page.waitForFunction(() => document.querySelector('.forest-drawing')?.dataset.globe === 'shop'
      && !window.getGlobe().scene.getObjectByName('globe-roads')?.visible, null, { timeout: 30_000 });
    await page.evaluate(() => { window.stopAt = 0; window.takeRoadFrames = true; });
    const pictures = [];
    for (const [name, threshold] of [['start', 0], ['quarter', 0.25], ['half', 0.5], ['complete', 1 - 1e-8]]) {
      if (threshold > 0) await page.evaluate(threshold => {
        window.stopAt = threshold; window.roadStopped = false;
        const state = window.getGlobe(); state.setFrameloop('demand'); state.invalidate();
      }, threshold);
      await page.waitForFunction(() => window.roadStopped, null, { timeout: 60_000, polling: 50 });
      await page.screenshot({ path: path.join(out, `1440-step3-${name}.png`) });
      pictures.push({ name, frame: await page.evaluate(() => window.roadFrames.at(-1)) });
    }
    assert.equal(pictures[0].frame.progress, 0, 'step 3 starts with undrawn pathways');
    assert.ok(pictures[1].frame.progress > 0 && pictures[1].frame.progress < 0.5);
    assert.ok(pictures[2].frame.progress >= 0.5 && pictures[2].frame.progress < 1);
    assert.ok(pictures[3].frame.roads.every(road => road.progress === 1));
    assert.equal(await page.locator('#chapter2').getAttribute('data-tour-step'), 'map-together');
    assert.deepEqual(errors, []);
    writeFileSync(path.join(out, 'website-measurements.json'), JSON.stringify({ capturedAt: new Date().toISOString(),
      note: 'Unchanged website, local engine changes; demand frames held at four measured fronts for pictures. Not a wall-time benchmark.', pictures }, null, 2) + '\n');
    await page.close();
    console.log(JSON.stringify({ passed: true, pictures: pictures.map(({ name, frame }) => ({ name, progress: frame.progress })), output: out }));
  });
} finally { rmSync(dist, { recursive: true, force: true }); }
