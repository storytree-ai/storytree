// Run under flock /tmp/storytree-heavy.lock. This script performs every browser render itself.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLANET_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.join(root, 'docs/research/planet-look');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLANET_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  env: { ...process.env, LD_PRELOAD: path.join(root, 'apps/desktop/planet-look/dist/no-hardware-gpu.so') },
  args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const requested = process.argv.slice(2);
const cases = [
  ['own-l1', '?light=L1'], ['own-l2', '?light=L2'],
  ['own-l3-000', '?light=L3&turn=0'], ['own-l3-090', '?light=L3&turn=90'], ['own-l3-180', '?light=L3&turn=180'],
  ['synthetic-36-l1', '?light=L1&synthetic=1'],
  ['library-rim', '?light=L1&rim=1'],
];
try {
  for (const [name, query] of cases.filter(([name]) => !requested.length || requested.includes(name))) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 988 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => {
      if (!errors.includes(String(error))) { errors.push(String(error)); console.error(name, error); }
      void page.evaluate(error => { document.body.dataset.error = error; }, String(error)).catch(() => {});
    });
    page.on('console', message => {
      if (message.type() === 'error' && !errors.includes(message.text())) { errors.push(message.text()); console.error(name, message.text()); }
    });
    console.log(`Rendering ${name}`);
    const progress = setInterval(async () => {
      console.log(name, await page.evaluate(() => ({ stage: window.planetLook?.stage, ready: window.planetLook?.ready, canvases: document.querySelectorAll('canvas').length })).catch(String));
    }, 15000);
    try {
      await page.goto('http://127.0.0.1:4178/' + query, { timeout: 120000, waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.planetLook?.ready || document.body.dataset.error, undefined, { timeout: 240000 });
    } finally { clearInterval(progress); }
    const failure = await page.getAttribute('body', 'data-error');
    if (failure || errors.length) throw new Error(failure ?? errors.join('\n'));
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    const stats = await page.evaluate(() => window.planetLook);
    stats.labels = await page.locator('.label').evaluateAll(labels => labels.map(label => ({ text: label.textContent, bounds: label.getBoundingClientRect().toJSON(), display: getComputedStyle(label.parentElement.parentElement).display })));
    if (['own-l1', 'own-l2', 'own-l3-000'].includes(name)) {
      const before = stats.lightDirections['agent-link'];
      await page.evaluate(() => window.orbitLookEye(90));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      const after = await page.evaluate(() => window.planetLook.lightDirections['agent-link']);
      const distance = (a,b) => Math.hypot(...a.map((n,i) => n-b[i]));
      const worldDelta = distance(before.world, after.world);
      const viewDelta = distance(before.view, after.view);
      if ((name === 'own-l1' && (worldDelta < .5 || viewDelta > .00001)) ||
          (name !== 'own-l1' && worldDelta > .00001) || before.groundRevision !== after.groundRevision) {
        throw new Error(`Light/frame probe failed: ${JSON.stringify({ before, after })}`);
      }
      stats.eyeOrbitProbe = { degrees: 90, before, after, worldDelta, viewDelta, passed: true };
    }
    writeFileSync(path.join(out, `${name}.json`), JSON.stringify(stats, null, 2) + '\n');
    console.log(JSON.stringify({ name, stories: stats.stories, trees: stats.trees, zoom: stats.zoom, sides: stats.sides }));
    await page.close();
  }
} finally { await browser.close(); }
