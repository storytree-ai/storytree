// The website's globe mounts the same story names (contract 3.31: the small-globe rule). At 390 x 844 and 1440 x 900, the cut to
// the shop's three teaching islands (the start-small step, where 3.31 was seen) and free play: a picture of each, and every story
// name shown or faded, with the overlapping pairs among the shown.
// `pnpm --filter @storytree/website build` in a checkout, then `node --import tsx website.mjs <that checkout's packages/website/dist> before|after`.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dist, label] = process.argv.slice(2);
assert.ok(dist && ['before', 'after'].includes(label), 'pass the website dist and a before/after label');

const names = page => page.evaluate(() => {
  const list = [...document.querySelectorAll('#website-forest .planet-nameplate[data-story-id]')].map(el => {
    const r = el.getBoundingClientRect(), wrapper = el.closest('div[style*="position: absolute"]') ?? el;
    const onScreen = el.style.visibility !== 'hidden' && r.width > 0 && getComputedStyle(wrapper).display !== 'none';
    return { title: el.querySelector('.planet-nameplate-title')?.textContent ?? el.textContent, onScreen, shown: onScreen && !el.classList.contains('crowded'),
      box: [r.left, r.top, r.right, r.bottom].map(Math.round) };
  }).filter(name => name.onScreen);
  const shown = list.filter(name => name.shown), slack = 4;
  const overlaps = shown.flatMap((a, i) => shown.slice(i + 1).filter(b => a.box[0] + slack < b.box[2] && b.box[0] + slack < a.box[2] && a.box[1] + slack < b.box[3] && b.box[1] + slack < a.box[3]).map(b => [a.title, b.title]));
  return { shown: `${shown.length} of ${list.length} facing the eye`, faded: list.filter(name => !name.shown).map(name => name.title), overlaps, list };
});

const measured = {};
await withCapture({ folder: here, dist: path.resolve(dist) }, async ({ browser, origin, out }) => {
  for (const [tag, viewport] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.addInitScript(() => localStorage.setItem('storytree-opening-seen', 'yes'));
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
    await page.locator('#tour-pips [data-step="start-small"]').click();
    if (await page.locator('#tour-play').getAttribute('aria-label') === 'Play the tour') await page.locator('#tour-play').click();
    await page.waitForFunction(() => document.querySelector('.forest-drawing')?.dataset.globe === 'shop' && document.querySelector('.forest-drawing')?.dataset.arrived === 'true', null, { timeout: 30_000 });
    await page.waitForTimeout(6000);
    if (await page.locator('#tour-play').getAttribute('aria-label') === 'Pause the tour') await page.locator('#tour-play').click();
    await page.waitForTimeout(600);
    measured[`${tag}-cut`] = await names(page);
    await page.screenshot({ path: path.join(out, `website-${label}-${tag}-cut.png`) });
    await page.locator('#tour-skip').click();
    await page.waitForTimeout(5000);
    measured[`${tag}-freeplay`] = await names(page);
    await page.screenshot({ path: path.join(out, `website-${label}-${tag}-freeplay.png`) });
    await page.close();
  }
  writeFileSync(path.join(out, `website-measurements-${label}.json`), JSON.stringify(measured, null, 1) + '\n');
});
for (const [scene, { shown, faded, overlaps }] of Object.entries(measured)) console.log(label, scene, shown, 'faded or hidden:', JSON.stringify(faded), 'overlapping pairs', overlaps.length);
