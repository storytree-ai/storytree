// node --import tsx shorts/memory/render.mjs
// Renders the third short, "memory that lives where your code lives" (claim 3 on storytree.dev, increment_f474a8e4b7e7, ADR-1104 D2).
// Into this folder: the 1920×1080 MP4 the site serves on claim 3 (build.ts copies it) and that social media can take, its
// poster frame and measurements.json (sizes, render times, broken pixel blocks in each still); a lossless still of each beat
// goes to the package's evidence set of this name, which nothing reads.
// After changing its script or scene, a pose (../first-short/assemble-cast.mjs) or the forest's drawing, run this again and
// commit what it writes.
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POSTER } from "../../src/shorts/memory.ts";
import { THIRD_SHORT } from "../../src/shorts/root.tsx";
import { brokenBlocks, bundleShorts, renderPng, renderVideo, rgbOf } from "../../src/shorts/render.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const stillsFolder = path.join(here, "../../evidence", "memory");
await mkdir(stillsFolder, { recursive: true });
const NAME = THIRD_SHORT.id;
/** One still per beat, in seconds: the same job given, the change that tidied the reason away beside Checkout's panel opening on
 * the map, the question beside the panel's code and memory, no answer beside the change that kept the reason, the memory file
 * beside the next job, the bug come back beside the agent planning by the same memory, the end card. */
const BEATS = { "the-job": 9, "tidied-away": 17, "code-and-memory": 24, "no-answer": 32, "memory-file": 40, "bug-is-back": 48, "end-card": 51 };

const timed = async run => { const start = performance.now(); await run(); return Math.round(performance.now() - start) / 1000; };
let serveUrl;
const seconds = {
  bundle: await timed(async () => { serveUrl = await bundleShorts(); }),
  poster: await timed(() => renderPng(serveUrl, THIRD_SHORT.id, Math.round(POSTER * THIRD_SHORT.fps), path.join(here, `${NAME}-poster.png`), 0.5)),
  mp4: await timed(() => renderVideo(serveUrl, THIRD_SHORT.id, "h264", path.join(here, `${NAME}-1080p.mp4`), { crf: 18 })),
};
const stills = [];
for (const [beat, at] of Object.entries(BEATS)) {
  const still = path.join(stillsFolder, `still-${beat}.png`);
  await renderPng(serveUrl, THIRD_SHORT.id, Math.round(at * THIRD_SHORT.fps), still);
  stills.push({ beat, seconds: at, file: path.basename(still), brokenBlocks: brokenBlocks(await rgbOf(still)).length });
}
const bytes = {};
for (const file of [`${NAME}-poster.png`, `${NAME}-1080p.mp4`]) bytes[file] = (await stat(path.join(here, file))).size;
await writeFile(path.join(here, "measurements.json"), JSON.stringify({ renderedAt: new Date().toISOString(), composition: THIRD_SHORT, seconds, bytes, stills }, null, 2) + "\n");
console.log(JSON.stringify({ seconds, bytes, stills }, null, 2));
