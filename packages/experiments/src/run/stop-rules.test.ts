/** Capability 6 · Stop rules: the rules are read from a frozen record's own words, and an arm's points and first lane say when it stops. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Experiment } from "../record/record.js";
import type { Point } from "../points/points.js";
import { ExperimentRefusal } from "../record/record.js";
import { readStopRules, stopReason } from "./stop-rules.js";

const WEEK = 7 * 24 * 3600_000;

function record(stopRules: string[]): Experiment {
  return {
    title: "t", description: "d", arms: [{ name: "a", description: "a" }, { name: "b", description: "b" }],
    hypotheses: ["h"], measures: ["m"], criteria: { helps: "x", noHelp: "y", inconclusive: "z" }, budget: "b", stopRules, frozen: "2026-10-16T16:21:34.743Z",
  } as Experiment;
}

function points(shares: (readonly [number, number] | undefined)[]): Point[] {
  return shares.map((counts, at) => ({
    merge: at + 1, pr: at + 10, mergedAt: "2026-10-17T00:00:00Z", commit: `c${at}`, files: 1, bytes: 1, workflowIntact: true,
    ...(counts === undefined ? {} : { passed: counts[0], total: counts[1] }),
  }));
}

test("6.1 · the stop rules are read from the frozen record's words: the merges a flat verifier curve may run and the wall-clock limit; a record naming either not is refused", () => {
  const twin = record([
    "Pause, never stop, while the real pool has ranked work waiting; resume when it has none.",
    "Stop an arm when its verifier share has not risen for 10 consecutive merges.",
    "Stop an arm at 6 weeks of calendar time from its first dispatched lane (the wall-clock limit; paused time counts).",
  ]);
  assert.deepEqual(readStopRules(twin), { flatMerges: 10, wallClockMs: 6 * WEEK, wallClock: "6 weeks" });
  assert.deepEqual(readStopRules(record(["Stop an arm when its verifier share has not risen for 3 merges.", "A wall-clock limit of 4 days from its first lane."])),
    { flatMerges: 3, wallClockMs: 4 * 24 * 3600_000, wallClock: "4 days" });
  assert.throws(() => readStopRules(record(["Stop an arm at 6 weeks of calendar time (the wall-clock limit)."])), (error: Error) => error instanceof ExperimentRefusal && /not risen for N merges/.test(error.message));
  assert.throws(() => readStopRules(record(["Stop an arm when its verifier share has not risen for 10 consecutive merges."])), (error: Error) => error instanceof ExperimentRefusal && /wall-clock/.test(error.message));
});

test("6.2 · an arm stops once its verifier share has not risen for the record's number of merges, a merge with no verifier result counting as no rise, and never before", () => {
  const rules = { flatMerges: 3, wallClockMs: 6 * WEEK, wallClock: "6 weeks" };
  const now = Date.parse("2026-10-20T00:00:00Z"), firstLane = Date.parse("2026-10-17T00:00:00Z");
  assert.equal(stopReason({ points: [], rules, firstLane, now }), undefined);
  assert.equal(stopReason({ points: points([[1, 370], [5, 370], [5, 370], [4, 370]]), rules, firstLane, now }), undefined, "two merges without a rise");
  assert.match(stopReason({ points: points([[1, 370], [5, 370], [5, 370], [4, 370], undefined]), rules, firstLane, now }) ?? "", /not risen for 3 merges/);
  assert.equal(stopReason({ points: points([[5, 370], [5, 370], [4, 370], [6, 370]]), rules, firstLane, now }), undefined, "a rise starts the count again");
});

test("6.3 · an arm stops at the record's wall-clock limit from its first dispatched lane, paused time counting, and once its verifier passes every test; an arm never dispatched has no clock", () => {
  const rules = { flatMerges: 10, wallClockMs: 6 * WEEK, wallClock: "6 weeks" };
  const firstLane = Date.parse("2026-10-17T00:00:00Z");
  assert.equal(stopReason({ points: [], rules, firstLane, now: firstLane + 6 * WEEK - 1 }), undefined);
  assert.match(stopReason({ points: [], rules, firstLane, now: firstLane + 6 * WEEK }) ?? "", /wall-clock limit of 6 weeks/);
  assert.equal(stopReason({ points: [], rules, firstLane: undefined, now: firstLane + 60 * WEEK }), undefined);
  assert.match(stopReason({ points: points([[369, 370], [370, 370]]), rules, firstLane, now: firstLane }) ?? "", /passes all 370/);
});
