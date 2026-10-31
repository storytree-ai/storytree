import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CATALOGUE } from "@storytree/forest/actions";

import { lagReportText } from "./index.js";
import type { KeptReading } from "./readings.js";
import { lagReport } from "./report.js";

const now = Date.parse("2026-10-12T09:00:00Z");
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
const read = (name: string, days: number, response: number, longestFrame: number, settled: number, progress = false): KeptReading =>
  ({ at: ago(days), version: "0.3.42", name, response, longFrames: longestFrame === 0 ? 0 : 1, longestFrame, settled, progress });

test("7.1 · the report prints each action's count, median, 75th percentile and worst over seven days against its budget, worst first", () => {
  const readings: KeptReading[] = [
    // Twelve island opens on the owner's library: quick to answer, but a long frame and one settle past a second with no progress.
    ...[0, 0, 16, 24, 32, 40, 48, 56, 64, 72, 88, 136].map((response, n) => read("open-island", n % 6, response, n === 11 ? 412 : 0, n === 11 ? 2380 : 180 + n * 10)),
    // A slow open eight days ago is outside the window.
    read("open-island", 8, 900, 900, 9000),
    // Three panel closes, all within budget: too few to judge.
    read("close-panel", 1, 0, 0, 16), read("close-panel", 2, 24, 0, 33), read("close-panel", 3, 16, 0, 50),
    // A note that took 1.6 s to settle, but showed progress throughout: within its settled budget.
    ...Array.from({ length: 10 }, (_, n) => read("open-library-note", 1, 40, 0, 1600 + n, true)),
  ];
  assert.equal(lagReport(readings, { now, catalogue: CATALOGUE, file: "/home/u/.storytree/0.3/lag-readings.jsonl" }), [
    "Lag in real use, the last 7 days, against each action's budget (response / longest frame / settled, in ms; settled may run longer while progress is on show).",
    "action             readings  response p50/p75/worst  longest frame p50/p75/worst  settled p50/p75/worst  budget           over budget",
    "open-island        12        40 / 64 / 136           <50 / <50 / 412              230 / 260 / 2380       100 / 50 / 1000  response, frame, settled",
    "open-library-note  10        40 / 40 / 40            <50 / <50 / <50              1604 / 1607 / 1609     100 / 50 / 1000  -",
    "close-panel        3         16 / 24 / 24            <50 / <50 / <50              33 / 50 / 50           100 / 50 / 1000  -",
    "close-panel has fewer than 10 readings: too few to judge.",
  ].join("\n"));

  // A turn of the map is read by its frames: a line per turned view after the table, the median of its turns' p50 and p95, the
  // longest, and how many frames ran over 50 ms in all.
  const turn = (days: number, p50: number, p95: number, max: number, over: number): KeptReading =>
    ({ ...read("turn-forest", days, 0, max > 50 ? max : 0, 0), frames: { p50, p95, max, over } });
  const turned = lagReport([turn(1, 16, 33, 40, 0), turn(2, 17, 84, 84, 2), turn(3, 18, 60, 120, 3)], { now, catalogue: CATALOGUE, file: "/tmp/lag.jsonl" }).split("\n");
  assert.equal(turned.at(-2), "turn-forest frames: p50 17 ms, p95 60 ms (medians over 3 turns), longest 120 ms, 5 over 50 ms");

  assert.equal(lagReport([read("open-island", 9, 10, 0, 100)], { now, catalogue: CATALOGUE, file: "/tmp/lag.jsonl" }),
    "No lag readings in the last 7 days in /tmp/lag.jsonl. The desktop app records them as you use it.");

  // A home the app has never recorded in says where it looked.
  const home = mkdtempSync(path.join(tmpdir(), "lag-in-use-"));
  try {
    assert.equal(lagReportText(home), `No lag readings in the last 7 days in ${path.join(home, "lag-readings.jsonl")}. The desktop app records them as you use it.`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
