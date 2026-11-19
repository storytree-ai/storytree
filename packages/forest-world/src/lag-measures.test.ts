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

test("3.10 · the drawing engine's manifest exports ./lag-measures and names LAG_MEASURE_READERS under storytree.measures beside LAYOUT_MEASURE_READERS, and it holds exactly idle's longest-frame reader, recorded by the lag box at version 1 with its record's id", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, string>; storytree?: { measures?: { from: string; export: string }[] } };
  assert.equal(manifest.exports["./lag-measures"], "./src/lag-measures.ts");
  assert.deepEqual([...(manifest.storytree?.measures ?? [])].sort((a, b) => a.export.localeCompare(b.export)), [
    { from: "./lag-measures", export: "LAG_MEASURE_READERS" },
    { from: "./measures", export: "LAYOUT_MEASURE_READERS" },
  ]);

  const { LAG_MEASURE_READERS } = (await import("./lag-measures.js")) as { LAG_MEASURE_READERS: readonly LagReader[] };
  assert.deepEqual(LAG_MEASURE_READERS, [{ measure: "measure_231e5ea0fd28", version: 1, recordedBy: "lag box", action: "idle", quantity: "longest-frame" }]);
});
