import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

interface LagReader {
  readonly measure: string;
  readonly version: number;
  readonly recordedBy: string;
  readonly action: string;
  readonly quantity: string;
}

const byQuantity = (a: LagReader, b: LagReader) => a.quantity.localeCompare(b.quantity);

test("4.25 · the knowledge core's manifest exports ./lag-measures and names LAG_MEASURE_READERS under storytree.measures, which holds exactly open-library-note's five readers, each recorded by the lag box at version 1 with its record's id", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, string>; storytree?: { measures?: unknown } };
  assert.equal(manifest.exports["./lag-measures"], "./src/lag-measures.ts");
  assert.deepEqual(manifest.storytree?.measures, [{ from: "./lag-measures", export: "LAG_MEASURE_READERS" }]);

  const { LAG_MEASURE_READERS } = (await import("./lag-measures.js")) as { LAG_MEASURE_READERS: readonly LagReader[] };
  const reader = (quantity: string, measure: string): LagReader => ({ measure, version: 1, recordedBy: "lag box", action: "open-library-note", quantity });
  assert.deepEqual([...LAG_MEASURE_READERS].sort(byQuantity), [
    reader("response-p50", "measure_b17968135e50"),
    reader("response-worst", "measure_faa43d39d2ea"),
    reader("longest-frame", "measure_a3b99be7fe9b"),
    reader("settled-p50", "measure_583b03406b13"),
    reader("settled-worst", "measure_5b6c635ff1e0"),
  ].sort(byQuantity));
});
