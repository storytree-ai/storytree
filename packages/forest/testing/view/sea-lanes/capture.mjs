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
const measure = page => page.evaluate(() => {
  const lanes = window.__globe.scene.getObjectByName('pathways:selection-lanes')?.userData.lanes ?? [];
  const lengths = lanes.map(lane => lane.length);
  return { lanes: lanes.length, longest: Math.round(Math.max(0, ...lengths)), total: Math.round(lengths.reduce((a, b) => a + b, 0)) };
});
const atRest = page => page.evaluate(() => {
  const group = window.__globe.scene.getObjectByName('globe-lanes');
  let meshes = 0;
  group?.traverse(object => { if (object.isMesh && object.name !== 'lane-dots') meshes++; });
  let roads = 0;
  window.__globe.scene.traverse(object => { if (object.name.startsWith('pathway:')) roads++; });
  return { lanes: group?.getObjectByName('pathways:selection-lanes')?.userData.lanes.length ?? 0, meshes, roads };
});
const results = {};

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
const prepare = async ({ page, settle }) => {
  await until(page, 'the ready map', () => document.body.dataset.state === 'ready');
  for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await settle(page);
};
const still = async ({ page, settle }) => { await until(page, 'the globe still', () => window.storytreeGlobe.still()); await settle(page, 12); };

await runCapture({
  folder: pictures, dist, seed, survey, prepare,
  views: [{
    name: 'at-rest', prepare: still,
    measure: async ({ page }) => (results.rest = await atRest(page)),
    expect: found => assert.deepEqual(found, { lanes: 0, meshes: 0, roads: 0 }, 'at rest no lane is lit and no road is drawn between islands'),
  }, {
    name: 'the-library-selected', prepare: selectLibrary,
    measure: async ({ page }) => (results.library = await measure(page)),
    expect: found => assert.ok(found.lanes > 0, 'The library lights its lanes'),
  }],
});

const story = title => seed.tree.stories.find(one => one.title === title).id;
const plumbed = { ...survey, [library]: { ...survey[library], edges: [...survey[library].edges ?? [],
  { story: story('The command line'), typeOnly: false, files: [{ from: 'src/build-step.ts', typeOnly: false, plumbing: 'build step' }] },
  { story: story('The app'), typeOnly: false, files: [{ from: 'src/cleanup.ts', typeOnly: false, plumbing: 'cleanup' }] }] } };
const plumbing = (page, ends) => page.evaluate(ends => {
  const group = window.__globe.scene.getObjectByName('pathways:selection-lanes');
  const lit = (group?.userData.lanes ?? []).map(lane => `${lane.from}->${lane.to}`);
  const colours = new Set(), others = [];
  group?.traverse(object => { if (!object.isMesh) return; if (!object.name.startsWith('lane:')) others.push(object.name); colours.add(object.material.uniforms.uColour.value.getHexString()); });
  return { lanes: ends.filter(end => lit.includes(end)), others, colours: colours.size };
}, ends);
const plumbingEnds = [`${library}->${story('The command line')}`, `${library}->${story('The app')}`];
await runCapture({
  folder: pictures, dist, seed, survey: plumbed, prepare,
  views: [{
    name: 'plumbing-at-rest', prepare: still,
    measure: async ({ page }) => (results.plumbingRest = await plumbing(page, plumbingEnds)),
    expect: found => assert.deepEqual(found, { lanes: [], others: [], colours: 0 }, 'at rest the sea carries no line'),
  }, {
    name: 'plumbing-the-library-selected', prepare: selectLibrary,
    measure: async ({ page }) => (results.plumbing = { ...await plumbing(page, plumbingEnds), labels: await page.evaluate(() => document.querySelectorAll('[data-plumbing]').length) }),
    expect: found => assert.deepEqual(found, { lanes: plumbingEnds, others: [], colours: 1, labels: 0 }, 'The library lights its two plumbing calls as lanes like the rest, one colour, no label'),
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
