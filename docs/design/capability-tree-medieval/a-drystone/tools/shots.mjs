// Captures the stills kept beside the drystone mock, and checks the drawing against its data.
// Run from the checkout root: node docs/design/capability-tree-medieval/a-drystone/tools/shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The website package is the one that depends on the browser driver.
const { chromium } = createRequire(resolve('packages/website/package.json'))('playwright-core');

const dir = 'docs/design/capability-tree-medieval/a-drystone/';
mkdirSync(dir + 'stills', { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 });
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', error => errors.push(String(error)));
await page.goto(pathToFileURL(resolve(dir + 'index.html')).href);
await page.waitForFunction(() => window.mock !== undefined);

// Each field's share of the island against its share of the lines, and how each link is walked.
const areas = await page.evaluate(() => window.mock.areas());
const worst = areas.reduce((w, a) => Math.max(w, Math.abs(a.share - a.want) / a.want), 0);
console.log('largest area error, relative to its share:', (worst * 100).toFixed(1) + '%');
for (const a of areas) if (Math.abs(a.share - a.want) / a.want > 0.1) console.log(`  field ${a.number}: ${(a.share * 100).toFixed(2)}% of the island for ${(a.want * 100).toFixed(2)}% of the lines`);
const pathways = await page.evaluate(() => window.mock.pathways());
console.log('links walked through another field:', pathways.filter(p => p.via.length > 2).map(p => `${p.from}→${p.to} via ${p.via.join('·')}`).join(', ') || 'none');
console.log('links with no gate:', pathways.filter(p => p.gates === 0).map(p => `${p.from}→${p.to}`).join(', ') || 'none');

const panel = page.locator('.panel');
const shot = name => panel.screenshot({ path: `${dir}stills/${name}.png` });
await shot('resting');
await page.evaluate(() => window.mock.select('wrench', 8)); await shot('wrench-arcs');
await page.evaluate(() => window.mock.select('gate', 4)); await shot('gate-contracts');
await page.evaluate(() => window.mock.select('lane', 6)); await shot('lane-contracts');
await page.evaluate(() => window.mock.select('field', 1)); await shot('field-open');
await page.evaluate(() => window.mock.sample(true, true));
await page.evaluate(() => window.mock.select('wrench', 2)); await shot('sample-every-state-and-wrenches');
await page.screenshot({ path: `${dir}stills/page.png` });
await browser.close();
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
