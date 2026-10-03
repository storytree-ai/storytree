// Contract 6.10: count the frames the shipped globe draws in real Chromium while its canvas is off screen.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
mkdirSync(out, { recursive: true });
let browser;
let server;
try {
  await build({
    entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'),
    bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  // The globe sits between two spacers taller than the viewport, so it starts below the fold.
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? readFileSync(path.join(out, 'bundle.js')) :
      '<!doctype html><style>html,body{margin:0;background:#101418}.spacer{height:150vh}#globe{height:600px}</style>' +
      '<div class="spacer"></div><div id="globe"></div><div class="spacer"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const open = async (blind = false) => {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    if (blind) await page.addInitScript(() => { delete window.IntersectionObserver; });
    await page.goto(url);
    await page.waitForFunction(() => window.planetProof?.snapshot().created, null, { timeout: 60_000 });
    return page;
  };
  const snap = page => page.evaluate(() => window.planetProof.snapshot());
  const toGlobe = page => page.evaluate(() => document.getElementById('globe').scrollIntoView({ block: 'center' }));
  const drawsPast = (page, draws) => page.waitForFunction(n => window.planetProof.snapshot().draws > n, draws, { timeout: 30_000 });

  const page = await open();
  await page.waitForTimeout(1500);
  const mounted = await snap(page);
  await toGlobe(page);
  await drawsPast(page, mounted.draws + 10);
  const shown = await snap(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(500);
  const away = await snap(page);
  await page.waitForTimeout(2000);
  const stillAway = await snap(page);
  await toGlobe(page);
  await drawsPast(page, stillAway.draws);
  const back = await snap(page);
  await page.waitForTimeout(500);
  await page.locator('#globe').screenshot({ path: path.join(here, 'back-on-screen.png') });
  // Its top edge exactly on the fold: the canvas touches the viewport but none of it can be seen.
  await page.evaluate(() => scrollTo(0, document.getElementById('globe').offsetTop - innerHeight));
  await page.waitForTimeout(500);
  const edge = await snap(page);
  await page.waitForTimeout(1500);
  const edgeLater = await snap(page);
  await page.close();

  const blindPage = await open(true);
  await blindPage.waitForTimeout(1500);
  const blind = await snap(blindPage);
  await blindPage.close();

  const result = {
    capturedAt: new Date().toISOString(), browser: browser.version(), renderer: 'SwiftShader', viewport: [960, 720],
    framesWhileMountedBelowTheFold: mounted.draws,
    framesWhileScrolledAway: stillAway.draws - away.draws, scrolledAwayMs: Math.round(stillAway.at - away.at),
    framesWhileTouchingTheFold: edgeLater.draws - edge.draws, touchingMs: Math.round(edgeLater.at - edge.at),
    framesWithoutIntersectionObserverBelowTheFold: blind.draws,
    clockAcrossThePause: { clockSeconds: back.clock - away.clock, pageSeconds: (back.at - away.at) / 1000 },
    phases: { mounted, shown, away, stillAway, back, edge, edgeLater, blind }, errors,
  };
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));

  assert.deepEqual(errors, [], 'the actual renderer has no errors');
  assert.equal(result.framesWhileMountedBelowTheFold, 0, '6.10 a globe mounted below the fold draws nothing');
  assert.ok(shown.draws > mounted.draws, 'on screen it draws');
  assert.equal(result.framesWhileScrolledAway, 0, '6.10 scrolled away, an animating globe draws nothing');
  assert.ok(back.draws > stillAway.draws, '6.10 back on screen it draws again');
  assert.ok(result.clockAcrossThePause.clockSeconds >= 0.9 * result.clockAcrossThePause.pageSeconds, '6.10 its clock keeps time while it is away');
  assert.deepEqual(back.camera, shown.camera, '6.10 it keeps its camera while it is away');
  assert.equal(back.plates, shown.plates, '6.10 it keeps its scene while it is away');
  assert.equal(result.framesWhileTouchingTheFold, 0, '6.10 a canvas touching the fold, with none of it in view, draws nothing');
  assert.ok(blind.draws > 0, '6.10 where the browser cannot tell what is on screen, it draws as before');
  console.log('PASS contract 6.10: no frames below the fold, scrolled away or touching it; drawing again on return, clock and camera kept; unchanged without IntersectionObserver');
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  rmSync(out, { recursive: true, force: true });
}
