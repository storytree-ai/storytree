// Rollout 1: opens the built page on every story's island as the map draws it today (`?story=<id>&layout=today`), reads
// where the map's own sea lanes come ashore there (docks.ts, `mock.docks()`), and writes them to docks.json for the layout
// tool; with --stills, also a still of each island at rest into stills/today/<id>.png.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/docks.mjs [--stills] [story ...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const args = process.argv.slice(2), stills = args.includes('--stills'), asked = args.filter(a => !a.startsWith('--'));
const data = JSON.parse(readFileSync(path.join(dist, 'data.json'), 'utf8'));
const file = path.join(dist, 'docks.json');
const docks = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const ids = asked.length ? asked : Object.keys(data.stories);
await withCapture({ dist, folder: path.join(dist, 'stills', 'today') }, async ({ browser, origin, out, settle }) => {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.stack ?? e)));
    await page.goto(`${origin}/index.html?story=${id}&layout=today&real`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180000 }).catch(e => { console.error(errors); throw e; });
    for (let k = 0; k < 200 && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
    // The lanes are drawn once the roads are routed; read them when two readings agree.
    let read = [], last = '';
    for (let k = 0; k < 60; k++) { await settle(page, 6); read = await page.evaluate(() => window.mock.docks()); const key = JSON.stringify(read); if (key === last && read.length) break; last = key; }
    docks[id] = read;
    console.log(`${data.stories[id].story.title}: ${read.map(d => `${d.lanes.length} (${d.lanes.filter(l => l.dir === 'down').length} in) at ${d.at.x},${d.at.z}`).join('; ')}${errors.length ? ` errors: ${errors.length}` : ''}`);
    if (stills) await page.screenshot({ path: path.join(out, `${id}.png`) });
    await page.close();
  }
});
writeFileSync(file, JSON.stringify(docks, null, 1) + '\n');
