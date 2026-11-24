// Capability 2 · Measure records paired with their readers
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { measureReadersOf, type StoryMeasures } from "./index.js";

const CODE_MEASURES = "story_ed509b2d94fc";
const REPOSITORY = path.resolve(import.meta.dirname, "../../..");

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
  erosionShare: "measure_306a55834a6b",
} as const;

const TEST_COUNT = "measure_1081d3e0c297";
const MUTATION_SCORE = "measure_7ceaf1a4061a";

interface StoryMutation {
  readonly planted: number;
  readonly caught: number;
  readonly judged: number;
  readonly ms: number;
}

interface MutationPart {
  readonly name: string;
  storyMutation?(root: string, packages: readonly string[], options: { cap: number; budgetMs: number }): Promise<StoryMutation>;
}

interface SampleAt {
  readonly folder: string;
  readonly commit: string;
  readonly tree: unknown;
  readonly project: string;
  readonly server: unknown;
  readonly story: { readonly id: string; readonly title: string; readonly packages: readonly string[] };
  readonly parts: readonly MutationPart[];
}

interface BaseReader {
  readonly measure: string;
  readonly version: number;
  read?(story: StoryMeasures): number | null;
  sample?(at: SampleAt): Promise<{ value: number; runs: number; spread: number | null } | undefined>;
  readonly beside?: string;
}

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
  erosion: { mass: 400, eroded: 25, share: 0.0625 },
  coupling: { dependencies: ["beta-kit", "gamma-works", "delta-lab"], dependents: ["e", "f", "g", "h", "i"], instability: 0.375 },
  surface: 27,
  looseness: { any: 2, asCasts: 3, suppressions: 1, eslintDisables: 0, per1000: { any: 1.5, asCasts: 2.25, suppressions: 0.5, eslintDisables: 0.25 } },
  churn: { added: 500, deleted: 220, relative: 0.6, top: [] },
};

test("2.3 · code measures' package declares under storytree.measures one reader at version 1 for each of the seventeen base measure records, the fifteen read from structure, Test count and Mutation score, and no other", async () => {
  const declared = (await measureReadersOf(REPOSITORY)).filter(({ package: pkg }) => pkg === "packages/code-measures");
  assert.deepEqual(
    declared.map(({ story, measure, version }) => ({ story, measure, version })).sort((a, b) => a.measure.localeCompare(b.measure)),
    [...Object.values(BASE), TEST_COUNT, MUTATION_SCORE].map((measure) => ({ story: CODE_MEASURES, measure, version: 1 })).sort((a, b) => a.measure.localeCompare(b.measure)),
  );
});

test("2.3 · each base reader reads its one value from a story's measures: none for a story not measured, and none for a p90, max or longest file the story has none of", async () => {
  const structural = new Set<string>(Object.values(BASE));
  const readers = (await baseReaders()).filter(({ measure }) => structural.has(measure));
  const read = (story: StoryMeasures) => Object.fromEntries(readers.map((reader) => [reader.measure, reader.read!(story)]));

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
    [BASE.looseness]: 4.5,
    [BASE.churn]: 0.6,
    [BASE.commentShare]: 0.125,
    [BASE.erosionShare]: 0.0625,
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

interface MutationExports {
  readonly TEST_COUNT?: string;
  readonly MUTATION_SCORE?: string;
  readonly MUTATION_CAP?: number;
}

async function readerOf(measure: string): Promise<BaseReader> {
  const reader = (await baseReaders()).find((one) => one.measure === measure);
  assert.ok(reader !== undefined, `code measures declares a reader of ${measure}`);
  return reader;
}

test("2.4 · the Test count reader reads a story's test count: 0 for a story with no test, none for a story not measured", async () => {
  const module = "./measures.js";
  const loaded = (await import(module)) as MutationExports;
  assert.deepEqual([loaded.TEST_COUNT, loaded.MUTATION_SCORE, loaded.MUTATION_CAP], [TEST_COUNT, MUTATION_SCORE, 100], "measures.ts exports the two measure ids and the cap of 100 breaks");
  const reader = await readerOf(TEST_COUNT);
  assert.equal(reader.version, 1);
  assert.equal(typeof reader.read, "function", "Test count is read plainly");
  const withTests = (count: number) => ({ ...MEASURED, tests: { count } }) as StoryMeasures;
  assert.equal(reader.read!(withTests(112)), 112);
  assert.equal(reader.read!(withTests(0)), 0, "no test is 0, not none");
  assert.equal(reader.read!({ id: "story_b2b2b2b2b2b2", title: "Beta kit", packages: ["beta-kit"], missing: "packages/beta-kit is not in the checkout at 0123456789ab" }), null);
});

const AT = {
  folder: "/checkouts/storytree",
  commit: "c".repeat(40),
  tree: { arcs: [] },
  project: "storytree",
  server: undefined,
  story: { id: "story_a1a1a1a1a1a1", title: "Alpha tools", packages: ["alpha-tools", "alpha-extra"] },
} as const;

function standIn(name: string, answer: StoryMutation): MutationPart & { readonly asked: { root: string; packages: readonly string[]; options: { cap: number; budgetMs: number } }[] } {
  const asked: { root: string; packages: readonly string[]; options: { cap: number; budgetMs: number } }[] = [];
  return {
    name,
    asked,
    async storyMutation(root, packages, options) {
      asked.push({ root, packages: [...packages], options: { ...options } });
      return answer;
    },
  };
}

test("2.4 · the Mutation score reader has no read, is printed beside Test count, and samples through the first part offering storyMutation: the story's packages under packages/, a cap of 100 breaks and a time budget, answering caught over judged with the breaks judged as its runs and no spread", async () => {
  const reader = await readerOf(MUTATION_SCORE);
  assert.equal(reader.version, 1);
  assert.equal(reader.read, undefined, "no plain read: a mutation score is sampled");
  assert.equal(reader.beside, TEST_COUNT, "printed beside Test count");
  assert.equal(typeof reader.sample, "function", "it samples");

  const first = standIn("first", { planted: 100, caught: 37, judged: 80, ms: 41_250 });
  const second = standIn("second", { planted: 100, caught: 99, judged: 99, ms: 10 });
  const answer = await reader.sample!({ ...AT, parts: [{ name: "plain" }, first, second] });
  assert.deepEqual(answer, { value: 37 / 80, runs: 80, spread: null }, "caught over judged, not over planted; runs the breaks judged");
  assert.equal(second.asked.length, 0, "only the first part offering storyMutation is asked");
  assert.equal(first.asked.length, 1, "asked once for the story");
  const [{ root, packages, options }] = first.asked as [(typeof first.asked)[number]];
  assert.deepEqual({ root, packages, cap: options.cap }, { root: AT.folder, packages: ["packages/alpha-tools", "packages/alpha-extra"], cap: 100 });
  assert.ok(Number.isFinite(options.budgetMs) && options.budgetMs > 0, `a positive time budget: ${options.budgetMs}`);

  const declared = (await measureReadersOf(REPOSITORY)).find(({ package: pkg, measure }) => pkg === "packages/code-measures" && measure === MUTATION_SCORE) as { read?: unknown; sample?: unknown; beside?: unknown } | undefined;
  assert.deepEqual({ read: typeof declared?.read, sample: typeof declared?.sample, beside: declared?.beside }, { read: "undefined", sample: "function", beside: TEST_COUNT }, "measureReadersOf carries the declared reader's beside");
});

test("2.4 · the Mutation score sample answers nothing when no break was judged or no part offers storyMutation", async () => {
  const reader = await readerOf(MUTATION_SCORE);
  assert.equal(typeof reader.sample, "function", "it samples");
  const unjudged = standIn("unjudged", { planted: 12, caught: 0, judged: 0, ms: 900_000 });
  assert.equal(await reader.sample!({ ...AT, parts: [unjudged] }), undefined, "no break judged: no reading, never 0 or NaN");
  assert.equal(unjudged.asked.length, 1);
  assert.equal(await reader.sample!({ ...AT, parts: [{ name: "plain" }] }), undefined, "no part offers storyMutation");
  assert.equal(await reader.sample!({ ...AT, parts: [] }), undefined, "no part at all");
});
