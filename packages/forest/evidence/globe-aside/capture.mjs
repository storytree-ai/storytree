// Forest 3.40: the globe moves into the free width left of the story panel, in real Chromium, wide and narrow.
// Run from the checkout: node --import tsx packages/forest/evidence/globe-aside/capture.mjs [--before]
// --before builds the page with the panel's width withheld from the globe, as main drew it before 3.40.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from './build.mjs';
import { withCapture, settle } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const before = process.argv.includes('--before');
try {
  await buildPage(out, { before });

  const results = {};
  await withCapture({ folder: here, dist: out }, async ({ browser, origin }) => {
    for (const [name, viewport] of [['wide', { width: 1600, height: 900 }], ['narrow', { width: 1000, height: 820 }]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(origin);
      await page.evaluate(() => window.proof.open());
      await page.waitForFunction(() => window.proof.ready(), null, { timeout: 60_000 });
      await settle(page, 8);
      const closed = await page.evaluate(() => window.proof.globe());
      if (!before) await page.screenshot({ path: path.join(here, `${name}-closed.png`) });
      await page.evaluate(story => window.proof.select(story), await page.evaluate(() => window.proof.stories[0]));
      await page.waitForSelector('#content > .story-panel:not([hidden])');
      // The software-drawn page draws a frame in about 140 ms: wait for the glide to end rather than a fixed time.
      if (!before) await page.waitForFunction(() => Math.abs(window.proof.globe().centre - document.querySelector('.story-panel').getBoundingClientRect().left / 2) < 1, null, { timeout: 20_000 });
      else await page.waitForTimeout(3000);
      await settle(page, 8);
      const open = await page.evaluate(() => window.proof.globe());
      const box = await page.locator('.story-panel').boundingBox();
      await page.screenshot({ path: path.join(here, `${name}-open${before ? '-before' : ''}.png`) });
      // Marks drawn over the canvas follow the moved globe: a pointed territory's name sits by the pointer, and the
      // mini globe stays clear of the panel.
      const plate = await page.locator('.planet-nameplate.selected').boundingBox();
      // Hovering is picked once a frame: step up from the selected island's name until the land under the pointer is named.
      let pointer, tip;
      for (let up = 20; up <= 200 && tip === undefined; up += 15) {
        pointer = { x: plate.x + plate.width / 2, y: plate.y - up };
        await page.mouse.move(pointer.x - 2, pointer.y - 1);
        await page.mouse.move(pointer.x, pointer.y);
        tip = await page.waitForSelector('[role="tooltip"]', { state: 'attached', timeout: 1500 }).then(node => node.boundingBox(), () => undefined);
      }
      assert.ok(tip !== undefined, `${name}: some land above the selected island names itself`);
      const mini = await page.locator('.planet-mini-globe').boundingBox();
      Object.assign(results[name] ??= {}, { tooltipFromPointer: Math.round(tip.x - pointer.x), miniGlobeRight: Math.round(mini.x + mini.width) });
      if (!before) {
        assert.ok(Math.abs(tip.x - pointer.x - 12) < 2, `${name}: the tooltip sits by the pointer (${tip.x} vs ${pointer.x})`);
        assert.ok(mini.x + mini.width <= box.x, `${name}: the mini globe keeps left of the panel`);
      }
      await page.mouse.move(1, viewport.height - 1);
      const free = box.x;
      Object.assign(results[name], { closed, open, panelLeft: Math.round(box.x) });
      if (!before) {
        assert.ok(Math.abs(open.centre - free / 2) < 1, `${name}: the globe's centre sits mid-way across the free width (${open.centre} vs ${free / 2})`);
        if (name === 'wide') assert.equal(open.zoom, closed.zoom, 'wide: no zoom');
        else assert.ok(open.zoom < closed.zoom, 'narrow: zoomed out to fit');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#content > .story-panel[hidden]', { state: 'attached' });
        await page.waitForFunction(centre => window.proof.globe().centre === centre, closed.centre, { timeout: 20_000 });
        await settle(page, 8);
        const back = await page.evaluate(() => window.proof.globe());
        assert.equal(back.centre, closed.centre, `${name}: closing returns it to the centre`);
        assert.ok(Math.abs(back.zoom - closed.zoom) < 1e-6, `${name}: and to its zoom`);
        results[name].back = back;
      }
      assert.deepEqual(errors, [], `${name}: no page errors`);
      await page.close();
    }
  });
  console.log(JSON.stringify(results, null, 2));
} finally {
  rmSync(out, { recursive: true, force: true });
}
