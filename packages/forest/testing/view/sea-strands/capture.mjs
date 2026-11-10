// Sea lanes at rest as fine dots of one size on gentle curves, a busy stretch as strands side by side (4.44): storytree's
// own map (the code-rows snapshot and its survey) as the app opens it, nothing selected, first near The knowledge core, where trunks merge, at about
// the zoom of the owner's screenshot (the islands' own detail shown, a few islands across), the sidebar hidden, then with The knowledge core selected, its share filled over the strands, then at the
// whole map's opening zoom, where every lane size scales up together (`laneScale`). `node --import tsx capture.mjs`
// (append --retake to write into src/view/evidence/sea-strands). Measures, from the scene, the stretches, their strands
// and dots, so the pictures can be compared by numbers too.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'sea-strands');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const started = performance.now();
const phase = message => console.error(`[sea strands +${Math.round(performance.now() - started)}ms] ${message}`);
const until = async (page, what, predicate, arg, timeout = 300_000) => { phase(`wait for ${what}`); await page.waitForFunction(predicate, arg, { timeout, polling: 250 }); };
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const centre = seed.tree.stories.find(story => story.title === 'The knowledge core').id;
/** The zoom (CSS pixels per ground unit) the owner's screenshot was at, about: four islands across the view. */
const NEAR = Number(process.env.SEA_STRANDS_ZOOM ?? 2.2);

/** The sea at rest as the scene draws it: the stretches, strands and dots, and how big the dots are. */
const sea = page => page.evaluate(({ radius, fov }) => {
  const { camera, size, scene } = window.__globe;
  const rest = scene.getObjectByName('pathways:rest-lanes'), dots = rest?.getObjectByName('lane-dots');
  const sizes = dots ? [...new Set(Array.from(dots.geometry.getAttribute('size').array, v => Number(v.toFixed(4))))] : [];
  const lit = scene.getObjectByName('pathways:selection-lanes')?.userData.lanes ?? [];
  return { zoom: Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / (camera.position.length() - radius),
    stretches: rest?.userData.stretches ?? 0, strands: rest?.userData.strands ?? 0, dots: rest?.userData.dots ?? 0,
    dotSizes: sizes, scale: dots?.material.uniforms.uScale.value ?? 0, lit: lit.length };
}, eye);
const zoomTo = async (page, settle, zoom) => {
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom, ...eye });
  await settle(page, 12);
};
const results = {};

await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle }) => {
    await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.keyboard.press('Control+B');
    await until(page, 'the lanes at rest', () => (window.__globe.scene.getObjectByName('pathways:rest-lanes')?.userData.dots ?? 0) > 0);
    await settle(page);
    results.opening = await sea(page);
  },
  views: [{
    name: 'near-the-knowledge-core',
    prepare: async ({ page, settle }) => {
      if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), centre)) throw new Error('no camera stop for The knowledge core');
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await zoomTo(page, settle, NEAR);
    },
    measure: async ({ page }) => (results.near = await sea(page)),
    expect: found => assert.ok(found.dots > found.stretches && found.lit === 0, 'near, every lane at rest is dotted, none lit'),
  }, {
    name: 'the-knowledge-core-selected',
    prepare: async ({ page, settle }) => {
      const island = await page.evaluate(story => window.storytreeGlobe.islands().find(i => i.story === story), centre);
      await page.mouse.click(island.x, island.y);
      await until(page, 'The knowledge core selected, its lanes lit', story => document.body.dataset.selected === story
        && (window.__globe.scene.getObjectByName('pathways:selection-lanes')?.userData.lanes.length ?? 0) > 0, centre);
      await until(page, 'the globe still', () => window.storytreeGlobe.still());
      await page.evaluate(() => {
        const panel = [...document.querySelectorAll('h1, h2, h3')].find(h => h.textContent.trim() === 'The knowledge core')?.closest('aside, section, [role="dialog"], div[class*="panel"]');
        if (panel) panel.style.visibility = 'hidden';
      });
      await settle(page, 12);
    },
    measure: async ({ page }) => (results.selected = await sea(page)),
    expect: found => assert.ok(found.lit > 0 && found.strands === results.near.strands, 'its share filled over the strands'),
  }, {
    name: 'zoomed-out',
    prepare: async ({ page, settle }) => {
      await page.keyboard.press('Escape');
      await zoomTo(page, settle, results.opening.zoom);
    },
    measure: async ({ page }) => (results.out = await sea(page)),
    expect: found => assert.ok(found.dots > found.stretches && found.scale > 1, 'zoomed out, the lanes are scaled up together'),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
