// Capability 10 · Survey run time and memory measured
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";

import type { SurveyBenchmark } from "./benchmark.js";
import { SURVEY_MEASURE_READERS, surveyMeasureReaders } from "./readers.js";

const PAIRS = ["head cpu", "head peak", "head wall", "pinned cpu", "pinned peak", "pinned wall"];
const PINNED = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const LATER = "3333333333333333333333333333333333333333";
const OFFSET: Readonly<Record<string, number>> = { [PINNED]: 100, [HEAD]: 200, [LATER]: 300 };
const tree = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [] }] } as unknown as AnnotatedTree;

type Asked = { folder: string; commit: string; tree: AnnotatedTree; runs: number };

function fakeBenchmark() {
  const asked: Asked[] = [];
  const benchmark = async (input: Asked): Promise<SurveyBenchmark> => {
    asked.push(input);
    const at = OFFSET[input.commit] ?? 0;
    return { commit: input.commit, runs: input.runs, stories: 4, wall: { median: at + 11, spread: at + 1 }, cpu: { median: at + 22, spread: at + 2 }, peak: { median: at + 33, spread: at + 3 } };
  };
  return { asked, benchmark };
}

const EXPECTED: Readonly<Record<string, number>> = { wall: 11, cpu: 22, peak: 33 };
const SPREAD: Readonly<Record<string, number>> = { wall: 1, cpu: 2, peak: 3 };

test("10.2 · surveyMeasureReaders gives six readers, one per series and quantity, each at a positive whole version: a pinned reader surveys the pinned commit whatever commit it is given and a head reader the commit given, each answering its quantity's median, spread and the runs, and a series' three readers of one folder and commit share one benchmark; the map's manifest names SURVEY_MEASURE_READERS, six readers covering every series and quantity, under storytree.measures", async () => {
  const { asked, benchmark } = fakeBenchmark();
  const readers = surveyMeasureReaders({ pinned: PINNED, runs: 3, benchmark });
  assert.equal(readers.length, 6);
  assert.deepEqual(readers.map(({ series, quantity }) => `${series} ${quantity}`).sort(), PAIRS);
  assert.equal(new Set(readers.map(({ measure }) => measure)).size, 6, "each reader reads its own measure");
  for (const { version } of readers) assert.ok(Number.isInteger(version) && version > 0, `version ${version} is a positive whole number`);

  const pinned = readers.filter(({ series }) => series === "pinned");
  const head = readers.filter(({ series }) => series === "head");
  for (const reader of pinned) {
    assert.deepEqual(await reader.sample({ folder: "/checkout", commit: HEAD, tree }), { value: 100 + EXPECTED[reader.quantity]!, runs: 3, spread: 100 + SPREAD[reader.quantity]! }, `pinned ${reader.quantity} answers the pinned commit's ${reader.quantity}`);
  }
  assert.deepEqual(asked, [{ folder: "/checkout", commit: PINNED, tree, runs: 3 }], "the pinned series' three readers share one benchmark of the pinned commit, though given the head");

  const answers = await Promise.all(head.map((reader) => reader.sample({ folder: "/checkout", commit: HEAD, tree })));
  assert.deepEqual(answers, head.map(({ quantity }) => ({ value: 200 + EXPECTED[quantity]!, runs: 3, spread: 200 + SPREAD[quantity]! })), "each head reader answers its quantity at the commit given");
  assert.deepEqual(asked.slice(1), [{ folder: "/checkout", commit: HEAD, tree, runs: 3 }], "the head series' three readers share one benchmark of the commit given");

  const later = head.find(({ quantity }) => quantity === "cpu")!;
  assert.deepEqual(await later.sample({ folder: "/checkout", commit: LATER, tree }), { value: 322, runs: 3, spread: 302 }, "a new head is surveyed afresh");
  assert.deepEqual(asked.slice(2), [{ folder: "/checkout", commit: LATER, tree, runs: 3 }]);

  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { exports: Record<string, string>; storytree: { measures?: { from: string; export: string }[] } };
  assert.deepEqual(manifest.storytree.measures, [{ from: "./measures", export: "SURVEY_MEASURE_READERS" }]);
  assert.equal(manifest.exports["./measures"], "./src/survey-measures/readers.ts");
  assert.deepEqual(SURVEY_MEASURE_READERS.map(({ series, quantity }) => `${series} ${quantity}`).sort(), PAIRS);
  const named = (list: readonly { series: string; quantity: string; measure: string; version: number }[]) => list.map(({ series, quantity, measure, version }) => `${series} ${quantity} ${measure} ${version}`).sort();
  assert.deepEqual(named(SURVEY_MEASURE_READERS), named(readers), "the declared six read the same measures at the same versions as surveyMeasureReaders makes");
  for (const { version, sample } of SURVEY_MEASURE_READERS) {
    assert.ok(Number.isInteger(version) && version > 0);
    assert.equal(typeof sample, "function");
  }
});
