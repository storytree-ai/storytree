// World 6.7 in real Chromium: the mounted globe hides its sea, island grounds and roads independently,
// keeping each island's host marks, and surface=false hides all of it. exterior.test.ts proves the
// switches' rule without a GPU; this proves the canvas obeys it, and records what the proof executed.
// Run from the checkout: node --import tsx packages/forest-world/evidence/globe-exterior/capture.mjs
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from './build.mjs';
import { withCapture, settle } from '../../../../apps/desktop/src/capture/index.ts';
import { recordBrowserCoverage } from '../../../dev-loop/src/browser-coverage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '../..');
const out = path.join(here, 'out');
const PROOF = 'forest-world 6.7 the mounted globe hides its sea, island grounds and roads independently, keeping plate children; hiding the exterior hides all of it';

let traces;
const results = {};
try {
  await buildPage(out);
  await withCapture({ folder: here, dist: out }, async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.goto(origin);
    const drawn = async (surface, surfaces) => {
      await page.evaluate(([surface, surfaces]) => window.proof.mount(surface, surfaces), [surface, surfaces]);
      await page.waitForFunction(() => window.proof.ready(), null, { timeout: 60_000 });
      await settle(page, 4);
      return page.evaluate(() => window.proof.drawn());
    };
    const all = [true, true];
    results.whole = await drawn(true, undefined);
    assert.deepEqual(results.whole, { sea: true, grounds: all, roads: true, marks: all }, 'by default the globe draws every layer');
    await page.screenshot({ path: path.join(here, 'whole.png') });
    results.noSea = await drawn(true, { sea: false });
    assert.deepEqual(results.noSea, { sea: false, grounds: all, roads: true, marks: all }, 'the sea hides alone');
    results.noGrounds = await drawn(true, { grounds: false });
    assert.deepEqual(results.noGrounds, { sea: true, grounds: [false, false], roads: true, marks: all }, 'bare grounds keep the islands\' marks');
    await page.screenshot({ path: path.join(here, 'no-grounds.png') });
    results.noRoads = await drawn(true, { roads: false });
    assert.deepEqual(results.noRoads, { sea: true, grounds: all, roads: false, marks: all }, 'the roads hide alone');
    results.inside = await drawn(false, { sea: true, grounds: true, roads: true });
    assert.deepEqual(results.inside, { sea: false, grounds: [false, false], roads: false, marks: [false, false] }, 'surface=false wins over every switch');
    await page.evaluate(() => window.proof.dispose());
    assert.deepEqual(errors, [], 'no page errors');
    traces = (await page.coverage.stopJSCoverage()).filter(script => script.url.endsWith('/bundle.js')).map(script => ({
      functions: script.functions, source: script.source,
      sourceMap: JSON.parse(readFileSync(path.join(out, 'bundle.js.map'), 'utf8')),
      bundlePath: 'evidence/globe-exterior/out/bundle.js',
    }));
    assert.equal(traces.length, 1, 'one generated bundle and its matching map');
    await page.close();
  });
  const measured = recordBrowserCoverage({ pkgDir, proof: PROOF, passed: true, scripts: traces });
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify({ capturedAt: new Date().toISOString(), proof: PROOF, results, measured }, null, 2) + '\n');
  console.log(JSON.stringify({ results, measured }, null, 2));
} catch (error) {
  // A failed capture withdraws the proof's previous input: a failure proves nothing.
  try { recordBrowserCoverage({ pkgDir, proof: PROOF, passed: false, scripts: [] }); } catch {}
  throw error;
} finally {
  rmSync(out, { recursive: true, force: true });
}
