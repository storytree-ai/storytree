// Contract 6.5: a real Chromium execution through the public capture seam.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { recordBrowserCoverage } from '@storytree/dev-loop/browser-coverage';
import { coverageOf } from '../../src/survey-coverage.mjs';

const work = mkdtempSync(path.join(tmpdir(), 'browser-allocation-'));
const pkgDir = path.join(work, 'dev-loop');
const browser = await chromium.launch({ headless: true });
try {
  mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
  const source = 'function clicked() { return 42; }\nfunction idle() { return 0; }\nwindow.answer = clicked();\n//# sourceURL=allocation-bundle.js';
  const sourceMap = { version: 3, sources: ['../src/clicked.ts', '../src/idle.ts'], names: [], mappings: 'AAAA;ACAA' };
  writeFileSync(path.join(pkgDir, 'src/clicked.ts'), 'export function clicked() { return 42; }\n');
  writeFileSync(path.join(pkgDir, 'src/idle.ts'), 'export function idle() { return 0; }\n');
  const page = await browser.newPage();
  await page.coverage.startJSCoverage();
  await page.addScriptTag({ content: source });
  const answer = await page.evaluate(() => window.answer);
  assert.equal(answer, 42);
  const scripts = (await page.coverage.stopJSCoverage()).filter(script => script.url === 'allocation-bundle.js');
  const measured = recordBrowserCoverage({
    pkgDir, proof: 'dev-loop 6.5 clicked returns its result', passed: true,
    scripts: scripts.map(script => ({ ...script, bundlePath: 'dist/bundle.js', sourceMap })),
  });
  const regenerated = await coverageOf({ root: pkgDir, pkgDir, env: process.env });
  assert.deepEqual(measured, { 'src/clicked.ts': { 6: 1 } });
  assert.deepEqual(regenerated, measured);
  const result = { capturedAt: new Date().toISOString(), browser: browser.version(), answer, scripts, sourceMap, measured, regenerated };
  writeFileSync(new URL('browser.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ answer, measured, regenerated }));
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
