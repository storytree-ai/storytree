import assert from "node:assert/strict";
import test from "node:test";
import saved from "./forest-snapshot.json" with { type: "json" };
import type { TourSnapshot } from "./forest-data.js";
import { savedReading } from "./tour-reading.js";

const snapshot = saved as unknown as TourSnapshot;
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("2.6 replay delivers saved activity through the app reading in order, with original timestamps, and holds for pause at the chosen speed", async () => {
  const recording = savedReading(snapshot, { replay: true });
  const heard: { seq: number; at: string }[] = [];
  const stop = recording.reading.subscribe({ onNews: news => { heard.push(...news.lines.map(({ seq, at }) => ({ seq, at }))); } });
  try {
    await settle();
    assert.equal(heard.length, 0, "replay starts before the first saved event");
    recording.advance(2000, { paused: true, speed: 1 });
    await settle();
    assert.equal(heard.length, 0, "pause does not deliver recorded events");
    recording.advance(2000, { speed: 1.5 });
    await settle();
    assert.deepEqual(heard, snapshot.recording.lines.slice(0, 3).map(({ seq, at }) => ({ seq, at })), "three original events at 1.5× speed, never today's timestamps");
    assert.equal(recording.now().toISOString(), snapshot.recording.lines[2]!.at);
    recording.advance(snapshot.recording.lines.length * 1000, { speed: 1 });
    await settle();
    assert.deepEqual(heard, snapshot.recording.lines.map(({ seq, at }) => ({ seq, at })));
    assert.equal(recording.progress().index, snapshot.recording.lines.length);
    assert.equal(recording.now().toISOString(), snapshot.recording.window.to);
  } finally { stop(); recording.reading.stop(); }
});
