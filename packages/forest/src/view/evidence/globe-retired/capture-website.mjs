// The website's map before and after the globe's code was deleted (increment_093d5b3b28d8), at a laptop's and a phone's width.
// Build the site, copy packages/website/dist somewhere, then run from the checkout root:
//   node --import tsx packages/forest/src/view/evidence/globe-retired/capture-website.mjs <copied dist> <before|after> --retake
// It skips the tour to free play on storytree's own sheet and pictures it settled.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, captureOutput } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dist, label] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (dist === undefined || !['before', 'after'].includes(label)) throw new Error('Name the copied website dist, then before or after.');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  try { res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await launch();
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('storytree-opening-seen', 'yes'));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('#website-forest')?.dataset.forestState === 'live', null, { timeout: 120_000 });
    await page.locator('#tour-skip').click();
    await page.waitForTimeout(8000);
    await page.screenshot({ path: path.join(captureOutput(here), `${label}-website-${viewport.width}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
