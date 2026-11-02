// Finds the seeds the territories grow from (territory-plan.ts) by a long search in the built page, where the road off the
// coast knows where Keys lies, and stores them in data.json, so the page grows the same cut at once on every load.
// Run from the checkout root, after build.mjs: node --import tsx docs/design/capability-tree-3d/a-stone/tools/seed.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here), file = path.join(dist, 'data.json');
await withCapture({ dist, folder: path.join(dist, 'stills', 'looks') }, async ({ browser, origin }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/index.html?seed`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 600000 });
  const stats = await page.evaluate(() => window.mock.layer.stats);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.seeds = stats.seeds;
  writeFileSync(file, JSON.stringify(data) + '\n');
  const { seeds, ...rest } = stats;
  console.log(JSON.stringify(rest));
});
