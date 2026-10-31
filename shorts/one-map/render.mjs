// node --import tsx shorts/one-map/render.mjs
// Renders the second short, "one map for you and your agents" (claim 2 on storytree.dev, increment_761f3f5755c8, ADR-1104 D2).
// Into this folder: the 1920×1080 MP4 the site serves on claim 2 (build.ts copies it) and that social media can take, its
// poster frame and measurements.json (sizes, render times, broken pixel blocks in each still); a lossless still of each beat
// goes to the package's evidence set of this name, which nothing reads.
// After changing its script or scene, a pose (../first-short/assemble-cast.mjs) or the forest's drawing, run this again and
// commit what it writes.
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POSTER } from "../../src/shorts/one-map.ts";
import { SECOND_SHORT } from "../../src/shorts/root.tsx";
import { brokenBlocks, bundleShorts, renderPng, renderVideo, rgbOf } from "../../src/shorts/render.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const stillsFolder = path.join(here, "../../evidence", "one-map");
await mkdir(stillsFolder, { recursive: true });
const NAME = SECOND_SHORT.id;
/** One still per beat, in seconds: the two jobs given, the diffs piling up while the second agent is told the part is claimed,
 * the review beside both claims on the map, the file changing under it, the question and the first agent letting its part go,
 * the claims moved on the map, the tangle beside the small review, the end card. */
const BEATS = { "two-jobs": 8, "claim-refused": 18, "claims-on-the-map": 24, "changed-underneath": 29, "who-changed-it": 36,
  "claim-moved": 41, "small-review": 50, "end-card": 55 };

const timed = async run => { const start = performance.now(); await run(); return Math.round(performance.now() - start) / 1000; };
let serveUrl;
const seconds = {
  bundle: await timed(async () => { serveUrl = await bundleShorts(); }),
  poster: await timed(() => renderPng(serveUrl, SECOND_SHORT.id, Math.round(POSTER * SECOND_SHORT.fps), path.join(here, `${NAME}-poster.png`), 0.5)),
  mp4: await timed(() => renderVideo(serveUrl, SECOND_SHORT.id, "h264", path.join(here, `${NAME}-1080p.mp4`), { crf: 18 })),
};
const stills = [];
for (const [beat, at] of Object.entries(BEATS)) {
  const still = path.join(stillsFolder, `still-${beat}.png`);
  await renderPng(serveUrl, SECOND_SHORT.id, Math.round(at * SECOND_SHORT.fps), still);
  stills.push({ beat, seconds: at, file: path.basename(still), brokenBlocks: brokenBlocks(await rgbOf(still)).length });
}
const bytes = {};
for (const file of [`${NAME}-poster.png`, `${NAME}-1080p.mp4`]) bytes[file] = (await stat(path.join(here, file))).size;
await writeFile(path.join(here, "measurements.json"), JSON.stringify({ renderedAt: new Date().toISOString(), composition: SECOND_SHORT, seconds, bytes, stills }, null, 2) + "\n");
console.log(JSON.stringify({ seconds, bytes, stills }, null, 2));
