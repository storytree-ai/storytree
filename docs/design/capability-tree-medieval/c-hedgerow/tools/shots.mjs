// Captures the stills kept beside the hedgerow mock: the resting view, then each kind of click open.
// Run from the checkout root: node docs/design/capability-tree-medieval/c-hedgerow/tools/shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The website package is the one that depends on the browser driver.
const { chromium } = createRequire(resolve('packages/website/package.json'))('playwright-core');

const dir = 'docs/design/capability-tree-medieval/c-hedgerow/';
mkdirSync(dir + 'stills', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 760, height: 1100 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(pathToFileURL(resolve(dir + 'index.html')).href);
await page.waitForFunction(() => window.mock?.ready === true);
const shot = (name) => page.locator('.panel').screenshot({ path: `${dir}stills/${name}.png` });

await shot('resting');
// Each click is a real click on the drawn mark, so the stills prove the page's own handlers.
const wrench = (await page.evaluate(() => window.mock.wrenches()))[0];
if (wrench) { await page.locator(`[data-wrench="${wrench}"]`).click(); await shot('wrench-arcs'); }
const busiest = (await page.evaluate(() => window.mock.gates())).sort((a, b) => b.links - a.links)[0];
await page.locator(`[data-gate="${busiest.key}"]`).click({ force: true }); await shot('gate-contracts');
const track = (await page.evaluate(() => window.mock.legs()))[0];
await page.locator(`[data-leg="${track}"]`).click({ force: true }); await shot('track-contracts');
await page.locator('.road-end').first().click(); await shot('road-contracts');
// The largest field, clicked where it is clear of its tracks and labels.
await page.evaluate(() => document.querySelector('.field').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await shot('territory');

console.log(`area error at most ${(await page.evaluate(() => window.mock.areaError) * 100).toFixed(1)}%`);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
