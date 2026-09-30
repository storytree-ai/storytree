// The automerge step's check (scripts/automerge-base.mjs): a pull request merges only onto the main
// its tests ran against. Two pull requests that each pass alone can together leave main red, so one
// verified against a main that has since moved is refused rather than merged.
import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeDecision } from "./automerge-base.mjs";

const M = "a".repeat(40);
const M2 = "b".repeat(40);

test("merges when main is still the commit the tests ran against", () => {
  assert.deepEqual(mergeDecision({ testedBase: M, mainHead: M }), { merge: true });
});

test("refuses when main has moved since the tests ran, and says to bring main in and push", () => {
  const decision = mergeDecision({ testedBase: M, mainHead: M2 });
  assert.equal(decision.merge, false);
  assert.match(decision.reason, /main has moved/);
  assert.match(decision.reason, /origin\/main/);
});

test("refuses when either commit is unknown: an unverifiable base is not a verified one", () => {
  assert.equal(mergeDecision({ testedBase: "", mainHead: M }).merge, false);
  assert.equal(mergeDecision({ testedBase: M, mainHead: undefined }).merge, false);
});
