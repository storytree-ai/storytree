// Capability 6 · Pixel-art shorts: the first short on the built home page.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildWebsite } from "../build.js";

test("6.6 · the home page plays the short as a muted, autoplaying, inline overlay with a poster, a way to close it and a still for reduced motion", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "website-short-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildWebsite(output);
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const overlay = /<dialog id="short"[^>]*\bopen\b[^>]*>([\s\S]*?)<\/dialog>/.exec(html)?.[1];
  assert.ok(overlay, "an open, non-modal overlay holds the short");
  const video = /<video\b([^>]*)>([\s\S]*?)<\/video>/.exec(overlay)!;
  for (const attribute of ["autoplay", "muted", "loop", "playsinline"]) assert.match(video[1]!, new RegExp(`\\b${attribute}\\b`), attribute);
  const served = async (asset: string) => (await stat(path.join(output, asset.replace(/^\//, "")))).size;
  const poster = /\bposter="([^"]+\.png)"/.exec(video[1]!)?.[1];
  assert.ok(poster && await served(poster) > 0, "the poster frame shows where video cannot play");
  const sources = [...video[2]!.matchAll(/<source src="([^"]+)" type="([^"]+)">/g)].map(([, src, type]) => ({ src: src!, type: type! }));
  assert.deepEqual(sources.map(source => source.type), ["video/webm", "video/mp4"]);
  for (const { src } of sources) assert.ok(await served(src) > 100_000, `${src} is a rendered clip`);
  assert.match(overlay, /<form method="dialog"><button[^>]*aria-label="Close the clip"/, "it closes without JavaScript");
  const still = /<a class="short-still" href="([^"]+\.mp4)"><img src="([^"]+)"/.exec(overlay);
  assert.ok(still && still[2] === poster, "reduced motion gets the poster, linked to the clip");
});
