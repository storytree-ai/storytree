/** Capability 6 · Pixel-art shorts. Renders the shorts from Node with Remotion: one bundle of the compositions, then
 * stills and videos from it, and the pixels of a still read back through Remotion's own bundled ffmpeg. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { RenderInternals, renderMedia, renderStill, selectComposition, type ChromeMode, type Codec } from "@remotion/renderer";
import { LOW, SCALE } from "./script.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Bundles the compositions once for any number of renders; the workspace's TypeScript names its imports `.js`. */
export function bundleShorts(): Promise<string> {
  return bundle({
    entryPoint: path.join(here, "root.tsx"),
    publicDir: path.join(here, "public"),
    webpackOverride: config => ({ ...config, resolve: { ...config.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"] } } }),
  });
}

/** Chrome's software WebGL, the same on every machine, so a frame is the same pixels wherever it renders. */
const chromiumOptions = { gl: "swangle" } as const;
/** How long a page may take to draw its first frame: software WebGL on a slow machine (a macOS CI runner) passes Remotion's 30 seconds. */
const timeoutInMilliseconds = 180_000;

export interface Machine {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exists: (file: string) => boolean;
  /** The folder of Remotion's Windows x64 binaries (its ffmpeg and compositor), installed beside the renderer. */
  readonly x64Binaries: () => string;
}

const THIS_MACHINE: Machine = {
  platform: process.platform, arch: process.arch, env: process.env, exists: existsSync,
  x64Binaries: () => {
    const fromRenderer = createRequire(createRequire(import.meta.url).resolve("@remotion/renderer"));
    return (fromRenderer("@remotion/compositor-win32-x64-msvc") as { dir: string }).dir;
  },
};

export interface RemotionSetup {
  readonly browserExecutable: string | null;
  readonly chromeMode: ChromeMode;
  readonly binariesDirectory: string | null;
}

/** How Remotion renders on `machine`: in its own Chrome Headless Shell (downloaded on first use) with its own native binaries,
 * except on Windows arm64, which Remotion builds neither for. There it renders in the installed Chrome (the channel the forest's
 * browser smokes use), in Chrome's new headless mode since the old one is the Headless Shell's alone, and runs its Windows x64
 * binaries, which Windows on arm64 emulates. */
export function remotionOn({ platform, arch, env, exists, x64Binaries }: Machine = THIS_MACHINE): RemotionSetup {
  if (platform !== "win32" || arch !== "arm64") return { browserExecutable: null, chromeMode: "headless-shell", binariesDirectory: null };
  const installs = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(root => root !== undefined)
    .map(root => path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe"));
  const chrome = installs.find(exists);
  if (chrome === undefined) throw new Error(`Remotion builds no Chrome Headless Shell for Windows arm64, and no installed Chrome was found at ${installs.join(", ")}`);
  return { browserExecutable: chrome, chromeMode: "chrome-for-testing", binariesDirectory: x64Binaries() };
}

/** One frame of a composition as a lossless PNG, rendered in a browser of its own; `scale` 0.5 gives the ×3 web size. */
export async function renderPng(serveUrl: string, id: string, frame: number, output?: string, scale = 1): Promise<Buffer> {
  const setup = remotionOn();
  const composition = await selectComposition({ serveUrl, id, chromiumOptions, timeoutInMilliseconds, ...setup, logLevel: "error" });
  const { buffer } = await renderStill({ serveUrl, composition, frame, imageFormat: "png", output: output ?? null, chromiumOptions, timeoutInMilliseconds, ...setup,
    logLevel: "error", overwrite: true, scale });
  return buffer ?? readFile(output!);
}

/** The whole composition as a video: H.264 MP4 or VP9 WebM, at `scale` of its 1920×1080 and the given quality. */
export async function renderVideo(serveUrl: string, id: string, codec: Extract<Codec, "h264" | "vp9">, output: string,
  { scale = 1, crf = codec === "h264" ? 16 : 20 }: { scale?: number; crf?: number } = {}): Promise<void> {
  const setup = remotionOn();
  const composition = await selectComposition({ serveUrl, id, chromiumOptions, timeoutInMilliseconds, ...setup, logLevel: "error" });
  await renderMedia({ serveUrl, composition, codec, outputLocation: output, chromiumOptions, timeoutInMilliseconds, ...setup, logLevel: "error", overwrite: true,
    imageFormat: "png", scale, crf });
}

/** Runs Remotion's bundled ffmpeg: no system install is needed. */
export async function ffmpeg(args: string[]): Promise<Buffer> {
  const run = RenderInternals.callFf({ bin: "ffmpeg", args: ["-hide_banner", "-loglevel", "error", ...args], indent: false, logLevel: "error",
    binariesDirectory: remotionOn().binariesDirectory, cancelSignal: undefined, options: { encoding: "buffer" } as never });
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
