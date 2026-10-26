// node --import tsx packages/website/shorts/first-short/render.mjs
// Renders the first short, "seeing what agents built" (increment_9294d76b04cf, reworked in increment_4695144e6847, polished in
// increment_ea834305fe2d and increment_fa48e88589f9; re-cut to open on a brand-new project in increment_baeb6376f044). Into this
// folder: the 1920×1080 MP4 the site serves on claim 1 (build.ts copies it) and that social media can take, its poster
// frame and measurements.json (sizes, render times, broken pixel blocks in each still); a lossless still of each beat goes
// to the package's evidence set of this name, which nothing reads.
// After changing a scene, a pose (assemble-cast.mjs) or the forest's drawing, run this again and commit what it writes.
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_SHORT } from "../../src/shorts/root.tsx";
import { brokenBlocks, bundleShorts, renderPng, renderVideo, rgbOf } from "../../src/shorts/render.ts";
import { POSTER } from "../../src/shorts/script.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const stillsFolder = path.join(here, "../../evidence", "first-short");
await mkdir(stillsFolder, { recursive: true });
const NAME = "seeing-what-agents-built";
/** One still per beat, in seconds: the opening (both ask a brand-new project for a shop), the storytree side's map empty, growing
 * and grown with the wishlist last, the island clicked, its panel, its capability graph, "looks about right", the two prompts, the
 * walk out, Claude's questions on the left while it works on the right, the end card. */
const BEATS = { opening: 4.5, "map-empty": 5.4, "map-growing": 7, "map-grown": 9.7, "map-full-view": 12, "panel-open": 14, "capability-graph": 17, "about-right": 20.5, "long-prompt": 27,
  "short-prompt": 32, "leaves-the-room": 41.6, "claude-asks": 44, "claude-works": 50, "end-card": 54 };

const timed = async run => { const start = performance.now(); await run(); return Math.round(performance.now() - start) / 1000; };
let serveUrl;
const seconds = {
  bundle: await timed(async () => { serveUrl = await bundleShorts(); }),
  poster: await timed(() => renderPng(serveUrl, FIRST_SHORT.id, Math.round(POSTER * FIRST_SHORT.fps), path.join(here, `${NAME}-poster.png`), 0.5)),
  socialMp4: await timed(() => renderVideo(serveUrl, FIRST_SHORT.id, "h264", path.join(here, `${NAME}-1080p.mp4`), { crf: 18 })),
};
const stills = [];
for (const [beat, at] of Object.entries(BEATS)) {
  const still = path.join(stillsFolder, `still-${beat}.png`);
  await renderPng(serveUrl, FIRST_SHORT.id, Math.round(at * FIRST_SHORT.fps), still);
  stills.push({ beat, seconds: at, file: path.basename(still), brokenBlocks: brokenBlocks(await rgbOf(still)).length });
}
const bytes = {};
for (const file of [`${NAME}-poster.png`, `${NAME}-1080p.mp4`]) bytes[file] = (await stat(path.join(here, file))).size;
await writeFile(path.join(here, "measurements.json"), JSON.stringify({ renderedAt: new Date().toISOString(), composition: FIRST_SHORT, seconds, bytes, stills }, null, 2) + "\n");
console.log(JSON.stringify({ seconds, bytes, stills }, null, 2));
