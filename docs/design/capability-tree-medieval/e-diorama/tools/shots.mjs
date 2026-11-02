// Captures the stills kept beside the mock: the resting view and one view per kind of click.
// Run from the checkout root: node docs/design/capability-tree-medieval/e-diorama/tools/shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The website package is the one that depends on the browser driver.
const { chromium } = createRequire(resolve('packages/website/package.json'))('playwright-core');

const dir = 'docs/design/capability-tree-medieval/e-diorama/';
mkdirSync(dir + 'stills', { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(pathToFileURL(resolve(dir + 'index.html')).href);
const shot = (name) => page.locator('.workspace').screenshot({ path: `${dir}stills/${name}.png` });
if (errors.length > 0) { console.error(errors.join('\n')); process.exit(1); }
const pick = (selector) => page.evaluate((s) => window.mock.pick(s), selector);

console.log(JSON.stringify(await page.evaluate(() => window.mock.layout())));
await shot('resting');
await pick('.wrench:not(.sample) .wrench-hit'); await shot('wrench-arcs');
await pick('.road[data-road="0"] .road-hit'); await shot('pathway-contracts');
// The gate most tracks pass, so the still shows several at once.
const busiest = await page.evaluate(() => [...document.querySelectorAll('.gate')].map((g) => g.dataset.gate)
  .sort((a, b) => window.mock.gateLinks(b) - window.mock.gateLinks(a))[0]);
await pick(`.gate[data-gate="${busiest}"] .gate-hit`); await shot('gate-contracts');
await pick('.territory[data-capability="capability_dd486ffa5b02"] .top'); await shot('territory');
await pick('.offshore .road-hit'); await shot('road-to-keys');
await page.check('#sample');
await pick('.wrench.sample[data-capability="capability_a7f068502213"] .wrench-hit'); await shot('sample-wrench-arcs');
await browser.close();
if (errors.length > 0) { console.error(errors.join('\n')); process.exit(1); }
console.log('stills written');
