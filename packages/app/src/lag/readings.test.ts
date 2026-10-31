import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { LagReading } from "./bridge.js";
import { appendReadings, KEEP, lagFile, readReadings } from "./readings.js";
import { createLagRuntime } from "./runtime.js";

const DAY = 86_400_000;
const reading = (settled: number): LagReading => ({ name: "open-island", response: 40, longFrames: 1, longestFrame: 72, settled, progress: false, size: 9 });

test("6.1 · readings are kept in one file in the app's home, the oldest dropped past 30 days or 5 MB", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "lag-in-use-"));
  try {
    assert.deepEqual(KEEP, { ageMs: 30 * DAY, bytes: 5 * 1024 * 1024 });
    const now = Date.parse("2026-10-12T09:00:00Z");
    // Forty days of one reading a day: the nine older than thirty days go, and the one exactly thirty days old stays.
    for (let day = 40; day >= 1; day--) await appendReadings(home, [reading(day)], { version: "0.3.41", now: now - day * DAY });
    await appendReadings(home, [reading(0)], { version: "0.3.42", now });
    const kept = readReadings(home);
    assert.deepEqual(kept.map((r) => r.settled), [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    assert.deepEqual(kept.at(-1), { at: "2026-10-12T09:00:00.000Z", version: "0.3.42", ...reading(0) });

    // A torn last line (the app stopped mid-write) and a foreign one are skipped, not fatal.
    appendFileSync(lagFile(home), "not json\n{\"name\":\"open-is");
    assert.equal(readReadings(home).length, 31);

    // Past the size bound the oldest lines go, and the newest stay whole.
    const line = Buffer.byteLength(readFileSync(lagFile(home), "utf8").split("\n")[0]!) + 1;
    await appendReadings(home, [reading(100), reading(101)], { version: "0.3.42", now, keep: { ageMs: KEEP.ageMs, bytes: line * 5 } });
    assert.deepEqual(readReadings(home).map((r) => r.settled), [2, 1, 0, 100, 101]);
    assert.ok(statSync(lagFile(home)).size <= line * 5);

    // The app's side: the page's batch is checked, stamped and kept; nothing else is written in the home.
    const runtime = createLagRuntime({ home, appVersion: "0.3.43", now: () => now });
    await runtime.recordLag([reading(7), { name: 3 } as unknown as LagReading]);
    assert.deepEqual(readReadings(home).at(-1), { at: "2026-10-12T09:00:00.000Z", version: "0.3.43", ...reading(7) });
    // A turn of the map keeps its frames; frames that are not a turn's four numbers are no reading.
    const turn: LagReading = { name: "turn-forest", response: 0, longFrames: 1, longestFrame: 84, settled: 0, progress: false, frames: { p50: 17, p95: 84, max: 84, over: 1 } };
    await runtime.recordLag([turn, { ...turn, frames: { p50: 17 } } as unknown as LagReading]);
    assert.deepEqual(readReadings(home).slice(-2).map(({ at: _at, version: _version, ...kept }) => kept), [reading(7), turn]);
    assert.deepEqual(readdirSync(home), [path.basename(lagFile(home))]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
