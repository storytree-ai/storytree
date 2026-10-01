// Seeded, repeatable capture of a first user's story panel, in a project nothing verifies (forest 4.13,
// ADR-0630): each built card leads with the agent's report and says storytree does not check this
// project's tests yet. The fixed tree in ./entry.ts, through the real view model and renderer, with the
// desktop page's real styles.css, headless Chromium, fixed viewports, no hand-panning.
//   node packages/forest/evidence/report-only/capture.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const find = (name) => { const dir = path.join(root, 'node_modules/.pnpm'); return readdirSyncFor(dir, name); };
import { readdirSync } from 'node:fs';
function readdirSyncFor(dir, prefix) { const hit = readdirSync(dir).find((entry) => entry.startsWith(prefix)); assert.ok(hit, `${prefix} is installed`); return path.join(dir, hit, 'node_modules', prefix.split('@')[0]); }
const esbuild = await import(path.join(find('esbuild@0'), 'lib/main.js'));
const { chromium } = await import(path.join(find('playwright-core@'), 'index.mjs'));

const bundle = await esbuild.build({ entryPoints: [path.join(here, 'entry.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', absWorkingDir: root, loader: { '.png': 'dataurl', '.glb': 'dataurl' }, logLevel: 'error' });
const css = readFileSync(path.join(root, 'apps/desktop/src/renderer/styles.css'), 'utf8');
const html = (theme) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style></head><body data-surface="forest"><main><div class="story-panel"></div></main><script>${bundle.outputFiles[0].text}</script></body></html>`;

const shots = [
  { name: 'reported-passing', selected: 'add', viewport: { width: 1280, height: 800 }, scheme: 'dark' },
  { name: 'reported-failing-light', selected: 'complete', viewport: { width: 1280, height: 800 }, scheme: 'light' },
  { name: 'nothing-reported', selected: 'persist', viewport: { width: 1280, height: 800 }, scheme: 'dark' },
  { name: 'reported-passing-narrow', selected: 'footer', viewport: { width: 390, height: 844 }, scheme: 'dark', open: true },
];
const browser = await chromium.launch();
const results = [];
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: shot.viewport, colorScheme: shot.scheme, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setContent(html(shot.scheme));
    await page.evaluate((selected) => globalThis.show(selected), shot.selected);
    if (shot.open) await page.evaluate(() => document.querySelector('.panel-detail details')?.setAttribute('open', ''));
    await page.evaluate(() => { document.querySelector('.panel-detail')?.scrollIntoView(); });
    await page.screenshot({ path: path.join(here, `${shot.name}.png`) });
    const measured = await page.evaluate(() => {
      const panel = document.querySelector('.story-panel');
      const why = [...document.querySelectorAll('.panel-why')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
      const lastSeen = [...document.querySelectorAll('.panel-last-seen')].map((node) => node.textContent);
      const text = panel.innerText;
      return { why, lastSeen, text, panel: { width: panel.clientWidth, scrollWidth: panel.scrollWidth }, fontPx: getComputedStyle(document.querySelector('.panel-why') ?? document.body).fontSize };
    });
    assert.deepEqual(errors, [], 'no page errors');
    assert.ok(measured.panel.scrollWidth <= measured.panel.width, `${shot.name}: nothing overflows the panel sideways`);
    results.push({ shot: shot.name, ...shot, ...measured });
    await page.close();
  }
} finally {
  await browser.close();
}
for (const result of results) assert.deepEqual(result.why, ["storytree does not check this project's tests yet."], `${result.shot}: says so, with no reason or mover`);
for (const result of results) assert.doesNotMatch(result.text, /untested|no test names|moves this one|Why not green/, `${result.shot}: none of the words it replaces`);
writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ shot, why, panel }) => ({ shot, why, panel })), null, 1));
