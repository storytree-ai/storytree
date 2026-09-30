// Contract 2.2/2.3 browser proof. Build the website first; this only serves its output.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(dist, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
  if (!file.startsWith(dist + path.sep)) return res.writeHead(403).end();
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const url = `http://127.0.0.1:${server.address().port}/`;
  // A below-the-fold map must not fetch React/Three while a visitor reads the opening text.
  const offscreen = await browser.newPage({ viewport: { width: 1440, height: 400 } });
  await offscreen.goto(url);
  await offscreen.evaluate(async () => {
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    await new Promise(resolve => setTimeout(resolve, 200));
  });
  assert.equal(await offscreen.evaluate(() => performance.getEntriesByName('forest-request').length), 0, '2.3: offscreen map does not request the renderer');
  await offscreen.locator('#website-forest').scrollIntoViewIfNeeded();
  await offscreen.waitForFunction(() => performance.getEntriesByName('forest-request').length === 1);
  await offscreen.close();
  let stillSources;
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1 });
    await page.goto(url);
    assert.equal(await page.locator('.forest-still img').count(), 1, '2.2: saved forest still exists without JavaScript');
    await page.waitForFunction(() => { const img = document.querySelector('.forest-still img'); return img.complete && img.naturalWidth > 0; });
    assert.ok(await page.locator('.forest-still').isVisible(), '2.2: still is visible without JavaScript');
    await contentUsable(page, width);
    stillSources ??= await page.locator('.forest-still').evaluate(element => element.innerHTML);
    await page.close();
  }
  for (const failure of ['webgl', 'chunk', 'initialization']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    if (failure === 'webgl') await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return /^webgl/.test(kind) ? null : get.call(this, kind, ...args); };
    });
    else if (failure === 'initialization') await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      let webglCalls = 0;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) { if (/^webgl/.test(kind) && ++webglCalls > 1) throw new Error('Simulated renderer initialization failure'); return get.call(this, kind, ...args); };
    });
    else await page.route(/\/forest-scene-[^/]+\.js/, route => route.abort('failed'));
    await page.goto(url);
    await page.locator('#website-forest').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => performance.getEntriesByName('forest-activate').length > 0);
    if (failure !== 'webgl') await page.waitForFunction(() => performance.getEntriesByName('forest-request').length > 0);
    await page.waitForFunction(() => document.querySelector('#website-forest').dataset.forestState === 'still');
    assert.equal(await page.locator('.forest-still').evaluate(element => element.innerHTML), stillSources, `2.2: ${failure} uses the same saved still`);
    assert.ok(await page.locator('.forest-still').isVisible(), `2.2: ${failure} keeps still visible`);
    await contentUsable(page, 390);
    await page.locator('#copy-command').click();
    await page.waitForFunction(() => document.querySelector('#copy-command').dataset.copyState === 'copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#install-command').textContent());
    if (failure === 'webgl') assert.ok(!requests.some(url => /\/forest-scene-/.test(url)), '2.2: missing WebGL does not download the renderer');
    await page.close();
  }
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Hold the renderer at the network edge. The install and contact text must already be usable.
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(/\/forest-scene-[^/]+\.js/, async route => { await held; await route.continue(); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await contentUsable(page, width);
    assert.ok(await page.locator('.forest-still').isVisible(), '2.3: text and still remain while renderer fetch is held');
    await page.locator('#website-forest').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => performance.getEntriesByName('forest-request').length > 0);
    const timing = await page.evaluate(() => ({
      textPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
      request: performance.getEntriesByName('forest-request')[0]?.startTime,
    }));
    assert.ok(timing.textPaint > 0 && timing.request >= timing.textPaint, `2.3: text paints before renderer request (${JSON.stringify(timing)})`);
    release();
    await page.waitForFunction(() => document.querySelector('#website-forest').dataset.forestState === 'live', undefined, { timeout: 90000 });
    assert.ok(await page.locator('.forest-canvas canvas').isVisible(), '2.3: public renderer draws successfully');
    assert.equal(await page.locator('.forest-still').isVisible(), false, '2.3: live drawing replaces still');
    await contentUsable(page, width);
    assert.deepEqual(errors, []);
    await page.locator('.forest-canvas canvas').evaluate(canvas => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await page.waitForFunction(() => document.querySelector('#website-forest').dataset.forestState === 'still');
    assert.ok(await page.locator('.forest-still').isVisible(), '2.2: losing the active WebGL context restores the same still');
    assert.equal(await page.locator('.forest-still').evaluate(element => element.innerHTML), stillSources);
    await contentUsable(page, width);
    await page.close();
  }
  const enlarged = await browser.newPage({ viewport: { width: 320, height: 720 } });
  await enlarged.goto(url);
  await enlarged.locator('#website-forest').scrollIntoViewIfNeeded();
  await enlarged.waitForFunction(() => document.querySelector('#website-forest').dataset.forestState === 'live', undefined, { timeout: 90000 });
  await enlarged.evaluate(() => {
    const sizes = [...document.querySelectorAll('body, body *')].map(element => [element, parseFloat(getComputedStyle(element).fontSize)]);
    for (const [element, size] of sizes) element.style.setProperty('font-size', `${size * 2}px`, 'important');
  });
  await contentUsable(enlarged, 320);
  const controls = await enlarged.locator('.forest-controls button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(), host = button.closest('#website-forest').getBoundingClientRect();
    return { label: button.getAttribute('aria-label') ?? button.textContent, width: rect.width, height: rect.height, inside: rect.left >= host.left && rect.right <= host.right && rect.top >= host.top && rect.bottom <= host.bottom };
  }));
  assert.ok(controls.every(button => button.width >= 44 && button.height >= 44 && button.inside), `320 px, doubled text: controls remain visible and usable (${JSON.stringify(controls)})`);
  await enlarged.locator('#website-forest').scrollIntoViewIfNeeded();
  await enlarged.locator('.forest-controls').screenshot({ path: path.join(here, 'controls-320-text200.png') });
  const canvas = await enlarged.locator('.forest-canvas canvas').boundingBox();
  await enlarged.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const beforeScroll = await enlarged.evaluate(() => scrollY);
  await enlarged.mouse.wheel(0, 250);
  await enlarged.waitForFunction(before => scrollY > before, beforeScroll);
  await enlarged.close();
  console.log('PASS: contracts 2.2/2.3 — text before renderer, matching still without JS/WebGL or after failed import, install/contact usable, live desktop/390 px layout without overflow.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

async function contentUsable(page, width) {
  assert.ok((await page.locator('#install-command').textContent()).trim(), 'Install command is present');
  assert.ok(await page.locator('#hero-title').isVisible(), 'Opening text is visible');
  assert.ok(await page.locator('a[href*="linkedin.com"]').first().isVisible(), 'Contact remains visible');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'No horizontal page overflow');
}
