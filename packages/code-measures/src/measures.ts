/**
 * Capability 2 · Measures paired with their readers: the base measures' readers (contract 2.3, ADR-1354), declared in
 * this package's manifest under `storytree.measures`. Each names its live measure record (story Code measures, version 1)
 * and reads that measure's one value from a story's StoryMeasures: none for a story not measured, or a value it has none
 * of (a tail with no function, no longest file), never a zero in its place.
 */
import type { StoryMeasures } from "./read.js";

/** One base measure's reader: its record's id and version, and its value read from one story's measures. */
export interface BaseMeasureReader {
  readonly measure: string;
  readonly version: number;
  read(story: StoryMeasures): number | null;
}

const reader = (measure: string, read: (story: StoryMeasures) => number | null | undefined): BaseMeasureReader => ({
  measure,
  version: 1,
  read: (story) => read(story) ?? null,
});

/** Type looseness per 1,000 source lines: its four counts' rates summed. */
function loosenessPer1000(story: StoryMeasures): number | null {
  const per1000 = story.looseness?.per1000;
  return per1000 === undefined ? null : per1000.any + per1000.asCasts + per1000.suppressions + per1000.eslintDisables;
}

/** The fourteen base measures' readers, by record: Source lines first, Comment share last. */
export const BASE_MEASURE_READERS: readonly BaseMeasureReader[] = [
  reader("measure_6fca8f2f796f", (story) => story.size?.sourceLines),
  reader("measure_e8099a210c90", (story) => story.complexity?.p90),
  reader("measure_9294441d4118", (story) => story.complexity?.max),
  reader("measure_63ffdee262b1", (story) => story.complexity?.per1000),
  reader("measure_e4e1f069475f", (story) => story.complexity?.lengthP90),
  reader("measure_5e762739ddc6", (story) => story.complexity?.lengthMax),
  reader("measure_ad17c2553bc3", (story) => story.complexity?.longestFile?.lines),
  reader("measure_47fd18d20974", (story) => story.duplication?.share),
  reader("measure_46164b2d5fec", (story) => story.coupling?.dependencies.length),
  reader("measure_0055d2326d24", (story) => story.coupling?.dependents.length),
  reader("measure_cf2dac1e33d1", (story) => story.surface),
  reader("measure_34498f5ac5b2", loosenessPer1000),
  reader("measure_99b7b76e0140", (story) => story.churn?.relative),
  reader("measure_2fb29d59aca8", (story) => story.size?.commentShare),
];
