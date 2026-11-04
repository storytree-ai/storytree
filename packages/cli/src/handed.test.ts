/**
 * Capability 16 · Build and launch, contracts 16.2 and 16.3: the command's entry refuses a word changed on its way, on
 * every platform's reading of the words it was handed (the built command reaches these refusals only on Windows).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { changedOnItsWay } from "./handed.js";

test("16.2 a word pnpm's script shell changed is refused by its place, counting from 1, and its first line; words that arrived as written are not", () => {
  const refused = changedOnItsWay(["library", "a word that", "x"], ["library", "a word that\nruns over $HOME", "x"], undefined);

  assert.match(refused ?? "", /changed word 2 \("a word that…"\)/);
  assert.match(refused ?? "", /@<file>/);
  assert.equal(changedOnItsWay(["library", "search"], ["library", "search"], undefined), undefined);
  assert.equal(changedOnItsWay(["library"], undefined, undefined), undefined);
});

test("16.3 a word whose double quotes the caller's own quoting changed, read from the launcher's line, is refused by its place; a line quoted by Windows' standard rules is not", () => {
  const refused = changedOnItsWay(["library", "he said x ok"], undefined, 'library "he said "x" ok"');

  assert.match(refused ?? "", /word 2 \("he said x ok"\) arrived with its double quotes changed/);
  assert.equal(changedOnItsWay(["library", 'he said "x" ok'], undefined, 'library "he said \\"x\\" ok"'), undefined);
});
