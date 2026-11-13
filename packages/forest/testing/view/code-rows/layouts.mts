// Refreshes a shared capture seed's layouts.json.gz: opens the seeded desktop page with nothing kept, lets every island's
// territory search and roads run until the map says it has settled (3.98), and writes the island layouts and roads the
// page kept (its localStorage `storytree.territories.*` and `storytree.roads.*` entries) beside that seed. A capture on
// the seed then opens with them kept and searches nothing it holds. On the Mint box the forest seed takes about ten
// minutes, code-rows longer: the searches run one at a time.
// Run: node --import tsx layouts.mts <code-rows|forest>. Rerun after a seed's own refresh, or a change to the search's
// score, which leaves every kept arrangement searched again.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureSeed, pageStorage, runCapture, seedLayoutsFile, settledMap, type CaptureSeedName } from '../../../../../apps/desktop/src/capture/index.ts';

const name = process.argv[2] as CaptureSeedName;
if (name !== 'code-rows' && name !== 'forest') throw new Error('name the seed to refresh: code-rows or forest');
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = buildFolder(here, 'layouts');
await buildCapture({ dist });
const { seed, survey } = captureSeed(name);
let layouts: Record<string, string> = {};
await runCapture({
  folder: here, dist, seed, survey, views: [], layouts: {},
  prepare: async ({ page }) => {
    await settledMap(page, { frames: 30, timeoutMs: 60 * 60_000 });
    layouts = Object.fromEntries(Object.entries(await pageStorage(page)).filter(([key]) => /^storytree\.(territories|roads)\./.test(key)));
  },
});
writeFileSync(seedLayoutsFile(name), gzipSync(JSON.stringify(layouts, null, 1) + '\n'));
console.log(`Kept ${Object.keys(layouts).length} entries for ${name} in ${seedLayoutsFile(name)}.`);
