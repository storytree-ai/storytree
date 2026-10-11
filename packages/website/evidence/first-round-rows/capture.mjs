// The shop's first four islands in rows (question_9073ebdfd19e, option A), on whatever build is in the directory given:
// the map chapter's stories-and-pathways step and its health step, each at its end, then the move to free play's whole
// shop, with each island's middle on the page and the move's frame times.
//   WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
//   node packages/website/evidence/first-round-rows/capture.mjs <dist> <before|after>
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dist, label] = [path.resolve(process.argv[2] ?? path.resolve(here, '../../dist')), process.argv[3]];
assert.ok(['before', 'after'].includes(label), 'pass before or after');
const titles = JSON.parse(await readFile(path.resolve(here, '../../src/shop-snapshot.json'), 'utf8')).titles;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(dist + path.sep)) return res.writeHead(403).end();
  try { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const record = { build: (await readFile(path.join(dist, 'version.txt'), 'utf8')).trim(), renderer: 'SwiftShader', sizes: {} };
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('storytree-opening-seen', 'yes');
      window.__storytreeCaptureGlobe = get => { window.__rowsGlobe = get; };
    });
    const drawing = () => page.locator('.forest-drawing');
    const go = async id => { await page.locator(`#tour-pips [data-step="${id}"]`).click(); };
    const press = async wanted => { if (await page.locator('#tour-play').getAttribute('aria-label') === wanted) await page.locator('#tour-play').click(); };
    /** Each island's middle on the page, north to south. */
    const islands = () => page.evaluate(titles => {
      const { scene, camera, gl } = window.__rowsGlobe(), box = gl.domElement.getBoundingClientRect(), V = camera.position.constructor;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld();
      return Object.entries(titles).flatMap(([id, title]) => {
        const object = scene.getObjectByName(`planet:${id}`);
        if (!object) return [];
        const ndc = object.getWorldPosition(new V()).project(camera);
        return [{ title, x: Math.round(box.left + (ndc.x + 1) * box.width / 2), y: Math.round(box.top + (1 - ndc.y) * box.height / 2) }];
      }).sort((a, b) => a.y - b.y);
    }, titles);
    /** Plays `id` until its growth stops moving, then pauses there. */
    const toEnd = async id => {
      await go(id); await press('Play the tour');
      let last = '', still = 0;
      for (let tries = 0; tries < 240 && still < 4; tries++) {
        await page.waitForTimeout(250);
        const now = await drawing().getAttribute('data-growth');
        still = now === last && now !== '0.00' ? still + 1 : 0; last = now;
      }
      await press('Pause the tour'); await page.waitForTimeout(2600);
    };
    const shot = name => page.screenshot({ path: path.join(here, `${label}-${width}-${name}.png`) });
    const open = async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__rowsGlobe && document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
      await go('map-stories'); await press('Pause the tour');
      await page.waitForFunction(() => document.querySelector('.forest-drawing')?.dataset.globe === 'shop' && document.querySelector('.forest-drawing')?.dataset.arrived === 'true', null, { timeout: 60_000 });
    };
    await open();
    await toEnd('map-stories'); await shot('pathways'); const pathways = await islands();
    await toEnd('map-health'); await shot('health'); const health = await islands();
    // A picture of the move itself, part way across, then the whole shop once it settles.
    await page.getByRole('button', { name: /free play/i }).first().click();
    await page.waitForTimeout(700); await shot('move');
    await page.waitForFunction(() => document.querySelector('.forest-drawing')?.dataset.growth === 'whole', null, { timeout: 60_000 });
    await page.waitForTimeout(3000); await shot('free-play'); const freePlay = await islands();
    await open(); await toEnd('map-health');
    // Free play from the health step: the shop's globe stays on screen, so the four move once to the finished shop's places.
    // Sampled in the page each frame for 2.4 s, with no screenshot to stall it: frame times and the four's middles.
    await page.evaluate(titles => {
      const four = Object.entries(titles).filter(([, title]) => ['Signing in', 'Browsing', 'Cart', 'Checkout'].includes(title));
      window.__samples = []; const start = performance.now(); let last = start;
      const tick = now => {
        const { scene, camera, gl } = window.__rowsGlobe(), box = gl.domElement.getBoundingClientRect(), V = camera.position.constructor;
        scene.updateMatrixWorld(true); camera.updateMatrixWorld();
        // Where each island sits on the globe, so the camera's own flight does not count as a move.
        const at = Object.fromEntries(four.flatMap(([id, title]) => { const object = scene.getObjectByName(`planet:${id}`), globe = scene.getObjectByName('globe');
          if (!object || !globe) return []; const local = globe.worldToLocal(object.getWorldPosition(new V())).normalize();
          return [[title, [+local.x.toFixed(3), +local.y.toFixed(3), +local.z.toFixed(3)]]]; }));
        window.__samples.push({ t: Math.round(now - start), frame: +(now - last).toFixed(1), at }); last = now;
        if (now - start < 2400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, titles);
    await page.getByRole('button', { name: /free play/i }).first().click();
    await page.waitForFunction(() => window.__samples.at(-1)?.t >= 2400, null, { timeout: 60_000 });
    const samples = await page.evaluate(() => window.__samples);
    const moving = samples.filter((sample, index) => index > 0 && JSON.stringify(sample.at) !== JSON.stringify(samples[index - 1].at));
    const frames = samples.slice(1).map(sample => sample.frame);
    assert.deepEqual(errors, []);
    record.sizes[`${width} x ${height}`] = { pathways, health, freePlay,
      move: { framesMoving: moving.length, from: moving[0]?.t, to: moving.at(-1)?.t, first: samples[0].at, last: samples.at(-1).at },
      frames: { count: frames.length, medianMs: frames.toSorted((a, b) => a - b)[frames.length >> 1], worstMs: Math.max(...frames), over50ms: frames.filter(frame => frame > 50).length } };
    await page.close();
  }
  await writeFile(path.join(here, `${label}.json`), JSON.stringify(record, null, 1) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(record.sizes).map(([size, { pathways, health, move, frames }]) => [size, { pathways, health, move, frames }]))));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
