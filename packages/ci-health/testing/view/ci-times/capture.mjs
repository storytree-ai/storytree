// The map's bottom-left CI times strip (capability 6, stage 1 of question_177bdb4c1e2a's display): the real desktop page on
// storytree's own map (the code-rows snapshot and its survey), its bridge answering a CI times reading shaped like storytree's own on 2026-11-10 (to merge 42 min
// this week against 35 the week before, Windows bounding 16-minute runs, 28% queue reds). The whole window with the rail beside
// the map; the same with the rail collapsed, where the strip follows the map's edge; and the strip close up.
// `node --import tsx capture.mjs` (append --retake to write into src/ci-times/evidence). Measures the strip's box and its figures.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(here, '../../../src/ci-times/evidence');
// Where this run writes: the evidence folder under --retake, else a scratch folder; runCapture picks the same one.
const folder = captureOutput(evidence);
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const reading = {
  repository: 'storytree-ai/storytree',
  readAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  toMerge: { median: 42, was: 34.6, merged: 157, days: [36, 33, 35, 34, 38, 36, 37, 41, 44, 39, 51, 42, 48, 42] },
  run: { median: 16.2, bound: 'win32', runs: 237 },
  queue: { reds: 43, runs: 152 },
  now: { inCi: 2, inQueue: 1 },
};

const strip = page => page.evaluate(() => {
  const element = document.querySelector('.ci-times');
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { hidden: element.hidden, box: { left, top, right, bottom }, window: { width: innerWidth, height: innerHeight }, lines: [...element.querySelectorAll('.ci-times-item')].map(line => line.textContent) };
});
const inCorner = found => {
  assert.equal(found.hidden, false);
  assert.deepEqual(found.lines.length, 4, 'four figures');
  assert.ok(found.box.top >= found.window.height - 45, `in the band the map opens with clear below its south edge: ${JSON.stringify(found)}`);
};

await runCapture({
  folder: evidence, dist, seed, survey,
  answers: { ciTimes: async () => reading },
  prepare: async ({ page, settle }) => {
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180_000 });
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.waitForFunction(() => document.querySelector('.ci-times:not([hidden])') !== null, undefined, { timeout: 30_000 });
    await settle(page, 60);
  },
  views: [{
    name: 'map-with-ci-times',
    measure: async ({ page }) => strip(page),
    expect: found => {
      inCorner(found);
      assert.ok(found.box.left > 100, `beside the rail, not under it: ${JSON.stringify(found)}`);
    },
  }, {
    name: 'ci-times-close',
    picture: false,
    measure: async ({ page }) => {
      await page.locator('.ci-times').screenshot({ path: path.join(folder, 'ci-times-close.png') });
      return strip(page);
    },
    measurement: 'ci-times-close',
  }, {
    name: 'map-with-ci-times-rail-collapsed',
    prepare: async ({ page, settle }) => {
      await page.evaluate(() => document.querySelector('main').style.setProperty('--rail-width', '0px'));
      await page.evaluate(() => { const rail = document.querySelector('.side-rail'); if (rail) rail.hidden = true; });
      await settle(page, 6);
    },
    measure: async ({ page }) => strip(page),
    expect: found => { inCorner(found); assert.ok(found.box.left <= 16, 'at the map\'s left edge'); },
  }],
});
