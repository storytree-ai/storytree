// Capability 6 · Pixel-art shorts: the first short's frames, rendered by Remotion in a real browser with the real globe.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { POSTER as MEMORY_POSTER } from "./memory.js";
import { PANEL_WIDTH } from "./memory-scene.js";
import { POSTER } from "./one-map.js";
import { COLOURS } from "./one-map-scene.js";
import { FIRST_SHORT, SECOND_SHORT, THIRD_SHORT } from "./root.js";
import { HALF, LOW, SCALE, SCREEN } from "./script.js";
import { brokenBlocks, bundleShorts, remotionOn, renderPng, rgbOf } from "./render.js";

/** A frame with code on one screen and, on the other, the map with the island lit and its panel open. */
const FRAME = 480;
let serveUrl: string, scratch: string;
before(async () => {
  serveUrl = await bundleShorts();
  scratch = await mkdtemp(path.join(tmpdir(), "shorts-"));
}, { timeout: 300_000 });
after(() => rm(scratch, { recursive: true, force: true }));

test("6.1 · a rendered still is crisp pixel art: every 4×4 block of the lossless frame is one colour", { timeout: 300_000 }, async () => {
  const still = path.join(scratch, "crisp.png");
  await renderPng(serveUrl, FIRST_SHORT.id, FRAME, still);
  const rgb = await rgbOf(still);
  assert.deepEqual(brokenBlocks(rgb).slice(0, 5), []);
  assert.ok(new Set(Array.from({ length: rgb.length / 3 }, (_, i) => rgb.readUIntBE(i * 3, 3))).size > 8, "the frame draws a picture, not a flat fill");
});

test("6.2 · the same frame renders identically twice, the turning globe included, however late a slow machine captures it", { timeout: 300_000 }, async () => {
  const [first, second] = [path.join(scratch, "first.png"), path.join(scratch, "second.png")];
  await renderPng(serveUrl, FIRST_SHORT.id, FRAME, first);
  await renderPng(serveUrl, FIRST_SHORT.id, FRAME, second, 1, { lateBy: 600 });
  assert.ok((await rgbOf(first)).equals(await rgbOf(second)));
});

test("6.18 · a rendered frame of the second short is crisp, and its map carries each standing claim's flag where the real view drew it, in its session's colour", { timeout: 300_000 }, async () => {
  const still = path.join(scratch, "one-map.png");
  await renderPng(serveUrl, SECOND_SHORT.id, POSTER * SECOND_SHORT.fps, still);
  const rgb = await rgbOf(still);
  assert.deepEqual(brokenBlocks(rgb).slice(0, 5), []);
  // The map's own area on the storytree half: its screen, above the app's sessions strip (which names each session by its colour too).
  const { x, y, width, height } = SCREEN.full, wide = LOW.width * SCALE;
  for (const colour of COLOURS) {
    const want = [1, 3, 5].map(at => parseInt(colour.slice(at, at + 2), 16));
    let seen = 0;
    for (let row = y; row < y + height - 14; row++) for (let column = HALF.with + x; column < HALF.with + x + width; column++) {
      const at = (row * SCALE * wide + column * SCALE) * 3;
      if (want.every((value, c) => rgb[at + c] === value)) seen++;
    }
    assert.ok(seen >= 10, `${colour} marks a claim on the map (${seen} pixels)`);
  }
});

test("6.22 · a rendered frame of the third short is crisp, and on its map the island he clicked is lit where the real view drew it, beside its panel", { timeout: 300_000 }, async () => {
  const still = path.join(scratch, "memory.png");
  await renderPng(serveUrl, THIRD_SHORT.id, MEMORY_POSTER * THIRD_SHORT.fps, still);
  const rgb = await rgbOf(still);
  assert.deepEqual(brokenBlocks(rgb).slice(0, 5), []);
  // The map's own area on the storytree half, left of the panel and above the sessions strip: the selection's gold, the view's
  // ring and the scene's plate under the island it found there.
  const { x, y, width, height } = SCREEN.full, wide = LOW.width * SCALE, gold = [0xff, 0xd3, 0x4d];
  let seen = 0;
  for (let row = y + 16; row < y + height - 14; row++) for (let column = HALF.with + x; column < HALF.with + x + width - PANEL_WIDTH; column++) {
    const at = (row * SCALE * wide + column * SCALE) * 3;
    if (gold.every((value, c) => rgb[at + c] === value)) seen++;
  }
  assert.ok(seen >= 100, `the lit island shows on the map (${seen} pixels)`);
});

test("6.7 · on Windows arm64, which Remotion builds no Headless Shell or binaries for, a short renders in the installed Chrome with Remotion's x64 binaries; elsewhere with its own", () => {
  const chrome = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
  const x64Binaries = () => "compositor-win32-x64-msvc";
  const laptop = { platform: "win32", arch: "arm64", env: { PROGRAMFILES: String.raw`C:\Program Files` }, x64Binaries } as const;
  assert.deepEqual(remotionOn({ ...laptop, exists: file => file === chrome }),
    { browserExecutable: chrome, chromeMode: "chrome-for-testing", binariesDirectory: "compositor-win32-x64-msvc" });
  assert.throws(() => remotionOn({ ...laptop, exists: () => false }), /no installed Chrome was found at C:\\Program Files\\Google/);
  for (const [platform, arch] of [["linux", "x64"], ["win32", "x64"], ["darwin", "arm64"]] as const)
    assert.deepEqual(remotionOn({ platform, arch, env: {}, exists: () => true, x64Binaries }),
      { browserExecutable: null, chromeMode: "headless-shell", binariesDirectory: null });
});
