// Website 2.16: the real page's recorded claims as flags (ADR-0968), observed through the globe's existing capture seam, and the
// claims step's pictures for the map chapter in six steps (../map-six-steps).
// WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
// node --import tsx packages/website/evidence/recorded-claims.mjs [output-directory]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { crossingLength } from '@storytree/forest-world/planet';
import { buildPlanetPathways } from '@storytree/forest-world/geometry';
import { mapRecording, mapGrowthPlan } from '../src/map-recording.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(here, 'recorded-claims'));
const pictures = process.argv[2] ? output : path.join(here, 'map-six-steps');
const dist = path.resolve(here, '../dist');
const saved = JSON.parse(await readFile(path.resolve(here, '../src/shop-snapshot.json'), 'utf8'));
const recording = mapRecording(saved);
const pathways = buildPlanetPathways(recording.scene, new Map(recording.spots), recording.radius);
const plan = mapGrowthPlan(recording, link => crossingLength(pathways, link));
const stages = plan.stages.map(stage => ({ ...stage, recorded: recording.stages.find(item => item.id === stage.id).at }));
const startOf = id => { const stage = stages.find(stage => stage.id === id); assert.ok(stage, id); return stage.start; };
// The three sessions of the first round, in their recorded colours, and the islands their claims fall on.
const browsing = 'hsl(10, 80%, 68%)', cart = 'hsl(188, 80%, 68%)', checkout = 'hsl(214, 80%, 68%)';
const productPage = 'capability_f29c62742cce', orderComplete = 'capability_94f91d2ed3a9';
// Every flag standing once the last of the eight claims is made (02:28:27): its colour, and whether it stands in a lot.
const standing = recording.stages.find(stage => stage.id === `staked-${orderComplete}`).wisps
  .flatMap(wisp => wisp.capabilities.map(capability => `${wisp.colour} ${capability}${wisp.colour === browsing ? '' : ' lot'}`)).sort();
assert.equal(standing.length, 8);
await mkdir(output, { recursive: true }); await mkdir(pictures, { recursive: true });
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
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('storytree-opening-seen', 'yes');
      window.__claimFrames = [];
      window.__storytreeCaptureGlobe = get => {
        window.__claimGlobe = get;
        const gl = get().gl, render = gl.render.bind(gl);
        gl.render = (...args) => {
          const result = render(...args);
          const host = document.querySelector('.forest-drawing');
          if (host?.dataset.globe !== 'shop') return result;
          const { scene } = get(), claims = [], health = [];
          scene.traverseVisible(object => {
            // A flag: the claim's group, its lot beside it on an island with no code.
            if (object.name.startsWith('territory-claim:') && object.getObjectByName('claim-flag')?.visible) claims.push({ capability: object.userData.capability, colour: object.userData.colour,
              lot: !!object.getObjectByName(`claim-lot:${object.userData.capability}`) });
            if (object.name.startsWith('territory:') && object.userData.capability) health.push({ capability: object.userData.capability, word: object.userData.word, fill: '#' + object.material.color.getHexString() });
          });
          window.__claimFrames.push({ step: document.querySelector('#chapter2').dataset.tourStep, at: Number(host.dataset.growth), wallMs: performance.now(), claims, health });
          return result;
        };
      };
    });
    const go = id => page.locator(`#tour-pips [data-step="${id}"]`).click();
    const pause = async () => { if (await page.locator('#tour-play').getAttribute('aria-label') === 'Pause the tour') await page.locator('#tour-play').click(); };
    const play = async () => { if (await page.locator('#tour-play').getAttribute('aria-label') === 'Play the tour') await page.locator('#tour-play').click(); };
    const shot = name => page.screenshot({ path: path.join(pictures, `${width}-claims-${name}.png`) });
    const reached = at => page.waitForFunction(at => Number(document.querySelector('.forest-drawing')?.dataset.growth) >= at, at, { timeout: 90_000 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__claimGlobe && document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
    // The whole chapter, played at the tour's own 0.75×, the claims step pictured as its flags drop and the health step as they lift.
    await go('map-empty'); await play();
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep === 'map-claims', null, { timeout: 240_000 });
    await page.waitForTimeout(2500); await shot('1-flags-dropping');
    await reached(startOf(`staked-${orderComplete}`)); await page.waitForTimeout(1200); await shot('2-eight-flags');
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep === 'map-health', null, { timeout: 90_000 });
    await reached(startOf(`lifted-${productPage}`)); await page.waitForTimeout(600); await shot('3-first-lifts');
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep !== 'map-health', null, { timeout: 120_000 });
    await pause();
    const frames = await page.evaluate(() => window.__claimFrames);
    const of = (step, from = -Infinity, to = Infinity) => frames.filter(frame => frame.step === step && frame.at >= from && frame.at < to);
    const names = frame => frame.claims.map(claim => `${claim.colour} ${claim.capability}${claim.lot ? ' lot' : ''}`).sort();
    // Steps 1 to 4: no flag, before any claim, while the islands rise and the pathways and capabilities draw.
    for (const step of ['map-empty', 'map-arcs', 'map-stories', 'map-capabilities']) {
      const shown = of(step);
      assert.ok(shown.length > 2 && shown.every(frame => frame.claims.length === 0), `${width}: ${step} draws no flag`);
    }
    // Step 5: the eight flags, each in its session's colour, the cart's and checkout's in lots, browsing's beside its code.
    const claimed = of('map-claims', startOf(`staked-${orderComplete}`) + .02);
    assert.ok(claimed.length > 2, `${width}: the claims step's flags really draw`);
    for (const frame of claimed) assert.deepEqual(names(frame), standing, `${width}: the eight flags stand`);
    const dropping = of('map-claims', -Infinity, startOf(`staked-${orderComplete}`)).map(frame => frame.claims.length);
    assert.ok(dropping.every((count, index) => index === 0 || count >= dropping[index - 1]), `${width}: the flags drop one after another and none lifts in the claims step`);
    // Step 6: they lift as capabilities land, and none stands once the round is green.
    const lifting = of('map-health').map(frame => frame.claims.length);
    assert.ok(lifting.length > 2 && lifting[0] <= 8 && lifting.every((count, index) => index === 0 || count <= lifting[index - 1]) && lifting.at(-1) === 0, `${width}: the flags lift through health, and none comes back: ${lifting.filter((count, index) => count !== lifting[index - 1])}`);
    // Pixel difference against the same frame with only the claim marks hidden proves the flags survive projection.
    await go('map-claims'); await play();
    await reached(startOf(`staked-${orderComplete}`)); await page.waitForTimeout(900); await pause(); await page.waitForTimeout(1500);
    const pixels = await page.evaluate(() => {
      const { scene, camera, gl } = window.__claimGlobe(), context = gl.getContext();
      const read = () => { gl.render(scene, camera); const bytes = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4); context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, bytes); return bytes; };
      const health = () => { const parts = []; scene.traverse(object => { if (object.name.startsWith('territory:')) parts.push({ ...object.userData, fill: object.material.color.getHexString(), opacity: object.material.opacity }); }); return JSON.stringify(parts); };
      const beforeHealth = health();
      const marks = []; scene.traverseVisible(object => { if (object.userData.claim) marks.push(object); });
      const withClaims = read();
      marks.forEach(mark => { mark.visible = false; });
      const without = read();
      marks.forEach(mark => { mark.visible = true; }); read();
      if (beforeHealth !== health()) throw new Error('Claim flags changed capability health or fills');
      let changed = 0;
      for (let i = 0; i < without.length; i += 4) if (Math.abs(without[i] - withClaims[i]) + Math.abs(without[i+1] - withClaims[i+1]) + Math.abs(without[i+2] - withClaims[i+2]) > 12) changed++;
      return { marks: marks.length, changed };
    });
    assert.ok(pixels.marks >= 8 && pixels.changed > 40, `${width}: the flags and their lots change visible pixels (${JSON.stringify(pixels)})`);
    assert.deepEqual(errors, []);
    const seconds = ids => ids.map(id => ({ id, recorded: stages.find(stage => stage.id === id).recorded, planSeconds: +startOf(id).toFixed(2) }));
    results.push({ width, standing, claimedFrames: claimed.length, pixels, stages: seconds(stages.filter(stage => /^(staked|lifted)-/.test(stage.id)).map(stage => stage.id)), frames: frames.length });
    await page.close();
    console.log(`PASS website 2.16 at ${width}: no flag before the claims step, then the first round's eight claims as flags in three colours (the cart's and checkout's in lots), lifting through health; ${pixels.changed} visible pixels; health unchanged`);
  }
  await writeFile(path.join(output, 'observations.json'), JSON.stringify({ source: 'Locally built website; existing globe capture seam; SwiftShader; 0.75x default speed',
    baseCommit: (await readFile(path.join(dist, 'version.txt'), 'utf8')).trim(), checks: [{ contract: '2.16', observed: 'pass' }], results }, null, 2) + '\n');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
