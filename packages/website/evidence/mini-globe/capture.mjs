// The mini globe on the website's small example: the finished shop in free play as it arrives, after a spin,
// and after the Home key, on whatever build is in ../../dist:
//   WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
//   node --import tsx packages/website/evidence/mini-globe/capture.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist');
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
  await page.addInitScript(() => { localStorage.setItem('storytree-opening-seen', 'yes'); });
  /** The mini globe's facing mark, in its own 120-unit box, and whether it is on the far side. */
  const mark = () => page.evaluate(() => {
    const ring = document.querySelector('.planet-mini-globe .mini-globe-facing circle');
    return ring && { x: +(+ring.getAttribute('cx')).toFixed(1), y: +(+ring.getAttribute('cy')).toFixed(1), behind: ring.parentElement.classList.contains('behind') };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
  await page.getByRole('button', { name: /free play/i }).first().click();
  await page.waitForFunction(() => document.querySelector('.forest-drawing')?.dataset.growth === 'whole', null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(here, 'free-play.png') });
  const arrived = await mark();
  const canvas = await page.locator('.forest-drawing canvas').first().boundingBox();
  const middle = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await page.mouse.move(middle.x, middle.y); await page.mouse.down();
  await page.mouse.move(middle.x + canvas.height * 0.3, middle.y + canvas.height * 0.15, { steps: 24 }); await page.mouse.up();
  await page.mouse.move(2, 2); await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(here, 'free-play-turned.png') });
  const turned = await mark();
  await page.keyboard.press('Home'); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(here, 'free-play-home.png') });
  const home = await mark();
  assert.ok(arrived && turned && home, 'the mini globe shows in free play');
  assert.notDeepEqual(turned, home, 'the mark follows the turn');
  assert.deepEqual(errors, []);
  const result = { build: (await readFile(path.join(dist, 'version.txt'), 'utf8')).trim(), viewport: '1440 x 900, SwiftShader', arrived, turned, home };
  await writeFile(path.join(here, 'measurements.json'), JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
