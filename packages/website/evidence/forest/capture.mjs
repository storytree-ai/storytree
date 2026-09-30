// Reproducible screenshot, same-scene and load measurements. See README.md for the limits.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const website = path.resolve(here, '../..');
const stillsOnly = process.argv.includes('--stills');
const snapshotBytes = await readFile(path.join(website, 'src/forest-snapshot.json'));
const snapshot = JSON.parse(snapshotBytes);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const servers = [];
async function serve(root) {
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, `.${name === '/' ? '/index.html' : name}`);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    if (name === '/favicon.ico') return res.writeHead(204).end();
    try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}/`;
}
const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 12; i++) { window.__forestEvidence.invalidate(); await new Promise(requestAnimationFrame); }
});
async function observe(page) {
  await page.waitForFunction(() => window.__forestEvidence?.scene.getObjectByName('pathways:cross-island'), undefined, { timeout: 90000 });
  await settle(page);
  return page.evaluate(() => {
    const { scene, camera, gl, size } = window.__forestEvidence;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const round = value => Math.round(value * 1e8) / 1e8;
    const hash = attribute => {
      if (!attribute) return null;
      let h = 2166136261;
      const bytes = new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
      for (const n of bytes) h = Math.imul(h ^ n, 16777619);
      return `${bytes.length}:${(h >>> 0).toString(16)}`;
    };
    const objects = [], islands = [];
    scene.traverse(object => {
      if (object.name.startsWith('planet:story_')) {
        const ground = object.getObjectByName('island-ground'), points = ground.geometry.getAttribute('position');
        const at = camera.position.clone();
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (let i = 0; i < points.count; i++) {
          at.fromBufferAttribute(points, i).applyMatrix4(ground.matrixWorld).project(camera);
          const x = (at.x + 1) * size.width / 2, y = (1 - at.y) * size.height / 2;
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        const centre = object.getWorldPosition(camera.position.clone());
        islands.push({ story: object.name.slice(7), matrix: object.matrixWorld.elements.map(round),
          projectedGround: { width: round(right - left), height: round(bottom - top), left: round(left), top: round(top), nearHemisphere: centre.dot(camera.position) > 0 } });
      }
      if (!object.isMesh || !/^(island-|planet:shell$|pathway[:\-])/.test(object.name)) return;
      const material = object.material;
      objects.push({ name: object.name, story: object.parent?.name ?? '', matrix: object.matrixWorld.elements.map(round),
        position: hash(object.geometry.getAttribute('position')), index: hash(object.geometry.index),
        colour: material.color?.getHexString(), opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
    });
    const pathways = scene.getObjectByName('pathways:cross-island');
    const ctx = gl.getContext(), debug = ctx.getExtension('WEBGL_debug_renderer_info');
    return { camera: { position: camera.position.toArray().map(round), quaternion: camera.quaternion.toArray().map(round), zoom: round(camera.zoom), projection: camera.projectionMatrix.elements.map(round) },
      size: { width: size.width, height: size.height }, renderer: debug && ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      islands: islands.sort((a,b) => a.story.localeCompare(b.story)), objects,
      pathways: { ...pathways.userData }, names: [...document.querySelectorAll('.forest-label')].map(element => element.textContent) };
  });
}
let browser;
try {
  const site = await serve(path.join(here, 'dist/site'));
  const desktop = await serve(path.join(here, 'dist/desktop'));
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const comparison = {};
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.goto(site, { waitUntil: 'domcontentloaded' });
    await page.locator('#website-forest').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#website-forest').dataset.forestState === 'live', undefined, { timeout: 90000 });
    const measured = await observe(page);
    assert.deepEqual(measured.islands.map(island => island.story), snapshot.scene.islands.map(island => island.story).sort(), 'The rendered islands are exactly the saved stories');
    assert.equal(measured.objects.filter(object => object.name === 'island-ground').length, snapshot.scene.islands.length);
    const expectedCrossLinks = snapshot.scene.links.filter(link => {
      const owner = id => snapshot.scene.islands.find(island => island.trees.some(tree => tree.capability === id))?.story;
      return owner(link.from) !== owner(link.to);
    });
    // The plan includes local and cross-island capability links, even though only cross-island paths draw on these flat plates.
    assert.deepEqual(measured.pathways.links.map(link => `${link.from}>${link.to}`).sort(), snapshot.scene.links.map(link => `${link.from}>${link.to}`).sort());
    assert.ok(measured.objects.some(object => object.name.startsWith('pathway:')), 'Cross-island dependencies draw');
    if (stillsOnly) {
      await mkdir(path.join(website, 'public'), { recursive: true });
      const box = await page.locator('.forest-canvas canvas').boundingBox();
      const side = Math.min(box.width, box.height);
      await page.screenshot({ path: path.join(website, `public/forest-${width === 390 ? 'phone' : 'desktop'}.png`), clip: { x: box.x + (box.width - side) / 2, y: box.y + (box.height - side) / 2, width: side, height: side } });
      console.log(`Captured ${width === 390 ? 'phone' : 'desktop'} still: ${measured.size.width} × ${measured.size.height}`);
    } else {
      await page.locator('.forest-section').screenshot({ path: path.join(here, `forest-${width}.png`) });
      await page.locator('.forest-canvas canvas').screenshot({ path: path.join(here, `website-canvas-${width}.png`) });
      const app = await browser.newPage({ viewport: measured.size, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await app.goto(desktop, { waitUntil: 'domcontentloaded' });
      const other = await observe(app);
      assert.deepEqual(other.islands, measured.islands, 'Desktop and site have identical island placements');
      assert.deepEqual(other.objects, measured.objects, 'Desktop and site have identical base-island, coast, sea and pathway geometry/materials');
      assert.deepEqual(other.camera, measured.camera, 'Desktop and site use exactly the same camera and framing');
      assert.deepEqual(other.pathways, measured.pathways, 'Desktop and site render the same capability link plan');
      assert.deepEqual(other.names.sort(), snapshot.scene.islands.map(island => island.title).sort(), 'Desktop adds its own story names');
      await app.screenshot({ path: path.join(here, `desktop-app-${width}.png`) });
      await page.getByRole('button', { name: 'Turn map right' }).click();
      const turned = await observe(page);
      assert.notDeepEqual(turned.islands, measured.islands, 'Turning changes the globe orientation');
      await page.getByRole('button', { name: 'Reset view' }).click();
      const reset = await observe(page);
      assert.deepEqual(reset.islands, measured.islands, 'Reset restores every island to its saved opening orientation');
      assert.deepEqual(reset.camera, measured.camera, 'Reset retains the original camera');
      comparison[width] = { site: measured, desktop: other, expectedCrossLinks: expectedCrossLinks.length, controls: { turnChangesIslands: true, resetRestoresIslandsAndCamera: true } };
      await app.close();
    }
    await page.close();
  }
  if (!stillsOnly) {
    const production = await serve(path.join(website, 'dist'));
    const runs = [];
    for (const width of [1440, 390]) for (let run = 1; run <= 3; run++) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1250000, uploadThroughput: 125000 });
      await page.goto(production, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
      const scrolledAt = await page.evaluate(() => performance.now());
      await page.locator('#website-forest').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('#website-forest').dataset.forestState === 'live', undefined, { timeout: 90000 });
      const result = await page.evaluate(() => ({
        firstTextPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        rendererRequestedMs: performance.getEntriesByName('forest-request')[0]?.startTime,
        firstRenderedFrameMs: performance.getEntriesByName('forest-ready')[0]?.startTime,
        resources: performance.getEntriesByType('resource').map(entry => ({ path: new URL(entry.name).pathname, startMs: entry.startTime, durationMs: entry.duration, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize, transferBytes: entry.transferSize })),
        documentWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(result.rendererRequestedMs >= result.firstTextPaintMs);
      assert.ok(result.firstRenderedFrameMs >= result.rendererRequestedMs);
      assert.equal(result.documentWidth, width);
      assert.deepEqual(errors, []);
      runs.push({ width, run, scrolledAtMs: scrolledAt, ...result });
      if (run === 1) await page.screenshot({ path: path.join(here, `production-${width}.png`), fullPage: true });
      await context.close();
    }
    const bundles = [];
    for (const name of (await readdir(path.join(website, 'dist/assets'))).sort()) {
      const bytes = await readFile(path.join(website, 'dist/assets', name));
      bundles.push({ name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, brotliBytes: brotliCompressSync(bytes).length });
    }
    const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return /^webgl/.test(kind) ? null : original.call(this, kind, ...args); };
    });
    await fallback.goto(production);
    await fallback.locator('#website-forest').scrollIntoViewIfNeeded();
    await fallback.screenshot({ path: path.join(here, 'no-webgl-390.png'), fullPage: true });
    await fallback.close();
    const results = {
      capturedAt: new Date().toISOString(), browser: await browser.version(),
      conditions: { network: 'Fresh browser context per run; disabled cache; local HTTP; 40 ms latency; 10 Mbit/s download; 1 Mbit/s upload; no compression by server', cpu: 'Unthrottled host CPU; ANGLE SwiftShader software GL', deviceScaleFactor: 1, runsPerWidth: 3, scroll: 'Scroll forest into view after observed first contentful paint; scroll time recorded separately', performanceBuild: 'Unmodified production build; no observation hooks' },
      snapshot: { sha256: createHash('sha256').update(snapshotBytes).digest('hex'), capturedAt: snapshot.capturedAt, stories: snapshot.scene.islands.length, capabilities: snapshot.scene.islands.reduce((n, island) => n + island.trees.length, 0), links: snapshot.scene.links.length, radius: snapshot.radius },
      comparison, runs, bundles,
    };
    await writeFile(path.join(here, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify({ browser: results.browser, snapshot: results.snapshot, runs: runs.map(({ resources, ...run }) => run), bundles }, null, 2));
  }
} finally { await browser?.close(); await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
