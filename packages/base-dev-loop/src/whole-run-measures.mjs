// Capability 7 · Whole-run times measured
import { readWholeRuns, storytreeHome } from "./whole-runs.mjs";

const DAY_MS = 24 * 3_600_000;

const MEASURES = [
  { kind: "test", scope: "full", measure: "measure_2c6ccbbfd78f" },
  { kind: "test", scope: "scoped", measure: "measure_a3ade2703847" },
  { kind: "gate", scope: "full", measure: "measure_2e13073282a4" },
  { kind: "gate", scope: "scoped", measure: "measure_3b86cc5863af" },
];

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function wholeRunMeasureReaders({ home, now = Date.now } = {}) {
  return MEASURES.map(({ kind, scope, measure }) => ({
    measure,
    version: 1,
    kind,
    scope,
    async sample() {
      const until = now();
      const values = readWholeRuns(home ?? storytreeHome())
        .filter((row) => row.kind === kind && row.scope === scope && row.result === "pass" && row.load < row.cpus)
        .filter((row) => {
          const ended = Date.parse(row.at);
          return ended <= until && ended > until - DAY_MS;
        })
        .map((row) => (scope === "full" ? row.ms : row.ms / row.units))
        .sort((a, b) => a - b);
      if (values.length === 0) return undefined;
      return { value: median(values), runs: values.length, spread: values.at(-1) - values[0] };
    },
  }));
}

export const WHOLE_RUN_MEASURE_READERS = wholeRunMeasureReaders();
