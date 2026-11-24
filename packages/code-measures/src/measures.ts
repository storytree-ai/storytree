// Capability 2 · Measures paired with their readers
import type { StoryMeasures } from "./read.js";

export const TEST_COUNT = "measure_1081d3e0c297";
export const MUTATION_SCORE = "measure_7ceaf1a4061a";
export const MUTATION_CAP = 100;
const MUTATION_BUDGET_MS = 15 * 60_000;

export interface StoryMutation {
  readonly planted: number;
  readonly caught: number;
  readonly judged: number;
  readonly ms: number;
}

export interface MutationPart {
  readonly name: string;
  storyMutation?(root: string, packages: readonly string[], options: { cap: number; budgetMs: number }): Promise<StoryMutation>;
}

export interface SampleAt {
  readonly folder: string;
  readonly commit: string;
  readonly tree: unknown;
  readonly project: string;
  readonly server: unknown;
  readonly story?: { readonly id: string; readonly title: string; readonly packages: readonly string[] };
  readonly parts?: readonly MutationPart[];
}

export interface Sampled {
  readonly value: number;
  readonly runs: number;
  readonly spread: number | null;
}

export interface BaseMeasureReader {
  readonly measure: string;
  readonly version: number;
  read?(story: StoryMeasures): number | null;
  sample?(at: SampleAt): Promise<Sampled | undefined>;
  readonly beside?: string;
}

const reader = (measure: string, read: (story: StoryMeasures) => number | null | undefined): BaseMeasureReader => ({
  measure,
  version: 1,
  read: (story) => read(story) ?? null,
});

function loosenessPer1000(story: StoryMeasures): number | null {
  const per1000 = story.looseness?.per1000;
  return per1000 === undefined ? null : per1000.any + per1000.asCasts + per1000.suppressions + per1000.eslintDisables;
}

export const BASE_MEASURE_READERS: readonly BaseMeasureReader[] = [
  reader("measure_6fca8f2f796f", (story) => story.size?.sourceLines),
  reader("measure_e8099a210c90", (story) => story.complexity?.p90),
  reader("measure_9294441d4118", (story) => story.complexity?.max),
  reader("measure_63ffdee262b1", (story) => story.complexity?.per1000),
  reader("measure_e4e1f069475f", (story) => story.complexity?.lengthP90),
  reader("measure_5e762739ddc6", (story) => story.complexity?.lengthMax),
  reader("measure_ad17c2553bc3", (story) => story.complexity?.longestFile?.lines),
  reader("measure_47fd18d20974", (story) => story.duplication?.share),
  reader("measure_306a55834a6b", (story) => story.erosion?.share),
  reader("measure_46164b2d5fec", (story) => story.coupling?.dependencies.length),
  reader("measure_0055d2326d24", (story) => story.coupling?.dependents.length),
  reader("measure_cf2dac1e33d1", (story) => story.surface),
  reader("measure_34498f5ac5b2", loosenessPer1000),
  reader("measure_99b7b76e0140", (story) => story.churn?.relative),
  reader("measure_2fb29d59aca8", (story) => story.size?.commentShare),
  reader(TEST_COUNT, (story) => story.tests?.count),
  {
    measure: MUTATION_SCORE,
    version: 1,
    beside: TEST_COUNT,
    async sample({ folder, story, parts = [] }) {
      const part = parts.find((one) => one.storyMutation !== undefined);
      if (part === undefined || story === undefined) return undefined;
      const { caught, judged } = await part.storyMutation!(folder, story.packages.map((dir) => `packages/${dir}`), { cap: MUTATION_CAP, budgetMs: MUTATION_BUDGET_MS });
      return judged === 0 ? undefined : { value: caught / judged, runs: judged, spread: null };
    },
  },
];
