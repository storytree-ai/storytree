// Forest 3.40: the globe moves into the free width left of the story panel, in real Chromium, wide and narrow.
// Run from the checkout: node --import tsx packages/forest/evidence/globe-aside/capture.mjs [--before]
// --before builds the page with the panel's width withheld from the globe, as main drew it before 3.40.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';
import { withCapture, settle } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '../..');
const out = path.join(here, 'out');
const before = process.argv.includes('--before');
const codeRows = path.join(pkgDir, 'src/view/evidence/code-rows');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(codeRows, 'seed.json.gz'))));
const survey = JSON.parse(readFileSync(path.join(codeRows, 'survey.json')));

mkdirSync(out, { recursive: true });
try {
  await build({
    entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'), bundle: true,
    format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2023', loader: { '.glb': 'binary' }, logLevel: 'warning',
    define: { __SEED__: JSON.stringify(seed), __SURVEY__: JSON.stringify(survey), 'process.env.NODE_ENV': '"production"' },
    plugins: before ? [{ name: 'before', setup(builder) {
      builder.onLoad({ filter: /forest-view\.tsx$/ }, ({ path: file }) => {
        const source = readFileSync(file, 'utf8'), changed = source.replace('aside={drawn.aside}', 'aside={0}');
        assert.notEqual(changed, source, 'the before build withholds the measured width');
        return { contents: changed, loader: 'tsx' };
      });
    } }] : [],
  });
  stop();
  writeFileSync(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css">
<style>html,body{margin:0;width:100%;height:100%;background:#101418;color:#e7edf0;font:14px system-ui}#content{position:absolute;inset:0}#globe{position:absolute;inset:0}</style>
</head><body><div id="content" class="forest-workspace" data-theme="dark"><div id="globe"></div><aside class="story-panel" hidden></aside></div><script src="/bundle.js"></script></body></html>`);

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
