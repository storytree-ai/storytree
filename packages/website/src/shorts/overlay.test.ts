// Capability 6 · Pixel-art shorts: the first short on the built home page.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildWebsite } from "../build.js";
import { rgbOf } from "./render.js";
import { LOW, POSTER } from "./script.js";

/** How far apart two pictures of the same size are: the mean difference per channel, 0 to 255. */
function distance(a: Buffer, b: Buffer): number {
  assert.equal(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

test("6.6 · the home page plays the short as a muted, autoplaying, inline overlay with a poster, a way to close it and a still for reduced motion", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-short-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const overlay = /<dialog id="short"[^>]*\bopen\b[^>]*>([\s\S]*?)<\/dialog>/.exec(html)?.[1];
  assert.ok(overlay, "an open, non-modal overlay holds the short");
  const video = /<video\b([^>]*)>([\s\S]*?)<\/video>/.exec(overlay)!;
  for (const attribute of ["autoplay", "muted", "loop", "playsinline"]) assert.match(video[1]!, new RegExp(`\\b${attribute}\\b`), attribute);
  const served = (asset: string) => path.join(output, asset.replace(/^\//, ""));
  const poster = /\bposter="([^"]+\.png)"/.exec(video[1]!)?.[1];
  assert.ok(poster, "the poster frame shows where video cannot play");
  const still = await rgbOf(served(poster));
  assert.equal(still.length, LOW.width * 3 * LOW.height * 3 * 3, "the poster is the short at ×3");
  const sources = [...video[2]!.matchAll(/<source src="([^"]+)" type="([^"]+)">/g)].map(([, src, type]) => ({ src: src!, type: type! }));
  assert.deepEqual(sources.map(source => source.type), ["video/webm", "video/mp4"]);
  // Each clip, decoded at the poster's moment, is the poster's picture up to its encoding's loss: they are the same short.
  for (const { src } of sources) assert.ok(distance(await rgbOf(served(src), POSTER - 0.001), still) < 6, `${src} plays the short the poster is a frame of`);
  assert.match(overlay, /<form method="dialog"><button[^>]*aria-label="Close the clip"/, "it closes without JavaScript");
  const fallback = /<a class="short-still" href="([^"]+\.mp4)"><img src="([^"]+)"/.exec(overlay);
  assert.ok(fallback && fallback[2] === poster, "reduced motion gets the poster, linked to the clip");
});
