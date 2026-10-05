// The website's globe at a phone's width (390 x 844), before and after the flat canvas went. Build the site, copy
// packages/website/dist to dist/website-<label>, then: node --import tsx capture-website.mjs <label> [--retake]
// It skips the tour to free play on the shop and pictures the settled globe.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, captureOutput } from '../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] ?? 'after';
const dist = path.join(here, 'dist', `website-${label.replace(/\d+$/, '')}`);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  try { res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
await page.addInitScript(() => localStorage.setItem('storytree-opening-seen', 'yes'));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 90_000 });
await page.locator('#tour-skip').click();
await page.waitForTimeout(8000);
await page.screenshot({ path: path.join(captureOutput(here), `${label}-website-390.png`) });
await browser.close(); server.close();
