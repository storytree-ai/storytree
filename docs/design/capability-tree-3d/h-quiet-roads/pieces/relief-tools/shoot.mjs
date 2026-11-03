// Stills of relief.html in the capture kit's Chromium: pieces/stills/relief-sheet.png (the six panels with captions) and
// pieces/stills/relief-close.png (the close-up row).
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/h-quiet-roads/pieces/relief-tools/shoot.mjs
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here), stills = path.join(dist, 'stills');
mkdirSync(stills, { recursive: true });
await withCapture({ dist, folder: stills }, async ({ browser, origin, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack ?? e)));
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message')) errors.push(m.text()); });
  await page.goto(`${origin}/relief.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 }).catch(e => { console.error(errors); throw e; });
  await settle(page, 4);
  if (process.argv.includes('--info')) console.log(JSON.stringify(await page.evaluate(() => window.relief)));
  for (const [id, name] of [['sheet', 'relief-sheet'], ['close', 'relief-close']]) {
    const file = path.join(stills, `${name}.png`);
    await page.locator(`#${id}`).screenshot({ path: file });
    console.error(file);
  }
  if (errors.length) console.error(errors.join('\n'));
});
