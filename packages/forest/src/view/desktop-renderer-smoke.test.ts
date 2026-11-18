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
  result.child.stderr?.pipe(process.stderr, { end: false });
  return result;
};

test("3.20 · 3.14 · 7.10 · in a real browser, each territory is filled by its word, grey only when parked, claims plant their flags (an idle holder's too, though its row is not listed), and no file is drawn on the land", { timeout: 200_000 }, async () => {
  await run(process.execPath, [path.join(territoryFolder, "build.mjs"), "smoke"], { cwd: checkout, timeout: 60_000 });
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(territoryFolder, "capture.mjs"), "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!);
  assert.deepEqual(summary.fills, ["healthy #97c459 0.8", "proposed #f2d16b 0.8", "proposed parked #86939d 0.8", "unhealthy #e24b4a 0.85", "untested #f2d16b 0.8", "untested parked #86939d 0.8"]);
  assert.equal(summary.greyFills, 0);
  assert.equal(summary.fileMarks, 0, "an island shows only its territories' colours: no dot per file");
  assert.deepEqual(summary.parked, ["capability_60a15402b053", "capability_b59e959e0da8"]);
  assert.deepEqual(summary.flags.map(([story, capability, , faded, triangles]: [string, string, string, boolean, number]) => [story, capability, faded, triangles > 0]).sort((a: unknown[], b: unknown[]) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)), [
    ["story_05e45963ca9f", "capability_05ff7e9f0f99", false, true],
    ["story_05e45963ca9f", "capability_4da153322012", false, true],
    ["story_be32e99ed54f", "capability_9f02379a2e1a", true, true],
    ["story_eb7d623fb9c8", "capability_75abfdd699c0", false, true],
  ]);
  assert.deepEqual(summary.listed, ["A", "B"], "the quiet session's flag stays, furled, while the sessions list shows only the two at work (7.10)");
});

test("7.2, 7.8 · in a real browser, a running session's subagent waits behind its \"+N\" while every row's detail starts closed, and its expander shows its worktrees, no Running or Files block, and the subagent beneath it", { timeout: 200_000 }, async () => {
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(rowDetailFolder, "capture.mjs"), "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").findLast(line => line.startsWith("{"))!);
  assert.deepEqual(summary, { closed: 2, folded: 0, children: 1, worktrees: 3, blocks: ["Worktrees"] });
});

test("3.55, 3.63 · in a real browser, the sheet opens straight down and pressing Library from there eases in the tabletop tilt, the eye kept, and Stories after it moves nothing, as Library's press does opening an island-less sheet (3.63); from a tilt the user gave, above, side on and below, either press leaves the eye and the sheet exactly where they were; the look follows the button, never the tilt, and only Library hangs the notes", { timeout: 200_000 }, async () => {
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(libraryLookFolder, "capture.mjs"), "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").findLast(line => line.startsWith("{"))!);
  const both = { stories: true, library: true };
  const notes = { stories: 0, library: true };
  assert.deepEqual(summary, { opening: { straightDown: true, library: true, stories: true, bareLibrary: true }, unmoved: ["above", "side-on", "below"], looks: { above: both, "side-on": both, below: both }, notes: { above: notes, "side-on": notes, below: notes } });
});
