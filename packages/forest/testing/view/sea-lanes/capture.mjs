// Sea lanes routed on their own (ADR-1261 D3-D4, 4.8, 4.41, 4.42): storytree's own map (the code-rows snapshot and its
// survey) as the app opens it, with The library's island clicked so every lane of its capability links is lit, drawn on
// and settled. `node --import tsx capture.mjs` (append --retake to write into src/view/evidence/sea-lanes). Measures, from
// the scene, the lanes lit and how long they run, so the before and after pictures can be compared by numbers too.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'sea-lanes');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[sea lanes +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const library = seed.tree.stories.find(story => story.title === 'The library').id;
/** The lit lanes as the scene draws them: how many, and their lengths. */
const measure = page => page.evaluate(() => {
  const lanes = window.__globe.scene.getObjectByName('pathways:selection-lanes')?.userData.lanes ?? [];
  const lengths = lanes.map(lane => lane.length);
  return { lanes: lanes.length, longest: Math.round(Math.max(0, ...lengths)), total: Math.round(lengths.reduce((a, b) => a + b, 0)) };
});
const results = {};

await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await settle(page);
  },
  views: [{
    name: 'the-library-selected',
    prepare: async ({ page, settle }) => {
      const island = await page.evaluate(story => window.storytreeGlobe.islands().find(i => i.story === story), library);
      await page.mouse.click(island.x, island.y);
      await until(page, 'The library selected, its lanes lit', story => document.body.dataset.selected === story
        && (window.__globe.scene.getObjectByName('pathways:selection-lanes')?.userData.lanes.length ?? 0) > 0, library);
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      // The story panel and the left rail stand over the sea the lanes cross: hidden for the picture, the selection kept.
      await page.evaluate(() => {
        const panel = [...document.querySelectorAll('h1, h2, h3')].find(h => h.textContent.trim() === 'The library')?.closest('aside, section, [role="dialog"], div[class*="panel"]');
        if (panel) panel.style.visibility = 'hidden';
        const rail = [...document.querySelectorAll('[role="tab"], button')].find(b => b.textContent.trim() === 'Sessions')?.closest('aside, nav, div[class*="rail"]');
        if (rail) rail.style.visibility = 'hidden';
      });
      await settle(page, 12);
    },
    measure: async ({ page }) => (results.library = await measure(page)),
    expect: found => assert.ok(found.lanes > 0, 'The library lights its lanes'),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
