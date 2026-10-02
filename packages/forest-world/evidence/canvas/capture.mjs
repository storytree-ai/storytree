// Contracts 5.1, 5.2, 5.5 and 5.8: run the shipped canvas in real Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { recordBrowserCoverage } from '@storytree/dev-loop/browser-coverage';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '../..');
const out = path.join(here, 'out');
const proof = 'forest-world 5.1 canvas readiness, 5.2 camera, 5.5 host input and teardown, 5.8 shipped wisp';
const mutation = process.argv.includes('--mutate-camera');
mkdirSync(out, { recursive: true });
let browser;
let server;
try {
  await build({
    entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'),
    bundle: true, sourcemap: 'external', format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.glb': 'binary' }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: mutation ? [{ name: 'camera-red', setup(builder) {
      builder.onLoad({ filter: /ForestWorldCanvas\.tsx$/ }, ({ path: sourcePath }) => {
        const source = readFileSync(sourcePath, 'utf8');
        const changed = source.replace('      paints,\n    );', '      false,\n    );');
        assert.notEqual(changed, source, 'mutation must remove the real synchronous paint');
        return { contents: changed, loader: 'tsx' };
      });
    } }] : [],
  });
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? readFileSync(path.join(out, 'bundle.js')) :
      '<!doctype html><style>html,body,#root{margin:0;width:100%;height:100%;background:#101418}</style><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => {
    try { const s = window.worldProof.snapshot(); return s.ready.length && s.wisp && s.triangles > 0; }
    catch { return false; }
  }, null, { timeout: 60_000 });
  const standalone = await page.evaluate(() => window.worldProof.snapshot());
  assert.deepEqual(errors, [], 'the actual renderer has no errors');
  assert.deepEqual(standalone.ready.map(row => row.state), ['ready']);
  assert.ok(standalone.ready[0].canvas && standalone.ready[0].targets > 0, '5.1 ready follows canvas creation and committed plants');
  assert.ok(standalone.controls && standalone.backdrop, '5.5 standalone owns controls and background');
  assert.ok(standalone.ground > 0 && standalone.triangles > 0, 'the mounted World draws its actual ground and props');
  assert.ok(standalone.wisp.inside && standalone.wisp.size.every(value => value > 1), '5.8 the drawn shell contains its solid core in three dimensions');
  assert.ok(standalone.wisp.triangles <= 300 && standalone.wisp.glow, '5.8 shared low-cost body and glow are drawn');
  if (!mutation) await page.screenshot({ path: path.join(here, 'standalone.png') });

  const camera = await page.evaluate(() => window.worldProof.registered(6, 5, 9));
  assert.ok(camera.after > camera.before, '5.2 a presentable registered camera paints before its commit returns');
  assert.equal(camera.camera.zoom, 6);
  await page.waitForFunction(() => { const s = window.worldProof.snapshot(); return !s.controls && !s.backdrop && !s.targets.length; });
  const registered = await page.evaluate(() => window.worldProof.snapshot());
  assert.equal(registered.pointerEvents, 'none', '5.5 host owns pointer input');
  assert.equal(registered.wisp, null, '5.5 host-owned marks are not duplicated');
  if (!mutation) await page.screenshot({ path: path.join(here, 'registered.png') });
  const parked = await page.evaluate(() => window.worldProof.registered(8, 12, 15, false));
  assert.equal(parked.after, parked.before, '5.2 parked camera draws nothing');
  assert.equal(parked.camera.zoom, 8, '5.2 parked camera still accepts the pose');
  assert.equal(parked.camera.position[0] - camera.camera.position[0], 7);
  assert.equal(parked.camera.position[2] - camera.camera.position[2], 6);
  await page.evaluate(() => window.worldProof.registered(8, 12, 15, true, true));
  await page.waitForFunction(() => window.worldProof.targets().length > 0);
  await page.evaluate(() => window.worldProof.unmount());
  await page.waitForFunction(() => window.worldProof.targets().length === 0);
  assert.equal(await page.locator('canvas').count(), 0, '5.5 unmount removes the canvas and withdraws its host targets');
  assert.deepEqual(errors, [], 'mount, camera changes and teardown completed without renderer errors');

  const scripts = (await page.coverage.stopJSCoverage()).filter(script => script.url.endsWith('/bundle.js')).map(script => ({
    functions: script.functions, source: script.source,
    sourceMap: JSON.parse(readFileSync(path.join(out, 'bundle.js.map'), 'utf8')),
    bundlePath: 'evidence/canvas/out/bundle.js',
  }));
  assert.equal(scripts.length, 1, 'one generated bundle and its matching map');
  assert.ok(!mutation, 'a mutated capture can never publish allocation evidence');
  const measured = recordBrowserCoverage({ pkgDir, proof, passed: true, scripts });
  assert.ok(measured['src/ForestWorldCanvas.tsx']?.[5] > 0);
  assert.ok(measured['src/wisp-asset.ts']?.[5] > 0);
  writeFileSync(path.join(here, 'browser-trace.json.gz'), gzipSync(JSON.stringify({ proof, scripts })));
  const result = { capturedAt: new Date().toISOString(), browser: browser.version(), proof, standalone, camera, registered, parked, teardown: { targets: 0, canvases: 0 }, errors, measured };
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!mutation) {
    try { recordBrowserCoverage({ pkgDir, proof, passed: false, scripts: [] }); } catch {}
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  rmSync(out, { recursive: true, force: true });
}
