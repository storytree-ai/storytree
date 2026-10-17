// Contract 6.15: lose and restore the shipped globe's WebGL context in real Chromium, as a busy GPU does,
// and see whether a still globe draws itself again, on screen and after coming back from off screen.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildPage } from './build.mjs';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out-context');
const measurements = process.argv.includes('--red') ? 'context-loss-red-measurements.json' : 'context-loss-measurements.json';
let browser;
let server;
try {
  await buildPage(out);
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? readFileSync(path.join(out, 'bundle.js')) :
      '<!doctype html><style>html,body{margin:0;background:#101418}.spacer{height:150vh}#globe{height:600px}</style>' +
      '<div class="spacer"></div><div id="globe"></div><div class="spacer"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/?idle`;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.planetProof?.snapshot().created, null, { timeout: 60_000 });
  const snap = () => page.evaluate(() => window.planetProof.snapshot());
  const toGlobe = () => page.evaluate(() => document.getElementById('globe').scrollIntoView({ block: 'center' }));
  // What is on screen where the globe is: the share of its pixels that are not the page's background.
  const painted = async name => {
    const png = await page.locator('#globe').screenshot({ path: name ? path.join(here, name) : undefined });
    return page.evaluate(async data => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const board = document.createElement('canvas');
      board.width = image.width; board.height = image.height;
      const pen = board.getContext('2d');
      pen.drawImage(image, 0, 0);
      const { data: px } = pen.getImageData(0, 0, image.width, image.height);
      let drawn = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 0x10) + Math.abs(px[i + 1] - 0x14) + Math.abs(px[i + 2] - 0x18) > 12) drawn++;
      return drawn / (px.length / 4);
    }, png.toString('base64'));
  };

  // On screen: a still globe, drawn and settled.
  await toGlobe();
  await page.waitForFunction(() => window.planetProof.snapshot().draws > 0, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const shown = await snap();
  const shownPainted = await painted();
  await page.evaluate(() => window.planetProof.loseContext());
  await page.waitForTimeout(500);
  const lostPainted = await painted();
  const lost = await snap();
  await page.evaluate(() => window.planetProof.restoreContext());
  await page.waitForTimeout(1500);
  const restored = await snap();
  const restoredPainted = await painted('context-restored.png');

  // Off screen: lost and restored while away, then scrolled back.
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.planetProof.loseContext());
  await page.waitForTimeout(300);
  const awayLost = await snap();
  await page.evaluate(() => window.planetProof.restoreContext());
  await page.waitForTimeout(1500);
  const awayRestored = await snap();
  await toGlobe();
  await page.waitForTimeout(1500);
  const back = await snap();
  const backPainted = await painted();
  await page.close();

  const result = {
    capturedAt: new Date().toISOString(), browser: browser.version(), renderer: 'SwiftShader', viewport: [960, 720],
    paintedShare: { shown: shownPainted, lost: lostPainted, restored: restoredPainted, backFromAway: backPainted },
    framesAfterRestoreOnScreen: restored.draws - lost.draws,
    framesWhileRestoredAway: awayRestored.draws - awayLost.draws,
    framesBackFromAway: back.draws - awayRestored.draws,
    phases: { shown, lost, restored, awayLost, awayRestored, back }, errors,
  };
  writeFileSync(path.join(here, measurements), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));

  // Chromium reports the deliberate loss on the console; nothing else may go wrong.
  assert.deepEqual(errors.filter(error => !/CONTEXT_LOST_WEBGL|context lost/i.test(error)), [], 'the actual renderer has no errors');
  assert.ok(shownPainted > 0.05, 'the still globe is drawn before the loss');
  assert.ok(result.framesAfterRestoreOnScreen > 0, '6.15 on screen, a restored globe draws again of its own accord');
  assert.ok(restoredPainted > 0.9 * shownPainted, '6.15 on screen, the restored globe shows what it showed before');
  assert.deepEqual(restored.camera, shown.camera, '6.15 the restored globe keeps its camera and zoom');
  assert.equal(restored.plates, shown.plates, '6.15 the restored globe keeps its scene');
  assert.equal(result.framesWhileRestoredAway, 0, '6.10 restored off screen, it still draws nothing');
  assert.ok(result.framesBackFromAway > 0, '6.15 restored off screen, it draws once back in view');
  assert.ok(backPainted > 0.9 * shownPainted, '6.15 back in view, the globe is all there');
  console.log('PASS contract 6.15: a lost and restored globe draws itself again on screen, and on return when restored off screen, camera and scene kept');
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  rmSync(out, { recursive: true, force: true });
}
