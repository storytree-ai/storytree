// Capability 6 · Pixel-art shorts: the spike's frames, rendered by Remotion in a real browser with the real globe.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { SPIKE } from "./root.js";
import { brokenBlocks, bundleShorts, renderPng, rgbOf } from "./render.js";

/** A frame with the windows piled up and the island lit. */
const FRAME = 100;
let serveUrl: string, scratch: string;
before(async () => {
  serveUrl = await bundleShorts();
  scratch = await mkdtemp(path.join(tmpdir(), "shorts-"));
}, { timeout: 300_000 });
after(() => rm(scratch, { recursive: true, force: true }));

test("6.1 · a rendered still is crisp pixel art: every 6×6 block of the lossless frame is one colour", { timeout: 300_000 }, async () => {
  const still = path.join(scratch, "crisp.png");
  await renderPng(serveUrl, SPIKE.id, FRAME, still);
  const rgb = await rgbOf(still);
  assert.deepEqual(brokenBlocks(rgb).slice(0, 5), []);
  assert.ok(new Set(Array.from({ length: rgb.length / 3 }, (_, i) => rgb.readUIntBE(i * 3, 3))).size > 8, "the frame draws a picture, not a flat fill");
});

test("6.2 · the same frame renders identically twice, the turning globe included", { timeout: 300_000 }, async () => {
  const [first, second] = [path.join(scratch, "first.png"), path.join(scratch, "second.png")];
  await renderPng(serveUrl, SPIKE.id, FRAME, first);
  await renderPng(serveUrl, SPIKE.id, FRAME, second);
  assert.ok((await rgbOf(first)).equals(await rgbOf(second)));
});
