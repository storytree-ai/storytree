// Capability 6 · Layout and routing time and memory measured
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { LayoutBenchmark, LayoutSeed } from "./benchmark.js";
import { LAYOUT_MEASURE_READERS, layoutMeasureReaders } from "./readers.js";

type Reader = ReturnType<typeof layoutMeasureReaders>[number];
type At = Parameters<Reader["sample"]>[0];

const MEASURES = [
  "code-survey layout measure_5e0f0af82978",
  "code-survey peak measure_470bbaf83dff",
  "code-survey routing measure_316e2411e9c5",
  "five-story-row layout measure_fe58fd315131",
  "five-story-row peak measure_c185097e7d91",
  "five-story-row routing measure_5d39f4cea1f8",
];
const tree = { arcs: [], stories: [] } as unknown as At["tree"];
const SEED_BASE: Readonly<Record<string, number>> = { "five-story-row": 0, "code-survey": 50 };
const MEDIAN: Readonly<Record<string, number>> = { layout: 1, routing: 2, peak: 3 };
const SPREAD: Readonly<Record<string, number>> = { layout: 4, routing: 5, peak: 6 };

function fakeBenchmark() {
  const asked: { seed: string; runs: number }[] = [];
  const benchmark = async (input: { seed: string; runs: number }): Promise<LayoutBenchmark> => {
    asked.push(input);
    const at = 100 * asked.length + SEED_BASE[input.seed]!;
    return {
      seed: input.seed as LayoutSeed,
      runs: input.runs,
      islands: 5,
      lanes: 4,
      layout: { median: at + 1, spread: at + 4 },
      routing: { median: at + 2, spread: at + 5 },
      peak: { median: at + 3, spread: at + 6 },
    };
  };
  return { asked, benchmark };
}

const expected = (call: number, seed: string, quantity: string, runs: number) => ({
  value: 100 * call + SEED_BASE[seed]! + MEDIAN[quantity]!,
  runs,
  spread: 100 * call + SEED_BASE[seed]! + SPREAD[quantity]!,
});

const named = (list: readonly Reader[]) => list.map(({ seed, quantity, measure }) => `${seed} ${quantity} ${measure}`).sort();

test("6.2 · layoutMeasureReaders gives six readers, one per seed and quantity, each reading its own measure record at a positive whole version", () => {
  const readers = layoutMeasureReaders({ runs: 3, benchmark: fakeBenchmark().benchmark });
  assert.deepEqual(named(readers), MEASURES);
  for (const { version } of readers) assert.ok(Number.isInteger(version) && version > 0, `version ${version} is a positive whole number`);
});

test("6.2 · each reader answers its quantity's median as value, with its spread and the runs, and a seed's three readers share one benchmark per folder and commit, a new commit or folder benchmarking afresh", async () => {
  const { asked, benchmark } = fakeBenchmark();
  const readers = layoutMeasureReaders({ runs: 3, benchmark });
  const row = readers.filter(({ seed }) => seed === "five-story-row");
  const survey = readers.filter(({ seed }) => seed === "code-survey");

  const rowAnswers = await Promise.all(row.map((reader) => reader.sample({ folder: "/checkout", commit: "aaa", tree })));
  assert.deepEqual(rowAnswers, row.map(({ quantity }) => expected(1, "five-story-row", quantity, 3)), "each five-story row reader answers its own quantity from the one benchmark");
  assert.deepEqual(asked, [{ seed: "five-story-row", runs: 3 }], "the five-story row's three readers share one benchmark");

  for (const reader of survey) {
    assert.deepEqual(await reader.sample({ folder: "/checkout", commit: "aaa", tree }), expected(2, "code-survey", reader.quantity, 3), `code-survey ${reader.quantity} answers the code survey's ${reader.quantity}`);
  }
  assert.deepEqual(asked.slice(1), [{ seed: "code-survey", runs: 3 }], "the code survey's three readers share one benchmark of their own seed");

  const rowPeak = row.find(({ quantity }) => quantity === "peak")!;
  assert.deepEqual(await rowPeak.sample({ folder: "/checkout", commit: "aaa", tree }), expected(1, "five-story-row", "peak", 3), "the same folder and commit is not benchmarked again");
  assert.deepEqual(await rowPeak.sample({ folder: "/checkout", commit: "bbb", tree }), expected(3, "five-story-row", "peak", 3), "a new commit is benchmarked afresh");
  assert.deepEqual(await rowPeak.sample({ folder: "/elsewhere", commit: "bbb", tree }), expected(4, "five-story-row", "peak", 3), "a new folder is benchmarked afresh");
  assert.deepEqual(asked.slice(2), [{ seed: "five-story-row", runs: 3 }, { seed: "five-story-row", runs: 3 }]);
});

test("6.2 · the drawing engine's manifest exports ./measures from the readers and names LAYOUT_MEASURE_READERS under storytree.measures, the same six measures at the same versions that layoutMeasureReaders makes", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { exports: Record<string, string>; storytree?: { measures?: { from: string; export: string }[] } };
  assert.deepEqual(manifest.storytree?.measures?.filter(({ from }) => from === "./measures"), [{ from: "./measures", export: "LAYOUT_MEASURE_READERS" }]);
  assert.equal(manifest.exports["./measures"], "./src/layout-measures/readers.ts");
  assert.deepEqual(named(LAYOUT_MEASURE_READERS), MEASURES);
  const versions = (list: readonly Reader[]) => list.map(({ measure, version }) => `${measure} ${version}`).sort();
  assert.deepEqual(versions(LAYOUT_MEASURE_READERS), versions(layoutMeasureReaders({ runs: 5 })));
  for (const { sample } of LAYOUT_MEASURE_READERS) assert.equal(typeof sample, "function");
});
