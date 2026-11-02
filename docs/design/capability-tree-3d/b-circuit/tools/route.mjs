// Searches for the calmest routing once (several orders, then rip-up and reroute) and saves it to routes.js, which the
// page draws from instead of routing at load. Rerun after measure.mjs/build.mjs or any layout change; the page falls
// back to routing live when the saved grid no longer matches. Run from the checkout root:
// node docs/design/capability-tree-3d/b-circuit/tools/route.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const dir = resolve('docs/design/capability-tree-3d/b-circuit');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => console.log(m.text()));
page.on('pageerror', (e) => console.log('error', e.message));
await page.goto(pathToFileURL(dir + '/index.html').href + '?search');
await page.waitForFunction(() => window.__board, null, { timeout: 600000 });
const routes = await page.evaluate(() => window.__board.exportRoutes());
writeFileSync(dir + '/routes.js', 'window.CAPTREE_ROUTES = ' + JSON.stringify(routes) + ';\n');
console.log('grid', routes.grid, 'orders scored', routes.tried, 'best after rip-up', routes.score, 'ms', await page.evaluate(() => window.__board.routeMs));
await browser.close();
