// Keep these real-browser proofs together: Node runs top-level tests in one file sequentially.
// The shared heavy-run lock serializes test runs, while separate files can launch competing
// SwiftShader browsers within the same forest unit.
import assert from "node:assert/strict";
import { execFile, type ExecFileOptions } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const territoryFolder = fileURLToPath(new URL("../../testing/view/territory-health", import.meta.url));
const pathwaysFolder = fileURLToPath(new URL("../../testing/view/pathway-repair/", import.meta.url));
const rowDetailFolder = fileURLToPath(new URL("../../testing/row-detail", import.meta.url));
const libraryLookFolder = fileURLToPath(new URL("../../testing/view/glass-library-look", import.meta.url));
const checkout = path.resolve(pathwaysFolder, "../../../../..");
const exec = promisify(execFile);
const run = (file: string, args: string[], options: ExecFileOptions) => {
  const result = exec(file, args, { ...options, encoding: "utf8" });
  // A package deadline can kill this test before execFile rejects. Stream the capture's
  // phase diagnostics now, while still retaining stdout for its behavior assertions.
  result.child.stderr?.pipe(process.stderr, { end: false });
  return result;
};

test("3.20 · 3.14 · 7.10 · in a real browser, each territory is filled by its word, grey only when parked, claims plant their flags (an idle holder's too, though its row is not listed), and no file is drawn on the land", { timeout: 200_000 }, async () => {
  await run(process.execPath, [path.join(territoryFolder, "build.mjs"), "smoke"], { cwd: checkout, timeout: 60_000 });
  // Chrome is installed on CI's three runner images, so the smoke downloads no browser.
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(territoryFolder, "capture.mjs"), "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!);
  assert.deepEqual(summary.fills, ["healthy #97c459 0.8", "proposed #f2d16b 0.8", "proposed parked #86939d 0.8", "unhealthy #e24b4a 0.85", "untested #f2d16b 0.8", "untested parked #86939d 0.8"]);
  assert.equal(summary.greyFills, 0);
  assert.equal(summary.fileMarks, 0, "an island shows only its territories' colours: no dot per file");
  assert.deepEqual(summary.parked, ["capability_60a15402b053", "capability_b59e959e0da8"]);
  // Three sessions claim four capabilities, each with a pennant; the quiet one's is furled.
  assert.deepEqual(summary.flags.map(([story, capability, , faded, triangles]: [string, string, string, boolean, number]) => [story, capability, faded, triangles > 0]).sort((a: unknown[], b: unknown[]) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)), [
    ["story_05e45963ca9f", "capability_05ff7e9f0f99", false, true],
    ["story_05e45963ca9f", "capability_4da153322012", false, true],
    ["story_be32e99ed54f", "capability_9f02379a2e1a", true, true],
    ["story_eb7d623fb9c8", "capability_75abfdd699c0", false, true],
  ]);
  assert.deepEqual(summary.listed, ["A", "B"], "the quiet session's flag stays, furled, while the sessions list shows only the two at work (7.10)");
});

// The row-detail capture run in a real browser, so a session-row control it waits for that the strip no longer draws fails here,
// on the changing branch, rather than at the next retake.
test("7.2, 7.8 · in a real browser, a running session's subagent waits behind its \"+N\" while every row's detail starts closed, and its expander shows its worktrees, no Running or Files block, and the subagent beneath it", { timeout: 200_000 }, async () => {
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(rowDetailFolder, "capture.mjs"), "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").findLast(line => line.startsWith("{"))!);
  // Two rows, every detail closed, the builder's subagent folded into it; expanded, the subagent shows beneath it.
  assert.deepEqual(summary, { closed: 2, folded: 0, children: 1, worktrees: 3, blocks: ["Worktrees"] });
});

test("3.55 · in a real browser, pressing Library or Stories leaves the eye and the sheet exactly where the user tilted them, from above, side on and from below; the look follows the button, never the tilt", { timeout: 200_000 }, async () => {
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(libraryLookFolder, "capture.mjs"), "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").findLast(line => line.startsWith("{"))!);
  // At each tilt: Stories draws solid islands, Library outlines only, and neither press moved the eye.
  const both = { stories: true, library: true };
  assert.deepEqual(summary, { unmoved: ["above", "side-on", "below"], looks: { above: both, "side-on": both, below: both } });
});
