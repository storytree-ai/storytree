// World 6.17: a host reveals roads after leaving them hidden, including over a recorded timeline.
// Run: node --import tsx packages/forest-world/evidence/globe-exterior/reveal.mjs [--check]
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from './build.mjs';
import { withCapture } from '../../../../apps/desktop/src/capture/index.ts';
import { recordBrowserCoverage } from '../../../dev-loop/src/browser-coverage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '../..');
const dist = path.join(here, 'out');
const PROOF = 'forest-world 6.17 showing hidden roads draws them by distance without advancing recorded arrivals';
const smoke = process.argv.includes('--smoke');
const results = {};
let traces;
try {
  await buildPage(dist);
  await withCapture({ folder: path.join(here, 'reveal'), dist }, async ({ browser, origin, out }) => {
    const page = await browser.newPage({ viewport: smoke ? { width: 640, height: 400 } : { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    if (!smoke) await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const picture = async name => { if (!smoke) await page.screenshot({ path: path.join(out, `1440-${name}.png`) }); };
    await page.goto(origin);
    await page.evaluate(() => window.proof.mount(true));
    await page.waitForFunction(() => window.proof.ready());
    await page.evaluate(() => window.proof.freeze());
    const frame = async delta => page.evaluate(delta => {
      window.proof.frame(delta);
      return window.proof.roads();
    }, delta);
    const mount = async (surface, roads) => {
      await page.evaluate(([surface, roads]) => window.proof.mount(surface, { roads }), [surface, roads]);
      await page.waitForFunction(visible => window.proof.drawn().roads === visible, surface && roads);
    };
    const whole = roads => roads.length > 0 && roads.every(road => road.drawn === road.count);
    const empty = roads => roads.length > 0 && roads.every(road => road.drawn === 0);
    const fraction = roads => {
      const strips = roads.filter(road => road.name.startsWith('pathway:'));
      const total = strips.reduce((sum, road) => sum + road.length, 0);
      return strips.reduce((sum, road) => sum + road.progress * road.length, 0) / total;
    };
    const advance = async seconds => {
      for (let remaining = seconds; remaining > 1e-8; remaining -= 0.05) await frame(Math.min(0.05, remaining));
      return page.evaluate(() => window.proof.roads());
    };
    results.initial = await frame(0);
    assert.ok(whole(results.initial), 'a host initially showing its roads keeps the static complete view');
    await mount(true, false);
    await frame(10);
    await mount(true, true);
    results.start = await frame(10);
    assert.ok(empty(results.start), 'showing roads after a long hidden interval starts with undrawn roads and halos');
    await picture('start');
    results.quarter = await advance(0.25);
    assert.ok(Math.abs(fraction(results.quarter) - 0.25) < 1e-8, 'a quarter second reveals a quarter of the physical road');
    await picture('quarter');
    await mount(true, true);
    // Wait for the host update to commit even though its visibility did not change.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    results.half = await advance(0.25);
    assert.ok(Math.abs(fraction(results.half) - 0.5) < 1e-8, 'an ordinary visible host update does not restart the reveal');
    for (const road of results.half.filter(road => road.name.startsWith('pathway:'))) {
      const halo = results.half.find(halo => halo.name === road.name.replace('pathway:', 'pathway-halo:'));
      assert.equal(halo.progress, road.progress, 'the halo follows the same front');
      assert.equal(typeof road.fromEnd, 'boolean', 'the front follows the routed dependency direction');
    }
    await picture('half');
    results.complete = await advance(0.55);
    assert.ok(whole(results.complete), 'the road completes in one rendered second');
    await picture('complete');
    await mount(false, true);
    await mount(true, true);
    results.again = await frame(10);
    assert.ok(empty(results.again), 'showing the whole exterior again starts another reveal');
    results.slow = await frame(10);
    assert.ok(Math.abs(fraction(results.slow) - 0.08) < 1e-8, 'a slow frame cannot swallow the growth');
    await mount(true, false);
    await page.evaluate(() => window.proof.recorded(0));
    await page.waitForFunction(() => window.proof.drawn().roads);
    await frame(0);
    results.beforeRecordedArrival = await advance(1.1);
    assert.ok(empty(results.beforeRecordedArrival), 'surface reveal cannot advance the recorded arrival');
    await page.evaluate(() => window.proof.recorded(5));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    results.afterRecordedArrival = await frame(0);
    assert.ok(whole(results.afterRecordedArrival), 'the recorded timeline completes without restarting the visible surface');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(true, false);
    await mount(true, true);
    results.reduced = await frame(10);
    assert.ok(whole(results.reduced), 'reduced motion shows the complete road immediately');
    await page.evaluate(() => window.proof.dispose());
    assert.deepEqual(errors, [], 'no page errors');
    if (!smoke) {
      traces = (await page.coverage.stopJSCoverage()).filter(script => script.url.endsWith('/bundle.js')).map(script => ({
        functions: script.functions, source: script.source,
        sourceMap: JSON.parse(readFileSync(path.join(dist, 'bundle.js.map'), 'utf8')),
        bundlePath: 'evidence/globe-exterior/out/bundle.js',
      }));
      assert.equal(traces.length, 1);
      const measured = recordBrowserCoverage({ pkgDir, proof: PROOF, passed: true, scripts: traces });
      writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ capturedAt: new Date().toISOString(), proof: PROOF, results, measured }, null, 2) + '\n');
    }
    console.log(JSON.stringify({ proof: PROOF, passed: true, output: out }));
    await page.close();
  });
} catch (error) {
  if (!smoke) try { recordBrowserCoverage({ pkgDir, proof: PROOF, passed: false, scripts: [] }); } catch {}
  throw error;
} finally {
  rmSync(dist, { recursive: true, force: true });
}
