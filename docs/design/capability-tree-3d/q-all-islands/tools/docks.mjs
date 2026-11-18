import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { pageFolder } from './page-folder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const args = process.argv.slice(2), stills = args.includes('--stills'), searched = args.includes('--searched'), asked = args.filter(a => !a.startsWith('--'));
const data = JSON.parse(readFileSync(path.join(dist, 'data.json'), 'utf8'));
const file = path.join(dist, 'docks.json');
const docks = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const ids = asked.length ? asked : Object.keys(data.stories);
await withCapture({ dist: pageFolder(), folder: path.join(dist, 'stills', 'today') }, async ({ browser, origin, out, settle }) => {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.stack ?? e)));
    await page.goto(`${origin}/index.html?story=${id}&layout=today&real`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180000 }).catch(e => { console.error(errors); throw e; });
    for (let k = 0; k < 200 && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
    let read = [], last = '';
    for (let k = 0; k < 60; k++) { await settle(page, 6); read = await page.evaluate(() => window.mock.docks()); const key = JSON.stringify(read); if (key === last && read.length) break; last = key; }
    docks[id] = read;
    console.log(`${data.stories[id].story.title}: ${read.map(d => `${d.lanes.length} (${d.lanes.filter(l => l.dir === 'down').length} in) at ${d.at.x},${d.at.z}`).join('; ')}${errors.length ? ` errors: ${errors.length}` : ''}`);
    if (searched) {
      const t0 = Date.now();
      await page.waitForFunction((story) => localStorage.getItem(`storytree.territories.${story}`) !== null, id, { timeout: 900000, polling: 2000 });
      for (let k = 0; k < 10; k++) await settle(page, 6);
      console.log(`  searched in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    if (stills) await page.screenshot({ path: path.join(out, `${id}.png`) });
    await page.close();
  }
  const to = args.includes('--retake') ? file : path.join(out, 'docks.json');
  writeFileSync(to, JSON.stringify(docks, null, 1) + '\n');
  console.error(`docks written to ${to}`);
});
