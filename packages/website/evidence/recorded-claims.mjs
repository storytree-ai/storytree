// Website 2.16 and 2.17: the real page's recorded claims, observed through the globe's existing capture seam.
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
const dist = path.resolve(here, '../dist');
const saved = JSON.parse(await readFile(path.resolve(here, '../src/shop-snapshot.json'), 'utf8'));
const recording = mapRecording(saved);
const pathways = buildPlanetPathways(recording.scene, new Map(recording.spots), recording.radius);
const plan = mapGrowthPlan(recording, link => crossingLength(pathways, link));
const stages = plan.stages.map(stage => ({ ...stage, recorded: recording.stages.find(item => item.id === stage.id).at }));
// The claims step replays pr7-building to just short of pr9 over 20 seconds at 1x (ADR-0891, amended 2026-10-10).
const start = stages.find(stage => stage.id === 'pr7-building').start;
const end = stages.find(stage => stage.id === 'pr9').start;
const secondsIntoStep = id => 20 * (stages.find(stage => stage.id === id).start - start) / (end - start);
const expectedClaims = recording.stages.find(stage => stage.id === 'pr7-building').wisps;
const surveyed = new Set(recording.stages.find(stage => stage.id === 'pr7-building').scene.islands.flatMap(island => island.land?.territories.flatMap(part => part.capability ? [part.capability] : []) ?? []));
const expected = expectedClaims.flatMap(wisp => wisp.capabilities.filter(capability => surveyed.has(capability)).map(capability => ({ capability, colour: wisp.colour })));
// The Orders session's Order overview (Checkout) and Side menu (the Cart), in its colour.
assert.deepEqual(expected.map(item => item.colour), ['hsl(193, 80%, 68%)', 'hsl(193, 80%, 68%)']);
await mkdir(output, { recursive: true });
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
          const { scene, camera } = get(), claims = [], health = [];
          scene.traverseVisible(object => {
            if (object.name.startsWith('territory-claim:')) {
              const centre = object.getWorldPosition(camera.position.clone());
              claims.push({ capability: object.userData.capability, colour: object.userData.colour,
                material: '#' + object.material.color.getHexString(), opacity: object.material.opacity,
                near: centre.dot(camera.position) > 0, triangles: object.geometry.attributes.position.count / 3 });
            }
            if (object.name.startsWith('territory:') && object.userData.capability) health.push({ capability: object.userData.capability, word: object.userData.word, fill: '#' + object.material.color.getHexString() });
          });
          window.__claimFrames.push({ step: document.querySelector('#chapter2').dataset.tourStep,
            at: Number(host.dataset.growth), wallMs: performance.now(), claims, health });
          return result;
        };
      };
    });
    const go = id => page.locator(`#tour-pips [data-step="${id}"]`).click();
    const pause = async () => { if (await page.locator('#tour-play').getAttribute('aria-label') === 'Pause the tour') await page.locator('#tour-play').click(); };
    const play = async () => { if (await page.locator('#tour-play').getAttribute('aria-label') === 'Play the tour') await page.locator('#tour-play').click(); };
    const shot = name => page.screenshot({ path: path.join(output, `${width}-${name}.png`) });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__claimGlobe && document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
    // Play the chapter from signing in's growth: nothing on it, or on the first round, draws as a claim.
    await go('map-first'); await play();
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep === 'map-together', null, { timeout: 90_000 });
    await go('map-health'); await play();
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep === 'map-claims', null, { timeout: 60_000 });
    const before = await page.evaluate(() => window.__claimFrames.filter(frame => ['map-first', 'map-code', 'map-health'].includes(frame.step)).map(frame => [frame.step, frame.claims.length]));
    assert.ok(before.length > 10 && before.every(([, claims]) => claims === 0), `${width}: no claim draws before the claims step`);
    await page.waitForFunction(() => document.querySelector('#chapter2').dataset.tourStep !== 'map-claims', null, { timeout: 60_000 });
    await pause();
    const frames = await page.evaluate(() => window.__claimFrames.filter(frame => frame.step === 'map-claims'));
    const inStage = id => {
      const index = stages.findIndex(stage => stage.id === id);
      return frames.filter(frame => frame.at >= stages[index].start + .03 && frame.at < stages[index + 1].start - .03);
    };
    const sorted = claims => claims.map(({ capability, colour }) => ({ capability, colour })).sort((a, b) => a.capability.localeCompare(b.capability));
    for (const id of ['pr7-building', 'pr9-building', 'pr8-building', 'pr7']) {
      const shown = inStage(id).filter(frame => frame.claims.length);
      assert.ok(shown.length > 2, `${width}: the Orders outlines really draw at ${id}`);
      for (const frame of shown) {
        assert.deepEqual(sorted(frame.claims), expected.toSorted((a, b) => a.capability.localeCompare(b.capability)), `${width}: only Order overview and Side menu draw at ${id}`);
        assert.ok(frame.claims.every(claim => claim.opacity > 0 && claim.triangles > 0));
      }
    }
    const visible = frames.filter(frame => frame.claims.length);
    const first = visible[0], last = visible.at(-1);
    const stagesSeen = ['pr7-building', 'pr9-building', 'pr8-building', 'pr7', 'pr9'].map(id => ({ id, recorded: stages.find(stage => stage.id === id).recorded,
      secondsIntoStep: secondsIntoStep(id), secondsAtDefaultSpeed: secondsIntoStep(id) / .75 }));
    // A second pass pauses the real replay for readable evidence, without changing its dates or claims.
    await go('map-claims'); await play();
    await page.waitForFunction(at => Number(document.querySelector('.forest-drawing')?.dataset.growth) > at, stages.find(stage => stage.id === 'pr8-building').start + .1);
    await page.waitForFunction(() => window.__claimFrames.at(-1)?.claims.length === 2, null, { timeout: 30_000 });
    await pause(); await page.waitForTimeout(1500); await shot('orders-claimed');
    // Pixel difference against the same frame with only claim marks hidden proves the outlines survive projection/occlusion.
    const pixels = await page.evaluate(() => {
      const { scene, camera, gl } = window.__claimGlobe(), context = gl.getContext();
      const read = () => { gl.render(scene, camera); const bytes = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4); context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, bytes); return bytes; };
      const health = () => { const parts = []; scene.traverse(object => { if (object.name.startsWith('territory:')) parts.push({ ...object.userData, fill: object.material.color.getHexString(), opacity: object.material.opacity }); }); return JSON.stringify(parts); };
      const beforeHealth = health();
      const outlines = []; scene.traverseVisible(object => { if (object.userData.claim) outlines.push(object); });
      const withClaims = read();
      outlines.forEach(outline => { outline.visible = false; });
      const without = read();
      outlines.forEach(outline => { outline.visible = true; }); read();
      if (beforeHealth !== health()) throw new Error('Claim outlines changed capability health or fills');
      let changed = 0;
      for (let i = 0; i < without.length; i += 4) if (Math.abs(without[i] - withClaims[i]) + Math.abs(without[i+1] - withClaims[i+1]) + Math.abs(without[i+2] - withClaims[i+2]) > 12) changed++;
      return changed;
    });
    assert.ok(pixels > 20, `${width}: coloured outlines change visible pixels (${pixels})`);
    for (const id of ['agents-claim', 'agents-parallel']) {
      await go(id); await pause(); await page.waitForTimeout(3000);
      assert.equal(await page.evaluate(() => window.__claimFrames.at(-1).claims.length), 0, `${width}: ${id} has no surveyed claimed territories`);
      await page.locator('#tour-depth').click(); await page.waitForTimeout(200); await shot(id);
      await page.locator('#tour-depth').click();
    }
    assert.deepEqual(errors, []);
    results.push({ width, stages: stagesSeen, firstOutlinedFrame: first, lastOutlinedFrame: last,
      observedSecondsAtDefaultSpeed: (last.at - first.at) * 20 / (end - start) / .75,
      outlinePixels: pixels, framesBeforeClaims: before.length, frames: frames.length });
    await page.close();
    console.log(`PASS website 2.16/2.17 at ${width}: no claim on signing in or the first round; the Orders session's two recorded outlines, ${pixels} visible pixels, through pr7; health unchanged`);
  }
  await writeFile(path.join(output, 'observations.json'), JSON.stringify({ source: 'Locally built website; existing globe capture seam; SwiftShader; 0.75x default speed',
    baseCommit: (await readFile(path.join(dist, 'version.txt'), 'utf8')).trim(), checks: [{ contract: '2.16', observed: 'pass' }, { contract: '2.17', observed: 'pass' }], results }, null, 2) + '\n');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
