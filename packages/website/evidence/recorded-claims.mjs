// Website 2.16 and 2.17: the real page's recorded claims as flags (ADR-0968), observed through the globe's existing capture seam,
// and the first island's pictures for the map chapter in five steps (../map-five).
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
const pictures = process.argv[2] ? output : path.join(here, 'map-five');
const dist = path.resolve(here, '../dist');
const saved = JSON.parse(await readFile(path.resolve(here, '../src/shop-snapshot.json'), 'utf8'));
const recording = mapRecording(saved);
const pathways = buildPlanetPathways(recording.scene, new Map(recording.spots), recording.radius);
const plan = mapGrowthPlan(recording, link => crossingLength(pathways, link));
const stages = plan.stages.map(stage => ({ ...stage, recorded: recording.stages.find(item => item.id === stage.id).at }));
const startOf = id => { const stage = stages.find(stage => stage.id === id); assert.ok(stage, id); return stage.start; };
const purple = 'hsl(300, 80%, 68%)', blue = 'hsl(214, 80%, 68%)';
const shopServer = 'capability_323895c5a414', session = 'capability_678463042156', pageShell = 'capability_ae20917d7a32', signInPage = 'capability_ff897f5c13aa', signOut = 'capability_918e1fa754ab';
// Each staked stage's newly claimed capability, in the order signing in's session claimed them.
const staked = [shopServer, session, pageShell, signInPage, signOut];
// Checkout's two claimed capabilities with code on the map at pr5; its third has none.
const checkout = recording.stages.find(stage => stage.id === 'pr5').wisps.filter(wisp => wisp.colour === blue).flatMap(wisp => wisp.capabilities);
const surveyed = new Set(recording.stages.find(stage => stage.id === 'pr5').scene.islands.flatMap(island => island.land?.territories.flatMap(part => part.capability ? [part.capability] : []) ?? []));
const checkoutFlags = checkout.filter(capability => surveyed.has(capability)).sort();
assert.equal(checkoutFlags.length, 2);
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
    const shot = name => page.screenshot({ path: path.join(pictures, `${width}-first-island-${name}.png`) });
    const reached = at => page.waitForFunction(at => Number(document.querySelector('.forest-drawing')?.dataset.growth) >= at, at, { timeout: 90_000 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__claimGlobe && document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
    // The first island, played at the tour's own 0.75×, pictured as its session stakes it and as its code lands.
    await go('map-empty'); await play();
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep === 'map-first', null, { timeout: 90_000 });
    await reached(startOf(`staked-${shopServer}`) - .08); await shot('1-before-claim');
    await reached(startOf(`staked-${shopServer}`)); await page.waitForTimeout(250); await shot('2-flag-arrives');
    await reached(startOf(`lifted-${shopServer}`)); await page.waitForTimeout(900); await shot('3-second-lot');
    await reached(startOf(`staked-${pageShell}`)); await page.waitForTimeout(900); await shot('4-third-lot');
    await page.waitForFunction(() => document.querySelectorAll('#tour-lines .tour-line.on').length === 4, null, { timeout: 90_000 });
    await page.waitForTimeout(1500); await shot('5-sessions');
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep === 'map-code', null, { timeout: 90_000 });
    await reached(startOf(`land-${session}`)); await page.waitForTimeout(500); await shot('6-code-lands');
    await reached(startOf(`land-${pageShell}`)); await page.waitForTimeout(500); await shot('7-code-landed');
    // Then the rest of the chapter, from Pathways, where checkout's agent's flags stand while its code is on the map.
    await go('map-together'); await play();
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep === 'map-health', null, { timeout: 90_000 });
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep !== 'map-health', null, { timeout: 90_000 });
    await pause();
    const frames = await page.evaluate(() => window.__claimFrames);
    const of = (step, from, to = Infinity) => frames.filter(frame => frame.step === step && frame.at >= from && frame.at < to);
    const names = frame => frame.claims.map(claim => `${claim.colour} ${claim.capability}${claim.lot ? ' lot' : ''}`).sort();
    // Before the first claim: signing in plain.
    const plain = of('map-first', 0, startOf(`staked-${shopServer}`));
    assert.ok(plain.length > 2 && plain.every(frame => frame.claims.length === 0), `${width}: signing in rises plain`);
    // Each staked capability's flag drops into its lot, in the session's colour, and stands while its stage lasts.
    const flags = staked.map(capability => {
      const shown = of('map-first', startOf(`staked-${capability}`) + .02, startOf(`lifted-${capability}`) - .02).filter(frame => frame.claims.some(claim => claim.capability === capability));
      assert.ok(shown.length > 2, `${width}: ${capability}'s flag really draws while it is claimed`);
      for (const frame of shown) assert.ok(frame.claims.every(claim => claim.colour === purple && claim.lot && staked.includes(claim.capability)), `${width}: only signing in's session's flags, each in a lot: ${names(frame)}`);
      return { capability, frames: shown.length, recorded: stages.find(stage => stage.id === `staked-${capability}`).recorded };
    });
    // Its code lands: the lots give way to territories, and no flag stands.
    const landed = of('map-code', startOf(`land-${session}`));
    assert.ok(landed.length > 2 && landed.every(frame => frame.claims.length === 0), `${width}: no flag once signing in's code is on the map`);
    // Pathways: checkout's two capabilities with code carry its agent's flags at pr5; no lot, as the island has code.
    const pr5 = of('map-together', startOf('pr5') + .03, startOf('pr4') - .03).filter(frame => frame.claims.length);
    assert.ok(pr5.length > 2, `${width}: checkout's flags really draw at pr5`);
    for (const frame of pr5) assert.deepEqual(names(frame), checkoutFlags.map(capability => `${blue} ${capability}`), `${width}: checkout's two flags at pr5`);
    const early = of('map-together', 0, startOf('pr5') - .03);
    assert.ok(early.every(frame => frame.claims.length === 0), `${width}: no flag before pr5: the cart and checkout have no ground for their claims yet`);
    // Health: every flag has lifted once its holder released.
    const health = of('map-health', startOf('pr4') + .3);
    assert.ok(health.length > 2 && health.every(frame => frame.claims.length === 0), `${width}: no flag in the health step`);
    // Pixel difference against the same frame with only the claim marks hidden proves the flags survive projection.
    await go('map-first'); await play();
    await reached(startOf(`staked-${pageShell}`)); await page.waitForTimeout(900); await pause(); await page.waitForTimeout(1500);
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
    assert.ok(pixels.marks >= 1 && pixels.changed > 40, `${width}: the flag and its lot change visible pixels (${JSON.stringify(pixels)})`);
    for (const id of ['agents-claim', 'agents-parallel']) {
      await go(id); await pause(); await page.waitForTimeout(3000);
      assert.equal(await page.evaluate(() => window.__claimFrames.at(-1).claims.length), 0, `${width}: ${id} has no ground drawn for its claims`);
      await page.locator('#tour-depth').click(); await page.waitForTimeout(200); await page.screenshot({ path: path.join(output, `${width}-${id}.png`) });
      await page.locator('#tour-depth').click();
    }
    assert.deepEqual(errors, []);
    const seconds = ids => ids.map(id => ({ id, recorded: stages.find(stage => stage.id === id).recorded, planSeconds: +startOf(id).toFixed(2) }));
    results.push({ width, flags, checkoutFrames: pr5.length, pixels, stages: seconds([`staked-${shopServer}`, `staked-${session}`, `lifted-${shopServer}`, `lifted-${session}`, `staked-${pageShell}`, `lifted-${pageShell}`,
      `staked-${signInPage}`, `lifted-${signInPage}`, `staked-${signOut}`, `lifted-${signOut}`, `land-${shopServer}`, `land-${session}`, `land-${pageShell}`, 'pr5', 'pr4']), frames: frames.length });
    await page.close();
    console.log(`PASS website 2.16/2.17 at ${width}: signing in's five claims as flags in lots before its code lands, none once it lands, checkout's two flags at pr5, ${pixels.changed} visible pixels; health unchanged`);
  }
  await writeFile(path.join(output, 'observations.json'), JSON.stringify({ source: 'Locally built website; existing globe capture seam; SwiftShader; 0.75x default speed',
    baseCommit: (await readFile(path.join(dist, 'version.txt'), 'utf8')).trim(), checks: [{ contract: '2.16', observed: 'pass' }, { contract: '2.17', observed: 'pass' }], results }, null, 2) + '\n');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
