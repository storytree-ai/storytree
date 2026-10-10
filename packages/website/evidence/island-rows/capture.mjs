// The map chapter's pathways step at the moment its four islands are whole, and the finished shop in free play,
// on whatever build is in ../../dist. Run once on main for `pinned-*`, and once with README.md's scratch patch for `rows-*`:
//   WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
//   node --import tsx packages/website/evidence/island-rows/capture.mjs <pinned|rows>
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { mapRecording, mapGrowthPlan } from '../../src/map-recording.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert.ok(['pinned', 'rows'].includes(label), 'pass pinned or rows');
const dist = path.resolve(here, '../../dist');
const saved = JSON.parse(await readFile(path.resolve(here, '../../src/shop-snapshot.json'), 'utf8'));
const end = mapGrowthPlan(mapRecording(saved)).stages.find(stage => stage.id === 'pr4').start;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(dist + path.sep)) return res.writeHead(403).end();
  try { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('storytree-opening-seen', 'yes');
    window.__storytreeCaptureGlobe = get => { window.__rowsGlobe = get; };
  });
  const go = id => page.locator(`#tour-pips [data-step="${id}"]`).click();
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
  }, saved.titles);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__rowsGlobe && document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
  await go('map-first'); await press('Pause the tour');
  await page.waitForFunction(() => document.querySelector('.forest-drawing')?.dataset.globe === 'shop' && document.querySelector('.forest-drawing')?.dataset.arrived === 'true');
  await go('map-together'); await press('Play the tour');
  await page.waitForFunction(at => Number(document.querySelector('.forest-drawing')?.dataset.growth) >= at, end - .01, { timeout: 60_000 });
  await press('Pause the tour'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(here, `${label}-pathways-step.png`) });
  const four = await islands();
  await page.getByRole('button', { name: /free play/i }).first().click();
  await page.waitForFunction(() => document.querySelector('.forest-drawing')?.dataset.growth === 'whole' && Number(document.querySelector('.forest-drawing')?.dataset.islands) === 8, null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(here, `${label}-finished-shop.png`) });
  const eight = await islands();
  assert.deepEqual(errors, []);
  await writeFile(path.join(here, `${label}.json`), JSON.stringify({ build: (await readFile(path.join(dist, 'version.txt'), 'utf8')).trim(), viewport: '1440 x 900, SwiftShader', pathwaysStep: four, finishedShop: eight }, null, 1) + '\n');
  console.log(label, JSON.stringify(four), JSON.stringify(eight));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
