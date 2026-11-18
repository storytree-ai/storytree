/**
 * Code measures, capability 2 · Measure records paired with their readers: contract 2.3 (this package declares under
 * storytree.measures one reader for each base measure record, each naming its record's id and version and reading that
 * measure's one value from a story's StoryMeasures, none for a story not measured or a value it has none of).
 *
 * The base records are the live library's (story Code measures, story_ed509b2d94fc, all version 1); their ids are written
 * here as the library holds them. Each fixture value below is distinct, so a reader reading another field is caught.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { measureReadersOf, type StoryMeasures } from "./index.js";

const CODE_MEASURES = "story_ed509b2d94fc";
const REPOSITORY = path.resolve(import.meta.dirname, "../../..");

/** Each base measure record's id, by its title. */
const BASE = {
  sourceLines: "measure_6fca8f2f796f",
  complexityP90: "measure_e8099a210c90",
  complexityMax: "measure_9294441d4118",
  complexityPer1000: "measure_63ffdee262b1",
  lengthP90: "measure_e4e1f069475f",
  lengthMax: "measure_5e762739ddc6",
  longestFile: "measure_ad17c2553bc3",
  duplicationShare: "measure_47fd18d20974",
  dependencies: "measure_46164b2d5fec",
  dependents: "measure_0055d2326d24",
  surface: "measure_cf2dac1e33d1",
  looseness: "measure_34498f5ac5b2",
  churn: "measure_99b7b76e0140",
  commentShare: "measure_2fb29d59aca8",
} as const;

interface BaseReader {
  readonly measure: string;
  readonly version: number;
  read(story: StoryMeasures): number | null;
}

/** The package's readers, by the module its manifest declares them in. */
async function baseReaders(): Promise<readonly BaseReader[]> {
  const module = "./measures.js";
  const loaded = (await import(module).catch(() => ({}))) as { BASE_MEASURE_READERS?: readonly BaseReader[] };
  assert.ok(Array.isArray(loaded.BASE_MEASURE_READERS), "src/measures.ts exports BASE_MEASURE_READERS, an array of readers");
  return loaded.BASE_MEASURE_READERS;
}

const MEASURED: StoryMeasures = {
  id: "story_a1a1a1a1a1a1",
  title: "Alpha tools",
  packages: ["alpha-tools"],
  size: { files: 9, sourceLines: 1200, testLines: 800, commentLines: 150, commentShare: 0.125 },
  complexity: { functions: 40, p90: 7, max: 23, per1000: 31.5, lengthP90: 18, lengthMax: 64, longestFile: { path: "packages/alpha-tools/src/big.ts", lines: 412 } },
  duplication: { tokens: 16000, cloned: 600, share: 0.0375 },
  coupling: { dependencies: ["beta-kit", "gamma-works", "delta-lab"], dependents: ["e", "f", "g", "h", "i"], instability: 0.375 },
  surface: 27,
  looseness: { any: 2, asCasts: 3, suppressions: 1, eslintDisables: 0, per1000: { any: 1.5, asCasts: 2.25, suppressions: 0.5, eslintDisables: 0.25 } },
  churn: { added: 500, deleted: 220, relative: 0.6, top: [] },
};

test("2.3 · code measures' package declares under storytree.measures one reader at version 1 for each of the fourteen base measure records, and no other", async () => {
  const declared = (await measureReadersOf(REPOSITORY)).filter(({ package: pkg }) => pkg === "packages/code-measures");
  assert.deepEqual(
    declared.map(({ story, measure, version }) => ({ story, measure, version })).sort((a, b) => a.measure.localeCompare(b.measure)),
    Object.values(BASE).map((measure) => ({ story: CODE_MEASURES, measure, version: 1 })).sort((a, b) => a.measure.localeCompare(b.measure)),
  );
});

test("2.3 · each base reader reads its one value from a story's measures: none for a story not measured, and none for a p90, max or longest file the story has none of", async () => {
  const readers = await baseReaders();
  const read = (story: StoryMeasures) => Object.fromEntries(readers.map((reader) => [reader.measure, reader.read(story)]));

  assert.deepEqual(read(MEASURED), {
    [BASE.sourceLines]: 1200,
    [BASE.complexityP90]: 7,
    [BASE.complexityMax]: 23,
    [BASE.complexityPer1000]: 31.5,
    [BASE.lengthP90]: 18,
    [BASE.lengthMax]: 64,
    [BASE.longestFile]: 412,
    [BASE.duplicationShare]: 0.0375,
    [BASE.dependencies]: 3,
    [BASE.dependents]: 5,
    [BASE.surface]: 27,
    [BASE.looseness]: 4.5, // per 1,000 lines: 1.5 any + 2.25 casts + 0.5 suppressions + 0.25 eslint-disables, not the raw counts' 6
    [BASE.churn]: 0.6,
    [BASE.commentShare]: 0.125,
  });

  const missing: StoryMeasures = { id: "story_b2b2b2b2b2b2", title: "Beta kit", packages: ["beta-kit"], missing: "packages/beta-kit is not in the checkout at 0123456789ab" };
  assert.deepEqual(read(missing), Object.fromEntries(Object.values(BASE).map((measure) => [measure, null])), "a story not measured reads none from every reader, never zeros");

  const noFunctions: StoryMeasures = { ...MEASURED, complexity: { functions: 0, p90: null, max: null, per1000: 0, lengthP90: null, lengthMax: null, longestFile: null } };
  const none = read(noFunctions);
  assert.deepEqual(
    [none[BASE.complexityP90], none[BASE.complexityMax], none[BASE.lengthP90], none[BASE.lengthMax], none[BASE.longestFile], none[BASE.complexityPer1000]],
    [null, null, null, null, null, 0],
    "no function and no longest file: their tails and the longest file read none, the per-1,000 total reads its 0",
  );
});
