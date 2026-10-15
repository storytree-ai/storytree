// Capability 6 · Pixel-art shorts: the first short's frames, rendered by Remotion in a real browser with the real globe.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { FIRST_SHORT } from "./root.js";
import { brokenBlocks, bundleShorts, remotionOn, renderPng, rgbOf } from "./render.js";

/** A frame with the documents piled up, the island lit and the cursor on it. */
const FRAME = 390;
let serveUrl: string, scratch: string;
before(async () => {
  serveUrl = await bundleShorts();
  scratch = await mkdtemp(path.join(tmpdir(), "shorts-"));
}, { timeout: 300_000 });
after(() => rm(scratch, { recursive: true, force: true }));

test("6.1 · a rendered still is crisp pixel art: every 6×6 block of the lossless frame is one colour", { timeout: 300_000 }, async () => {
  const still = path.join(scratch, "crisp.png");
  await renderPng(serveUrl, FIRST_SHORT.id, FRAME, still);
  const rgb = await rgbOf(still);
  assert.deepEqual(brokenBlocks(rgb).slice(0, 5), []);
  assert.ok(new Set(Array.from({ length: rgb.length / 3 }, (_, i) => rgb.readUIntBE(i * 3, 3))).size > 8, "the frame draws a picture, not a flat fill");
});

test("6.2 · the same frame renders identically twice, the turning globe included", { timeout: 300_000 }, async () => {
  const [first, second] = [path.join(scratch, "first.png"), path.join(scratch, "second.png")];
  await renderPng(serveUrl, FIRST_SHORT.id, FRAME, first);
  await renderPng(serveUrl, FIRST_SHORT.id, FRAME, second);
  assert.ok((await rgbOf(first)).equals(await rgbOf(second)));
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
