import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'chart-lanes');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[chart lanes +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 180_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 200 }); };
const library = seed.tree.stories.find(story => story.title === 'The library').id;
const sea = page => page.evaluate(() => {
  const rest = window.__globe.scene.getObjectByName('pathways:rest-lanes'), dots = rest?.getObjectByName('lane-dots');
  const lit = window.__globe.scene.getObjectByName('pathways:selection-lanes')?.userData.lanes ?? [];
  return { stretches: rest?.userData.stretches ?? 0, dots: rest?.userData.dots ?? 0,
    opacity: Number((dots?.material.uniforms.uOpacity.value ?? 0).toFixed(3)), lit: lit.length };
});
const results = {};

const prepare = async ({ page, settle }) => {
  await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
  for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await settle(page);
};
const still = async ({ page, settle }) => { await until(page, 'the globe still', () => window.storytreeGlobe.still()); await settle(page, 12); };
const selectLibrary = async ({ page, settle }) => {
  const island = await page.evaluate(story => window.storytreeGlobe.islands().find(i => i.story === story), library);
  await page.mouse.click(island.x, island.y);
  await until(page, 'The library selected, its lanes lit', story => document.body.dataset.selected === story
    && (window.__globe.scene.getObjectByName('pathways:selection-lanes')?.userData.lanes.length ?? 0) > 0, library);
  await until(page, 'the globe still', () => window.storytreeGlobe.still());
  await page.evaluate(() => {
    const panel = [...document.querySelectorAll('h1, h2, h3')].find(h => h.textContent.trim() === 'The library')?.closest('aside, section, [role="dialog"], div[class*="panel"]');
    if (panel) panel.style.visibility = 'hidden';
    const rail = [...document.querySelectorAll('[role="tab"], button')].find(b => b.textContent.trim() === 'Sessions')?.closest('aside, nav, div[class*="rail"]');
    if (rail) rail.style.visibility = 'hidden';
  });
  await settle(page, 12);
};

await runCapture({
  folder: pictures, dist, seed, survey, prepare,
  views: [{
    name: 'at-rest', prepare: still,
    measure: async ({ page }) => (results.rest = await sea(page)),
    expect: found => assert.ok(found.stretches > 0 && found.dots > found.stretches && found.lit === 0 && found.opacity === 0.75, 'at rest every lane is dotted, none filled'),
  }, {
    name: 'the-library-selected', prepare: selectLibrary,
    measure: async ({ page }) => (results.library = await sea(page)),
    expect: found => assert.ok(found.lit > 0 && found.stretches === results.rest.stretches && found.opacity < 0.75, 'The library fills its lanes over the dots, dimmed'),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
