// Captures the stills kept beside the pixel-art mock, and checks the drawing against its data.
// Run from the checkout root: node docs/design/capability-tree-medieval/f-pixel/tools/shots.mjs
// With --seeds N it instead scores the first N layout seeds (links between neighbours, links through a territory), to choose LAYOUT_SEED.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The website package is the one that depends on the browser driver.
const { chromium } = createRequire(resolve('packages/website/package.json'))('playwright-core');

const dir = 'docs/design/capability-tree-medieval/f-pixel/';
mkdirSync(dir + 'stills', { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1060, height: 900 }, deviceScaleFactor: 2 });
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', error => errors.push(String(error)));
await page.goto(pathToFileURL(resolve(dir + 'index.html')).href);
await page.waitForFunction(() => window.mock !== undefined);

const seeds = process.argv.indexOf('--seeds');
if (seeds > 0) {
  for (let seed = 1; seed <= Number(process.argv[seeds + 1]); seed++) {
    const s = await page.evaluate(n => window.mock.score(n), seed);
    console.log(`seed ${s.seed}: ${s.direct} links between neighbours, ${s.via} through a territory, ${s.ungated} without a gate`);
  }
  await browser.close();
  process.exit(0);
}

// Each territory's share of the island against its share of the lines, and how each link is walked.
const areas = await page.evaluate(() => window.mock.areas());
const worst = areas.reduce((w, a) => Math.max(w, Math.abs(a.share - a.want) / a.want), 0);
console.log('largest area error, relative to its share:', (worst * 100).toFixed(1) + '%');
for (const a of areas) if (Math.abs(a.share - a.want) / a.want > 0.05) console.log(`  territory ${a.number}: ${(a.share * 100).toFixed(2)}% of the island for ${(a.want * 100).toFixed(2)}% of the lines`);
const pathways = await page.evaluate(() => window.mock.pathways());
console.log('links walked through another territory:', pathways.filter(p => p.via.length > 2).map(p => `${p.from}→${p.to} via ${p.via.join('·')}`).join(', ') || 'none');
console.log('links with a wall and no gate:', pathways.filter(p => p.gates !== p.via.length - 1).map(p => `${p.from}→${p.to}`).join(', ') || 'none');

const panel = page.locator('.panel');
const shot = name => panel.screenshot({ path: `${dir}stills/${name}.png` });
await shot('resting');
await page.evaluate(() => window.mock.select('wrench', 8)); await shot('wrench-arcs');
await page.evaluate(() => window.mock.select('gate', 7)); await shot('gate-contracts');
await page.evaluate(() => window.mock.select('road', 15)); await shot('road-contracts');
await page.evaluate(() => window.mock.select('territory', 1)); await shot('territory-open');
await page.evaluate(() => window.mock.sample(true));
await page.evaluate(() => window.mock.select('wrench', 1)); await shot('sample-every-state-and-wrench-arcs');
await page.evaluate(() => { window.mock.sample(false); window.mock.select(null); });
await page.screenshot({ path: `${dir}stills/page.png` });
await browser.close();
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
