// Round 13's page measures: opens the built page once for each query given (each an arrangement and its prices), at rest,
// and prints what the layer counts there: the roads, the gates and the crowding (overlay.ts, `crowding`), as JSON lines;
// with --out <file>, writes them to it too.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/crowd.mjs '?layout=r11' '?layout=min5' …
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { pageFolder } from './page-folder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const args = process.argv.slice(2), outAt = args.indexOf('--out'), outFile = outAt >= 0 ? args.splice(outAt, 2)[1] : undefined;
const rows = [];
await withCapture({ dist: pageFolder(), folder: path.join(dist, 'stills', 'looks') }, async ({ browser, origin, settle }) => {
  for (const query of args) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.stack ?? e)));
    await page.goto(`${origin}/index.html${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180000 }).catch(e => { console.error(errors); throw e; });
    await settle(page, 12);
    const s = await page.evaluate(() => { const st = window.mock.layer.stats; return { roadDrawn: st.roadDrawn, roadOnEdge: st.roadOnEdge, noEntrance: st.noEntrance.length, segments: st.segments, gates: st.gates, entranceGates: st.entranceGates, passGates: st.passGates, gatesOnOpenLand: st.gatesOnOpenLand, sharedEntrances: st.sharedEntrances, overThird: st.overThird.length, crowding: window.mock.layer.crowding() }; });
    const row = { query, ...s, errors };
    rows.push(row);
    console.log(JSON.stringify(row));
    await page.close();
  }
});
if (outFile) writeFileSync(outFile, JSON.stringify(rows, null, 1) + '\n');
