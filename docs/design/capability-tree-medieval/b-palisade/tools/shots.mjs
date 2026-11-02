// Captures the stills kept beside the mock: the resting view and one view per kind of click.
// Run from the checkout root: node docs/design/capability-tree-medieval/b-palisade/tools/shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The website package is the one that depends on the browser driver.
const { chromium } = createRequire(resolve('packages/website/package.json'))('playwright-core');

const dir = 'docs/design/capability-tree-medieval/b-palisade/';
mkdirSync(dir + 'stills', { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(pathToFileURL(resolve(dir + 'index.html')).href);
const shot = (name) => page.locator('.workspace').screenshot({ path: `${dir}stills/${name}.png` });
const click = (selector) => page.evaluate((s) => window.mock.pick(s), selector);

await shot('resting');
await click('.wrench .wrench-hit'); await shot('wrench-arcs');
// A pathway's contracts, shown through the gate most tracks pass, so the still shows several at once.
const busiest = await page.evaluate(() => { const g = [...DATA.layout.gates].sort((a, b) => b.links.length - a.links.length)[0]; return DATA.layout.gates.indexOf(g); });
await click(`.layer-gates .gate:nth-child(${busiest + 1}) .gate-hit`); await shot('gate-contracts');
await click('.layer-fields .field:nth-child(2) .field-fill'); await shot('field');
await page.check('#sample'); await click('.wrench:nth-of-type(2) .wrench-hit'); await shot('sample-wrench-arcs');
await browser.close();
if (errors.length > 0) { console.error(errors.join('\n')); process.exit(1); }
console.log('stills written');
