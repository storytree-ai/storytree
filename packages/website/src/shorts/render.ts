/** Capability 6 · Pixel-art shorts. Renders the shorts from Node with Remotion: one bundle of the compositions, then
 * stills and videos from it, and the pixels of a still read back through Remotion's own bundled ffmpeg. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { RenderInternals, renderMedia, renderStill, selectComposition, type Codec } from "@remotion/renderer";
import { LOW, SCALE } from "./split-screen.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Bundles the compositions once for any number of renders; the workspace's TypeScript names its imports `.js`. */
export function bundleShorts(): Promise<string> {
  return bundle({
    entryPoint: path.join(here, "index.ts"),
    publicDir: path.join(here, "public"),
    webpackOverride: config => ({ ...config, resolve: { ...config.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"] } } }),
  });
}

/** Chrome's software WebGL, the same on every machine, so a frame is the same pixels wherever it renders. */
const chromiumOptions = { gl: "swangle" } as const;

/** One frame of a composition as a lossless PNG, rendered in a browser of its own. */
export async function renderPng(serveUrl: string, id: string, frame: number, output?: string): Promise<Buffer> {
  const composition = await selectComposition({ serveUrl, id, chromiumOptions, logLevel: "error" });
  const { buffer } = await renderStill({ serveUrl, composition, frame, imageFormat: "png", output: output ?? null, chromiumOptions, logLevel: "error", overwrite: true });
  return buffer ?? Buffer.from(await (await import("node:fs/promises")).readFile(output!));
}

/** The whole composition as a video: H.264 MP4 or VP9 WebM. */
export async function renderVideo(serveUrl: string, id: string, codec: Extract<Codec, "h264" | "vp9">, output: string): Promise<void> {
  const composition = await selectComposition({ serveUrl, id, chromiumOptions, logLevel: "error" });
  await renderMedia({ serveUrl, composition, codec, outputLocation: output, chromiumOptions, logLevel: "error", overwrite: true,
    imageFormat: "png", ...(codec === "h264" ? { crf: 16 } : { crf: 20 }) });
}

/** Runs Remotion's bundled ffmpeg: no system install is needed. */
export async function ffmpeg(args: string[]): Promise<Buffer> {
  const run = RenderInternals.callFf({ bin: "ffmpeg", args: ["-hide_banner", "-loglevel", "error", ...args], indent: false, logLevel: "error",
    binariesDirectory: null, cancelSignal: undefined, options: { encoding: "buffer" } as never });
  return (await run).stdout as unknown as Buffer;
}

/** A picture's pixels as packed RGB, decoded by ffmpeg from any file it reads (a PNG, or one frame of a video at `seconds`). */
export async function rgbOf(file: string, seconds?: number): Promise<Buffer> {
  return ffmpeg([...(seconds === undefined ? [] : ["-ss", String(seconds)]), "-i", file, "-frames:v", "1", "-f", "image2pipe", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
}

/** Where `rgb` (1920×1080) breaks the pixel grid: the top-left corner of each SCALE×SCALE block holding more than one colour,
 * or, given a `tolerance`, a pixel straying further than that from the block's first in some channel (lossy video never keeps exact values). */
export function brokenBlocks(rgb: Buffer, tolerance = 0, width = LOW.width * SCALE, height = LOW.height * SCALE): { x: number; y: number }[] {
  if (rgb.length !== width * height * 3) throw new Error(`Expected ${width}×${height} RGB, got ${rgb.length} bytes`);
  const broken: { x: number; y: number }[] = [];
  for (let by = 0; by < height; by += SCALE) for (let bx = 0; bx < width; bx += SCALE) {
    const first = (by * width + bx) * 3;
    block: for (let y = by; y < by + SCALE; y++) for (let x = bx; x < bx + SCALE; x++) {
      const at = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) if (Math.abs(rgb[at + c]! - rgb[first + c]!) > tolerance) { broken.push({ x: bx, y: by }); break block; }
    }
  }
  return broken;
}
