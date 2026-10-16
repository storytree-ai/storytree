// node --import tsx packages/website/evidence/first-short/render.mjs
// Renders the first short, "seeing what agents built" (increment_9294d76b04cf). Into packages/website/public/shorts: the
// site's cut at 960×540 (×3) as VP9 WebM and H.264 MP4, and its poster. Into this folder: the 1920×1080 MP4 for social
// media, a lossless still of each beat, and measurements.json (sizes, render times, broken pixel blocks in each still).
// After changing a scene, a pose (assemble-cast.mjs) or the forest's drawing, run this again and commit what it writes.
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_SHORT } from "../../src/shorts/root.tsx";
import { brokenBlocks, bundleShorts, renderPng, renderVideo, rgbOf } from "../../src/shorts/render.ts";
import { POSTER } from "../../src/shorts/script.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "../../public/shorts");
const NAME = "seeing-what-agents-built";
/** One still per beat, in seconds: the start, each question and its answer, the typing, the end card. */
const BEATS = { opening: 0.8, upstream: 4.5, "does-what": 8.5, "what-it-means": 13.5, "typing-to-the-agent": 18, done: 21, "end-card": 24 };

const timed = async run => { const start = performance.now(); await run(); return Math.round(performance.now() - start) / 1000; };
await mkdir(site, { recursive: true });
let serveUrl;
const seconds = {
  bundle: await timed(async () => { serveUrl = await bundleShorts(); }),
  siteWebm: await timed(() => renderVideo(serveUrl, FIRST_SHORT.id, "vp9", path.join(site, `${NAME}.webm`), { scale: 0.5, crf: 30 })),
  siteMp4: await timed(() => renderVideo(serveUrl, FIRST_SHORT.id, "h264", path.join(site, `${NAME}.mp4`), { scale: 0.5, crf: 23 })),
  poster: await timed(() => renderPng(serveUrl, FIRST_SHORT.id, Math.round(POSTER * FIRST_SHORT.fps), path.join(site, `${NAME}.png`), 0.5)),
  socialMp4: await timed(() => renderVideo(serveUrl, FIRST_SHORT.id, "h264", path.join(here, `${NAME}-1080p.mp4`), { crf: 18 })),
};
const stills = [];
for (const [beat, at] of Object.entries(BEATS)) {
  const still = path.join(here, `still-${beat}.png`);
  await renderPng(serveUrl, FIRST_SHORT.id, Math.round(at * FIRST_SHORT.fps), still);
  stills.push({ beat, seconds: at, file: path.basename(still), brokenBlocks: brokenBlocks(await rgbOf(still)).length });
}
const bytes = {};
for (const file of [`${NAME}.webm`, `${NAME}.mp4`, `${NAME}.png`]) bytes[`public/shorts/${file}`] = (await stat(path.join(site, file))).size;
bytes[`${NAME}-1080p.mp4`] = (await stat(path.join(here, `${NAME}-1080p.mp4`))).size;
await writeFile(path.join(here, "measurements.json"), JSON.stringify({ renderedAt: new Date().toISOString(), composition: FIRST_SHORT, seconds, bytes, stills }, null, 2) + "\n");
console.log(JSON.stringify({ seconds, bytes, stills }, null, 2));
