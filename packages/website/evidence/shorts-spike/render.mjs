// node --import tsx packages/website/evidence/shorts-spike/render.mjs
// Renders the pipeline spike (increment_a71ac162509a) into this folder: the clip as H.264 MP4 and VP9 WebM, a poster PNG,
// lossless stills with a ×4 zoomed crop of each from the PNG, the MP4 and the WebM, and measurements.json (sizes, render
// times, the machine, how many 6×6 blocks each encoding breaks exactly and visibly, and whether two renders of a frame are pixel-identical).
import { execFileSync } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RenderInternals } from "@remotion/renderer";
import { SPIKE } from "../../src/shorts/root.tsx";
import { brokenBlocks, bundleShorts, ffmpeg, renderPng, renderVideo, rgbOf } from "../../src/shorts/render.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = name => path.join(here, name);
const timed = async run => { const start = performance.now(); await run(); return Math.round(performance.now() - start) / 1000; };
const size = async name => (await stat(out(name))).size;
/** The stills: windows starting to pile up, the island lit, the last frame. */
const STILLS = [30, 90, 149];
/** The crop, in 1920×1080 pixels: the lit island's coast, a road and the dark sea meet here. */
const CROP = { x: 1320, y: 520, width: 240, height: 240, zoom: 4 };
/** A block is visibly broken when a pixel strays more than this from the block's first, in some channel. */
const VISIBLE = 24;
/** The first frame of a video at or after `frame`: an accurate seek lands on the frame whose time is just past this. */
const seekTo = frame => String(Math.max(0, frame / SPIKE.fps - 0.001));
const crop = (input, output, seconds) => ffmpeg(["-y", ...(seconds === undefined ? [] : ["-ss", seconds]), "-i", input, "-frames:v", "1",
  "-vf", `crop=${CROP.width}:${CROP.height}:${CROP.x}:${CROP.y},scale=iw*${CROP.zoom}:ih*${CROP.zoom}:flags=neighbor`, output]);

const machine = { host: os.hostname(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30),
  platform: `${os.platform()} ${os.release()}`, node: process.version,
  systemFfmpeg: (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })(),
  remotionFfmpeg: path.relative(path.resolve(here, "../../../.."), RenderInternals.getExecutablePath({ type: "ffmpeg", indent: false, logLevel: "error", binariesDirectory: null })) };
let serveUrl;
const seconds = {
  bundle: await timed(async () => { serveUrl = await bundleShorts(); }),
  mp4: await timed(() => renderVideo(serveUrl, SPIKE.id, "h264", out("spike.mp4"))),
  webm: await timed(() => renderVideo(serveUrl, SPIKE.id, "vp9", out("spike.webm"))),
  poster: await timed(() => renderPng(serveUrl, SPIKE.id, 100, out("poster.png"))),
};
const stills = [];
for (const frame of STILLS) {
  const still = `still-${frame}.png`;
  await renderPng(serveUrl, SPIKE.id, frame, out(still));
  const again = path.join(os.tmpdir(), `shorts-again-${frame}.png`);
  await renderPng(serveUrl, SPIKE.id, frame, again);
  const lossless = await rgbOf(out(still));
  const identical = lossless.equals(await rgbOf(again));
  await rm(again, { force: true });
  const blocks = (lossless.length / 3) / 36;
  const broken = { png: brokenBlocks(lossless).length }, visiblyBroken = { png: brokenBlocks(lossless, VISIBLE).length };
  for (const [kind, video] of [["mp4", "spike.mp4"], ["webm", "spike.webm"]]) {
    const decoded = await rgbOf(out(video), seekTo(frame));
    broken[kind] = brokenBlocks(decoded).length;
    visiblyBroken[kind] = brokenBlocks(decoded, VISIBLE).length;
    await crop(out(video), out(`crop-${frame}-${kind}.png`), seekTo(frame));
  }
  await crop(out(still), out(`crop-${frame}-png.png`));
  stills.push({ frame, still, identicalOnRerender: identical, blocks, brokenBlocks: broken, visiblyBroken });
}
const files = {};
for (const name of ["spike.mp4", "spike.webm", "poster.png", ...STILLS.map(frame => `still-${frame}.png`)]) files[name] = await size(name);
await mkdir(here, { recursive: true });
await writeFile(out("measurements.json"), JSON.stringify({ renderedAt: new Date().toISOString(), composition: SPIKE, machine, seconds, bytes: files, stills }, null, 2) + "\n");
console.log(JSON.stringify({ seconds, bytes: files, stills }, null, 2));
