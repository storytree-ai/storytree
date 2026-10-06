// The territory-health capture run in a real browser, so a scene target it waits for that the globe no longer draws fails
// here, on the changing branch, rather than at the next retake (a build alone cannot see a wait that never resolves).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const folder = fileURLToPath(new URL("./evidence/territory-health", import.meta.url));
const checkout = path.resolve(folder, "../../../../../..");
const run = promisify(execFile);

test("3.20 · 3.11 · in a real browser, each territory is filled by its word and never grey, claims draw their bands, and failing islands behind the globe get rim markers", { timeout: 200_000 }, async () => {
  await run(process.execPath, [path.join(folder, "build.mjs"), "smoke"], { cwd: checkout, timeout: 60_000 });
  // Chrome is installed on CI's three runner images, so the smoke downloads no browser.
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(folder, "capture.mjs"), "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!);
  assert.deepEqual(summary.fills, ["healthy #97c459 0.8", "proposed #f2d16b 0.8", "unhealthy #e24b4a 0.85", "untested #f2d16b 0.8"]);
  assert.equal(summary.greyFills, 0);
  // Three sessions claim four capabilities; the quiet one's band is fainter.
  assert.deepEqual(summary.outlines.map(([story, capability, , opacity, triangles]: [string, string, string, number, number]) => [story, capability, opacity, triangles > 0]), [
    ["story_05e45963ca9f", "capability_05ff7e9f0f99", 0.95, true],
    ["story_05e45963ca9f", "capability_4da153322012", 0.95, true],
    ["story_be32e99ed54f", "capability_9f02379a2e1a", 0.6, true],
    ["story_eb7d623fb9c8", "capability_75abfdd699c0", 0.95, true],
  ]);
  assert.deepEqual(summary.markers.map((marker: { story: string; title: string }) => [marker.story, marker.title]), [
    ["story_05e45963ca9f", "The agent link · unhealthy (storytree verified)"],
    ["story_eb7d623fb9c8", "The library · unhealthy (storytree verified)"],
  ]);
});
