// Capability 7 · Whole-run times measured
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { WHOLE_RUN_MEASURE_READERS, wholeRunMeasureReaders } from "./whole-run-measures.mjs";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const HOUR = 3_600_000;
const PAIRS = ["gate full", "gate scoped", "test full", "test scoped"];
const asked = { folder: "/checkout", commit: "2222222222222222222222222222222222222222", tree: { arcs: [], stories: [] } };

function home(t, rows) {
  const dir = mkdtempSync(path.join(tmpdir(), "whole-run-measures-"));
  t.after(() => removeTemp(dir));
  if (rows !== undefined) writeFileSync(path.join(dir, "whole-runs.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return dir;
}

function row(kind, scope, ms, { units = 1, result = "pass", load = 0.5, cpus = 8, hoursAgo = 1 } = {}) {
  return { kind, at: new Date(NOW - hoursAgo * HOUR).toISOString(), ms, scope, units, result, machine: "box", load, cpus, jobs: 2, platform: "linux", arch: "x64" };
}

const byPair = (readers) => Object.fromEntries(readers.map((reader) => [`${reader.kind} ${reader.scope}`, reader]));

test("7.3 · wholeRunMeasureReaders gives four readers, one per kind and scope, each its own measure at a positive whole version; the manifest names WHOLE_RUN_MEASURE_READERS under storytree.measures, the same four measures at the same versions", () => {
  const readers = wholeRunMeasureReaders({ home: "/nowhere", now: () => NOW });
  assert.equal(readers.length, 4);
  assert.deepEqual(readers.map(({ kind, scope }) => `${kind} ${scope}`).sort(), PAIRS);
  assert.equal(new Set(readers.map(({ measure }) => measure)).size, 4, "each reader reads its own measure");
  for (const { measure, version, sample } of readers) {
    assert.equal(typeof measure, "string");
    assert.ok(Number.isInteger(version) && version > 0, `version ${version} is a positive whole number`);
    assert.equal(typeof sample, "function");
  }

  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.storytree?.measures, [{ from: "./measures", export: "WHOLE_RUN_MEASURE_READERS" }]);
  assert.equal(manifest.exports["./measures"], "./src/whole-run-measures.mjs");
  const named = (list) => list.map(({ kind, scope, measure, version }) => `${kind} ${scope} ${measure} ${version}`).sort();
  assert.deepEqual(named(WHOLE_RUN_MEASURE_READERS), named(readers), "the declared four read the same measures at the same versions as wholeRunMeasureReaders makes");
  for (const { sample } of WHOLE_RUN_MEASURE_READERS) assert.equal(typeof sample, "function");
});

test("7.3 · each reader keeps its kind and scope's passing runs started below the CPU count that ended in the 24 hours before now, and answers their median (ms for full, ms per unit for scoped), count and spread; none kept is undefined", async (t) => {
  const rows = [
    row("test", "full", 400, { hoursAgo: 1 }),
    row("test", "full", 100, { hoursAgo: 12 }),
    row("test", "full", 250, { hoursAgo: 23.9, load: 7.99 }),
    row("test", "full", 10, { result: "fail" }),
    row("test", "full", 20, { load: 8 }),
    row("test", "full", 30, { load: 9.5 }),
    row("test", "full", 40, { hoursAgo: 24.1 }),
    row("test", "scoped", 1000, { units: 4 }),
    row("test", "scoped", 900, { units: 3, hoursAgo: 2 }),
    row("test", "scoped", 600, { units: 3, hoursAgo: 20 }),
    row("test", "scoped", 1100, { units: 2, hoursAgo: 5 }),
    row("test", "scoped", 50, { units: 1, result: "fail" }),
    row("test", "scoped", 60, { units: 1, hoursAgo: 30 }),
    row("gate", "full", 5000, { hoursAgo: 3 }),
    row("gate", "full", 70, { load: 16, cpus: 16 }),
    row("gate", "scoped", 8000, { units: 2, result: "fail" }),
    row("gate", "scoped", 9000, { units: 2, load: 12 }),
    row("gate", "scoped", 7000, { units: 2, hoursAgo: 48 }),
  ];
  const readers = byPair(wholeRunMeasureReaders({ home: home(t, rows), now: () => NOW }));

  assert.deepEqual(await readers["test full"].sample(asked), { value: 250, runs: 3, spread: 300 }, "400, 100 and 250 ms; a failed run, runs started at or above the CPU count and one ended over a day ago are left out");
  assert.deepEqual(await readers["test scoped"].sample(asked), { value: 275, runs: 4, spread: 350 }, "250, 300, 200 and 550 ms per unit: the mean of the middle two");
  assert.deepEqual(await readers["gate full"].sample(asked), { value: 5000, runs: 1, spread: 0 }, "the one quiet passing gate run, and no test run");
  assert.equal(await readers["gate scoped"].sample(asked), undefined, "a failed, a busy and a stale run leave nothing to read");
});

test("7.3 · a reader of a home with no whole-runs.jsonl answers undefined", async (t) => {
  const readers = wholeRunMeasureReaders({ home: home(t), now: () => NOW });
  for (const reader of readers) assert.equal(await reader.sample(asked), undefined, `${reader.kind} ${reader.scope}`);
});
