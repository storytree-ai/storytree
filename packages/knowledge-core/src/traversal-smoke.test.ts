// The traversal capture run in a real browser, so a scene target it waits for that the globe no longer draws fails here,
// on the changing branch, rather than at the next retake (a build alone cannot see a wait that never resolves).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const checkout = path.resolve(pkg, "../..");
const folder = path.join(pkg, "evidence/traversal-when-selected");
const run = promisify(execFile);

test("4.7 · 4.16 · in a real browser, no session's traversal draws with none selected, and selecting one draws its window in its colour", { timeout: 200_000 }, async () => {
  await run(process.execPath, ["--import", "tsx", path.join(folder, "build.mjs"), checkout, "smoke"], { cwd: checkout, timeout: 60_000 });
  // Chrome is installed on CI's three runner images, so the smoke downloads no browser.
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(folder, "capture.mjs"), "after", "--smoke"],
    { cwd: checkout, timeout: 180_000, env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } });
  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!.replace(/^after /, ""));
  assert.deepEqual(summary.noneSelected, { trails: 0, trailColours: 0, litNotes: 0, windowNotes: 0, litFiles: 0, claimedTerritories: 5 });
  assert.equal(summary.windowsAskedWithNoneSelected, 0);
  // The capture waited for the selected window's three notes in its colour; the replay then relights them, so their count here varies.
  const { windowNotes, ...oneSelected } = summary.oneSelected;
  assert.deepEqual(oneSelected, { trails: 3, trailColours: 1, litNotes: 0, litFiles: 1, claimedTerritories: 5 });
});
