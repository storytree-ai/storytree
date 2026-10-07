// Keep these real-browser proofs together: Node runs top-level tests in one file sequentially.
// The shared heavy-run lock serializes test runs, while separate files can launch competing
// SwiftShader browsers within the same forest unit.
import assert from "node:assert/strict";
import { execFile, type ExecFileOptions } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const territoryFolder = fileURLToPath(new URL("./evidence/territory-health", import.meta.url));
const pathwaysFolder = fileURLToPath(new URL("./evidence/pathway-repair/", import.meta.url));
const checkout = path.resolve(pathwaysFolder, "../../../../../..");
const exec = promisify(execFile);
const run = (file: string, args: string[], options: ExecFileOptions) => {
  const result = exec(file, args, { ...options, encoding: "utf8" });
  // A package deadline can kill this test before execFile rejects. Stream the capture's
  // phase diagnostics now, while still retaining stdout for its behavior assertions.
  result.child.stderr?.pipe(process.stderr, { end: false });
  return result;
};

test("3.20 · 3.11 · in a real browser, each territory is filled by its word and never grey, claims draw their bands, and failing islands behind the globe get rim markers", { timeout: 200_000 }, async () => {
  await run(process.execPath, [path.join(territoryFolder, "build.mjs"), "smoke"], { cwd: checkout, timeout: 60_000 });
  // Chrome is installed on CI's three runner images, so the smoke downloads no browser.
  const { stdout } = await run(process.execPath, ["--import", "tsx", path.join(territoryFolder, "capture.mjs"), "--smoke"],
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

// The territory smoke above omits its picture-only tour: on macOS that tour consumed
// 131s of the shared 180s package deadline before these two pages even started.
// Both captures stream phases, including cleanup, before a package timeout can hide them.
test('3.35 · live desktop roads grow on first display and on a polled dependency, preserving shared roads and reduced motion', { timeout: 155_000 }, async () => {
  if (!process.env.PATHWAY_CAPTURE_DIST) await run(process.execPath, ['--import', 'tsx', path.join(pathwaysFolder, 'build.mjs'), checkout, 'live-smoke'], { cwd: checkout, timeout: 30_000 });
  const { stdout } = await run(process.execPath, ['--import', 'tsx', path.join(pathwaysFolder, 'live-capture.mjs'), '--smoke'], {
    cwd: checkout, timeout: 120_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? 'chrome' },
  });
  const summary = JSON.parse(stdout.trim().split('\n').at(-1)!);
  assert.ok(summary.normal.firstNewOnlyFractions.every((fraction: number) => fraction === 0),
    `new-only beige spans begin undrawn; observed ${JSON.stringify(summary.normal.firstNewOnlyFractions)}`);
  assert.ok(summary.normal.partialFrames > 0, 'the real normal-motion renderer submits an advancing front');
  assert.equal(summary.normal.dependencyToDependent, true, 'partial fronts advance from the dependency end');
  assert.ok(summary.normal.initialFirstRoadFractions.length > 0 && summary.normal.initialFirstRoadFractions.every((fraction: number) => fraction === 0),
    'the first normal desktop road frame is undrawn');
  assert.ok(summary.normal.initialPartialFrames > 0, 'initial roads advance through real partial frames');
  assert.ok(summary.reduced.initialFirstRoadFractions.every((fraction: number) => fraction === 1), 'reduced motion makes initial roads complete immediately');
  for (const [motion, reading] of [['normal', summary.normal], ['reduced', summary.reduced]] as const) {
    assert.equal(reading.initialCompletedWithoutCaptureInvalidation, true);
    assert.equal(reading.initialLinkCount, 130);
    assert.equal(reading.finalLinkCount, 131);
    assert.equal(reading.finalLinkIdentitiesPreserved, true);
    assert.ok(reading.newOnlyCrossSpans > 0);
    assert.equal(reading.oldSharedRoadsAlwaysWhole, true);
    assert.equal(reading.completedWithoutCaptureInvalidation, true);
    assert.equal(reading.unrelatedUpdateKeepsRoadsWhole, true,
      `${motion}: the consumed description preserves every intervening road frame; ${JSON.stringify({
        frames: reading.unrelatedFrameCount, consumed: reading.unrelatedDescriptionFrames, progress: reading.unrelatedFrameProgress,
      })}`);
    assert.equal(reading.colouredLanes, 0);
    assert.equal(reading.pageErrors, 0);
  }
  assert.ok(summary.reduced.firstNewOnlyFractions.every((fraction: number) => fraction === 1), 'reduced motion completes new roads immediately');
});
