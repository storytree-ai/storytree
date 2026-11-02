// Captures the stills kept beside the ink map: at rest, the wrench's arcs, a gate's and a road's contracts, a territory open.
// Run from the checkout root: node docs/design/capability-tree-medieval/d-ink-map/tools/shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The website package is the one that depends on the browser driver.
const { chromium } = createRequire(resolve('packages/website/package.json'))('playwright-core');

const dir = 'docs/design/capability-tree-medieval/d-ink-map/';
mkdirSync(dir + 'stills', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(pathToFileURL(resolve(dir + 'index.html')).href);
await page.waitForFunction(() => window.inkMap !== undefined);
// JPEG, since the parchment's grain makes a PNG of the sheet about a megabyte.
const shot = (name) => page.screenshot({ path: `${dir}stills/${name}.jpg`, type: 'jpeg', quality: 88 });
// Each still is reached by a real click on the drawn mark, so the clicks are proved as they are captured.
const click = async (selector) => { const box = await page.locator(selector).first().boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); };

await shot('resting');
await click('[data-hit^="wrench:"]');
await shot('wrench-arcs');
// The road from Library API to Work model: its gate.
const road = await page.evaluate(() => window.inkMap.roads.findIndex((r) => r.to !== null && window.inkMap.caps[r.from].number === '7' && window.inkMap.caps[r.to].number === '4'));
await click(`circle[data-hit="road:${road}"]`);
await shot('gate-contracts');
const abroad = await page.evaluate(() => window.inkMap.roads.findIndex((r) => r.abroad));
await click(`path[data-hit="road:${abroad}"]`);
await shot('road-abroad-contracts');
const territory = await page.evaluate(() => window.inkMap.caps.findIndex((c) => c.number === '1'));
// A territory's open land, away from its name and roads: a point a little inside its first corner.
const corner = await page.evaluate((i) => { const poly = window.inkMap.polys[i], [hx, hy] = window.inkMap.hearts[i], [x, y] = poly[0]; return [hx + (x - hx) * 0.8, hy + (y - hy) * 0.8]; }, territory);
const box = await page.locator('#map').boundingBox();
const scale = Math.min(box.width / 1030, box.height / 790), left = box.x + (box.width - 1030 * scale) / 2, top = box.y + (box.height - 790 * scale) / 2;
await page.mouse.click(left + corner[0] * scale, top + corner[1] * scale);
await shot('territory-open');
const misfit = (await page.evaluate(() => window.inkMap.fit())).filter(({ want, got }) => Math.abs(got - want) > want * 0.03);
console.log(misfit.length ? 'areas off their share by more than 3%: ' + JSON.stringify(misfit) : 'every territory within 3% of its share');
console.log('panel:', (await page.locator('#panel').innerText()).slice(0, 200).replace(/\n/g, ' | '));
await browser.close();
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
