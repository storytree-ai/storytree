import assert from "node:assert/strict";
import { execFile, type ExecFileOptions } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const checkout = path.resolve(pkg, "../..");
const folder = path.join(pkg, "testing/traversal-when-selected");
const exec = promisify(execFile);
const run = (file: string, args: string[], options: ExecFileOptions) => {
  const result = exec(file, args, { ...options, encoding: "utf8" });
  result.child.stderr?.pipe(process.stderr, { end: false });
  return result;
};

test("4.7 · 4.16 · in a real browser, no session's traversal draws with none selected, and selecting one draws its window in its colour", { timeout: 320_000 }, async () => {
  await run(process.execPath, ["--import", "tsx", path.join(folder, "build.mjs"), checkout, "smoke"], { cwd: checkout, timeout: 60_000 });
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(folder, "capture.mjs"), "after", "--smoke"],
    { cwd: checkout, timeout: 300_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!.replace(/^after /, ""));
  assert.deepEqual(summary.noneSelected, { trails: 0, trailColours: 0, litNotes: 0, windowNotes: 0, litFiles: 0, claimedTerritories: 5 });
  assert.equal(summary.windowsAskedWithNoneSelected, 0);
  const { windowNotes, ...oneSelected } = summary.oneSelected;
  assert.deepEqual(oneSelected, { trails: 2, trailColours: 1, litNotes: 0, litFiles: 0, claimedTerritories: 5 });
});

test("4.7 · 4.16 · in a real browser, nothing is lit with none selected, and selecting a session rings each note it holds, not the one a compaction dropped", { timeout: 200_000 }, async () => {
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(pkg, "testing/window/capture.mjs"), "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").findLast(line => line.startsWith("{"))!);
  assert.deepEqual(summary, { read: 6, held: 5, inViewLines: 0 });
});
