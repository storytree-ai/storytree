// Capability 7 · Instructions (the habits card)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { habitsCard } from "./habits.js";
import { HABITS_CARD_MEASURE_READERS } from "./measures.js";

interface Sampler {
  readonly measure: string;
  readonly version: number;
  sample(at: { folder: string; commit: string; tree: unknown; project: string; server: unknown }): Promise<{ value: number; runs: number; spread: number } | undefined>;
}

test("7.23 · HABITS_CARD_MEASURE_READERS is two readers, each of its own measure at a positive whole version and declared under storytree.measures, sampling the card habitsCard() composes with nothing switched off: its UTF-8 bytes, and those bytes over four rounded up as its estimated tokens, each with runs 1 and spread 0", async () => {
  const readers = HABITS_CARD_MEASURE_READERS as unknown as readonly Sampler[];
  assert.equal(readers.length, 2, "two readers");
  assert.equal(new Set(readers.map(({ measure }) => measure)).size, 2, "each reader reads its own measure");
  for (const { measure, version, sample } of readers) {
    assert.equal(typeof measure, "string");
    assert.ok(measure.length > 0);
    assert.ok(Number.isInteger(version) && version > 0, `version ${version} is a positive whole number`);
    assert.equal(typeof sample, "function");
  }

  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { exports: Record<string, string>; storytree?: { measures?: { from: string; export: string }[] } };
  assert.deepEqual(manifest.storytree?.measures, [{ from: "./measures", export: "HABITS_CARD_MEASURE_READERS" }]);
  assert.equal(manifest.exports["./measures"], "./src/instructions/measures.ts");

  const card = habitsCard();
  const bytes = Buffer.byteLength(card, "utf8");
  const tokens = Math.ceil(bytes / 4);
  const at = { folder: "/checkout", commit: "1111111111111111111111111111111111111111", tree: { arcs: [], stories: [] }, project: "shop", server: undefined };
  const answers = await Promise.all(readers.map((reader) => reader.sample(at)));
  assert.deepEqual(answers.map((answer) => answer?.value).sort((a, b) => (a ?? 0) - (b ?? 0)), [tokens, bytes], "one reader answers the card's tokens, the other its bytes");
  for (const answer of answers) assert.deepEqual({ runs: answer?.runs, spread: answer?.spread }, { runs: 1, spread: 0 });
});
