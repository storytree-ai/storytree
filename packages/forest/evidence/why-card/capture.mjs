// Seeded, repeatable capture of the drill-down card saying why a capability is not green (forest 4.12,
// ADR-0825 D1/D2): the fixed tree in ./entry.ts, through the real view model and renderer, with the
// desktop page's real styles.css, headless Chromium, fixed viewports, no hand-panning.
//   node --import tsx packages/forest/evidence/why-card/capture.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withCapture } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const find = (name) => { const dir = path.join(root, 'node_modules/.pnpm'); return readdirSyncFor(dir, name); };
import { readdirSync } from 'node:fs';
function readdirSyncFor(dir, prefix) { const hit = readdirSync(dir).find((entry) => entry.startsWith(prefix)); assert.ok(hit, `${prefix} is installed`); return path.join(dir, hit, 'node_modules', prefix.split('@')[0]); }
const esbuild = await import(pathToFileURL(path.join(find('esbuild@0'), 'lib/main.js')).href);

const bundle = await esbuild.build({ entryPoints: [path.join(here, 'entry.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', absWorkingDir: root, loader: { '.png': 'dataurl', '.glb': 'dataurl' }, logLevel: 'error' });
const css = readFileSync(path.join(root, 'apps/desktop/src/renderer/styles.css'), 'utf8')
  + readFileSync(path.join(root, 'packages/forest/src/view/styles.css'), 'utf8');
const html = (theme) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style></head><body data-surface="forest"><main class="forest-workspace"><div class="story-panel"></div></main><script>${bundle.outputFiles[0].text}</script></body></html>`;

const shots = [
  { name: 'needs-you', selected: 'cloud', viewport: { width: 1280, height: 800 }, scheme: 'dark' },
  { name: 'needs-you-light', selected: 'cloud', viewport: { width: 1280, height: 800 }, scheme: 'light' },
  { name: 'agent-no-test', selected: 'search', viewport: { width: 1280, height: 800 }, scheme: 'dark' },
  { name: 'not-re-run', selected: 'sync', viewport: { width: 1280, height: 800 }, scheme: 'dark', open: true },
  { name: 'healthy', selected: 'notes', viewport: { width: 1280, height: 800 }, scheme: 'dark' },
  { name: 'needs-you-narrow', selected: 'cloud', viewport: { width: 390, height: 844 }, scheme: 'dark', open: true },
  { name: 'not-re-run-narrow', selected: 'sync', viewport: { width: 390, height: 844 }, scheme: 'dark', open: true },
];
await withCapture({ folder: here, softwareGL: false }, async ({ browser, out, settle }) => {
const results = [];
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: shot.viewport, colorScheme: shot.scheme, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setContent(html(shot.scheme));
    await page.evaluate((selected) => globalThis.show(selected), shot.selected);
    if (shot.open) await page.evaluate(() => document.querySelector('.panel-detail details')?.setAttribute('open', ''));
    await page.evaluate(() => { document.querySelector('.panel-detail')?.scrollIntoView(); });
    await settle(page);
    await page.screenshot({ path: path.join(out, `${shot.name}.png`) });
    const measured = await page.evaluate(() => {
      const panel = document.querySelector('.story-panel');
      const why = [...document.querySelectorAll('.panel-why')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
      const lastSeen = [...document.querySelectorAll('.panel-last-seen')].map((node) => node.textContent);
      return { why, lastSeen, panel: { width: panel.clientWidth, scrollWidth: panel.scrollWidth }, fontPx: getComputedStyle(document.querySelector('.panel-why') ?? document.body).fontSize };
    });
    assert.deepEqual(errors, [], 'no page errors');
    assert.ok(measured.panel.scrollWidth <= measured.panel.width, `${shot.name}: nothing overflows the panel sideways`);
    results.push({ shot: shot.name, ...shot, ...measured });
    await page.close();
  }
assert.equal(results.find((r) => r.shot === 'healthy').why.length, 0, 'a healthy capability says nothing more');
writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ shot, why, lastSeen, panel }) => ({ shot, why, lastSeen, panel })), null, 1));
});
