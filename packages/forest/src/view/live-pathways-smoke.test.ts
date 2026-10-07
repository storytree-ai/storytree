// Forest 3.35: the real desktop poll and first rendered frame, through the shared capture kit.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const folder = fileURLToPath(new URL('./evidence/pathway-repair/', import.meta.url));
const checkout = path.resolve(folder, '../../../../../..');
const run = promisify(execFile);

test('3.35 · live desktop roads grow on first display and on a polled dependency, preserving shared roads and reduced motion', { timeout: 95_000 }, async () => {
  if (!process.env.PATHWAY_CAPTURE_DIST) await run(process.execPath, ['--import', 'tsx', path.join(folder, 'build.mjs'), checkout, 'live-smoke'], { cwd: checkout, timeout: 30_000 });
  const { stdout } = await run(process.execPath, ['--import', 'tsx', path.join(folder, 'live-capture.mjs'), '--smoke'], {
    cwd: checkout, timeout: 80_000, maxBuffer: 1024 * 1024,
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
  for (const reading of [summary.normal, summary.reduced]) {
    assert.equal(reading.initialCompletedWithoutCaptureInvalidation, true);
    assert.equal(reading.initialLinkCount, 130);
    assert.equal(reading.finalLinkCount, 131);
    assert.equal(reading.finalLinkIdentitiesPreserved, true);
    assert.ok(reading.newOnlyCrossSpans > 0);
    assert.equal(reading.oldSharedRoadsAlwaysWhole, true);
    assert.equal(reading.completedWithoutCaptureInvalidation, true);
    assert.equal(reading.unrelatedUpdateKeepsRoadsWhole, true);
    assert.equal(reading.colouredLanes, 0);
    assert.equal(reading.pageErrors, 0);
  }
  assert.ok(summary.reduced.firstNewOnlyFractions.every((fraction: number) => fraction === 1), 'reduced motion completes new roads immediately');
});
