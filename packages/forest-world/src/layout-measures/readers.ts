// Capability 6 · Layout and routing time and memory measured
import { layoutBenchmark, type LayoutBenchmark, type LayoutSeed } from "./benchmark.js";

export type LayoutQuantity = "layout" | "routing" | "peak";

export interface LayoutSample {
  readonly value: number;
  readonly runs: number;
  readonly spread: number;
}

export interface LayoutMeasureReader {
  readonly measure: string;
  readonly version: number;
  readonly seed: LayoutSeed;
  readonly quantity: LayoutQuantity;
  sample(at: { folder: string; commit: string; tree: unknown }): Promise<LayoutSample>;
}

const MEASURES: readonly { readonly seed: LayoutSeed; readonly quantity: LayoutQuantity; readonly measure: string }[] = [
  { seed: "five-story-row", quantity: "layout", measure: "measure_fe58fd315131" },
  { seed: "five-story-row", quantity: "routing", measure: "measure_5d39f4cea1f8" },
  { seed: "five-story-row", quantity: "peak", measure: "measure_c185097e7d91" },
  { seed: "code-survey", quantity: "layout", measure: "measure_5e0f0af82978" },
  { seed: "code-survey", quantity: "routing", measure: "measure_316e2411e9c5" },
  { seed: "code-survey", quantity: "peak", measure: "measure_470bbaf83dff" },
];

export function layoutMeasureReaders({ runs, benchmark = layoutBenchmark }: {
  runs: number;
  benchmark?: (input: { seed: LayoutSeed; runs: number }) => Promise<LayoutBenchmark>;
}): LayoutMeasureReader[] {
  const benchmarks = new Map<string, Promise<LayoutBenchmark>>();
  const benchmarkOf = (seed: LayoutSeed, folder: string, commit: string): Promise<LayoutBenchmark> => {
    const key = `${seed}\0${folder}\0${commit}`;
    let reading = benchmarks.get(key);
    if (reading === undefined) benchmarks.set(key, (reading = benchmark({ seed, runs })));
    return reading;
  };
  return MEASURES.map(({ seed, quantity, measure }) => ({
    measure,
    version: 1,
    seed,
    quantity,
    async sample({ folder, commit }) {
      const reading = await benchmarkOf(seed, folder, commit);
      return { value: reading[quantity].median, runs: reading.runs, spread: reading[quantity].spread };
    },
  }));
}

export const LAYOUT_MEASURE_READERS: readonly LayoutMeasureReader[] = layoutMeasureReaders({ runs: 5 });
