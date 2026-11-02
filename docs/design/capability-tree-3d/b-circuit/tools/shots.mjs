// Takes the stills from index.html with the pre-installed Playwright. Run from the checkout root:
// node docs/design/capability-tree-3d/b-circuit/tools/shots.mjs [name ...]
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const dir = resolve('docs/design/capability-tree-3d/b-circuit');
const page0 = pathToFileURL(dir + '/index.html').href;
const shots = {
  resting: { size: [1600, 1000], run: () => {} },
  'whole-graph': { size: [3200, 2000], run: () => {} },
  'close-up': { size: [1600, 1000], run: (b) => b.centreOn('cap', '4 · Work model', 1.6) },
  'gate-contracts': { size: [1600, 1000], run: (b) => { b.select('link', ['27 · Fixed', '7 · Library API']); b.centreOn('cap', '7 · Library API', 1.15); } },
  'arrivals': { size: [1600, 1000], run: (b) => { b.select('finger', 'The command line'); b.centreOn('finger', 'The command line', 0.62); } },
  'wrench-open': { size: [1600, 1000], run: (b) => { b.select('wrench', '17 · The'); b.centreOn('cap', '17 · The', 1.3); } },
  'chip-open': { size: [1600, 1000], run: (b) => { b.select('cap', '26 · Rounds'); b.centreOn('cap', '26 · Rounds', 1.3); } },
};
const want = process.argv.slice(2);
const browser = await chromium.launch();
for (const [name, s] of Object.entries(shots)) {
  if (want.length && !want.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: s.size[0], height: s.size[1] } });
  page.on('console', (m) => console.log(name, m.type(), m.text()));
  page.on('pageerror', (e) => console.log(name, 'error', e.message));
  await page.goto(page0);
  await page.waitForFunction(() => window.__board);
  const info = await page.evaluate(`(${s.run})(window.__board), ({ failed: window.__board.failed, crossings: window.__board.crossings, byKind: window.__board.byKind, W: window.__board.W, H: window.__board.H })`);
  await page.screenshot({ path: `${dir}/stills/${name}.png` });
  console.log(name, JSON.stringify(info));
  await page.close();
}
await browser.close();
