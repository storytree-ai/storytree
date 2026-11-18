// Capability 10 · Survey run time and memory measured
import type { AnnotatedTree } from "@storytree/library";

import { surveyBenchmark, type SurveyBenchmark } from "./benchmark.js";

export type SurveySeries = "pinned" | "head";
export type SurveyQuantity = "wall" | "cpu" | "peak";

export interface SurveySample {
  readonly value: number;
  readonly runs: number;
  readonly spread: number;
}

export interface SurveyMeasureReader {
  readonly measure: string;
  readonly version: number;
  readonly series: SurveySeries;
  readonly quantity: SurveyQuantity;
  sample(at: { folder: string; commit: string; tree: AnnotatedTree }): Promise<SurveySample>;
}

export const PINNED_COMMIT = "c6935dc5f1af582d05e39df8f9f7aa8b22f93617";

const MEASURES: readonly { readonly series: SurveySeries; readonly quantity: SurveyQuantity; readonly measure: string }[] = [
  { series: "pinned", quantity: "wall", measure: "measure_387ddab4af77" },
  { series: "pinned", quantity: "cpu", measure: "measure_fa25359a4a63" },
  { series: "pinned", quantity: "peak", measure: "measure_2a5ccc2b9245" },
  { series: "head", quantity: "wall", measure: "measure_ad04f2903e0a" },
  { series: "head", quantity: "cpu", measure: "measure_9577fb54a4cc" },
  { series: "head", quantity: "peak", measure: "measure_9b178e514855" },
];

export function surveyMeasureReaders({ pinned, runs, benchmark = surveyBenchmark }: {
  pinned: string;
  runs: number;
  benchmark?: (input: { folder: string; commit: string; tree: AnnotatedTree; runs: number }) => Promise<SurveyBenchmark>;
}): SurveyMeasureReader[] {
  const benchmarks = new Map<string, Promise<SurveyBenchmark>>();
  const benchmarkOf = (folder: string, commit: string, tree: AnnotatedTree): Promise<SurveyBenchmark> => {
    const key = `${folder}\0${commit}`;
    let reading = benchmarks.get(key);
    if (reading === undefined) benchmarks.set(key, (reading = benchmark({ folder, commit, tree, runs })));
    return reading;
  };
  return MEASURES.map(({ series, quantity, measure }) => ({
    measure,
    version: 1,
    series,
    quantity,
    async sample({ folder, commit, tree }) {
      const reading = await benchmarkOf(folder, series === "pinned" ? pinned : commit, tree);
      return { value: reading[quantity].median, runs: reading.runs, spread: reading[quantity].spread };
    },
  }));
}

export const SURVEY_MEASURE_READERS: readonly SurveyMeasureReader[] = surveyMeasureReaders({ pinned: PINNED_COMMIT, runs: 5 });
