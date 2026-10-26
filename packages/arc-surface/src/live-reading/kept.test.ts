import assert from "node:assert/strict";
import { test } from "node:test";
import { pageKept, type PageStorage } from "./kept.js";

function memory(): PageStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
const isList = (value: unknown): value is number[] => Array.isArray(value) && value.every((each) => typeof each === "number");

test("a surface's last state is kept across starts; an unreadable, foreign or unavailable store gives nothing and never throws", () => {
  const storage = memory();
  pageKept("board:p", isList, storage).write([1, 2]);
  assert.deepEqual(pageKept("board:p", isList, storage).read(), [1, 2]);
  assert.equal(pageKept("board:q", isList, storage).read(), undefined, "each key keeps its own");
  storage.values.set("board:p", "{not json");
  assert.equal(pageKept("board:p", isList, storage).read(), undefined);
  storage.values.set("board:p", JSON.stringify({ an: "older shape" }));
  assert.equal(pageKept("board:p", isList, storage).read(), undefined);
  const refusing: PageStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
  assert.equal(pageKept("board:p", isList, refusing).read(), undefined);
  assert.doesNotThrow(() => pageKept("board:p", isList, refusing).write([3]));
  assert.equal(pageKept("board:p", isList, null).read(), undefined, "no page storage at all");
});
