/**
 * Capability 3 · Story node render (the forest story): the islands' builds take turns, one per task (3.87), so opening a
 * map with every island laid out runs no task that builds several. Plain functions, so read without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BuildTurns } from "./build-turns.js";

/** A page whose tasks run only when the test says, one at a time. */
function tasks() {
  const queued: (() => void)[] = [];
  return { nextTask: (run: () => void) => { queued.push(run); }, runOne: () => queued.shift()?.(), get count() { return queued.length; } };
}

test("3.87 · islands' builds run one per task, in the order asked", () => {
  const page = tasks(), turns = new BuildTurns(page.nextTask), ran: string[] = [];
  for (const island of ["one", "two", "three"]) turns.ask(() => ran.push(island), new AbortController().signal);
  assert.deepEqual(ran, [], "nothing builds in the task that asked");
  page.runOne();
  assert.deepEqual(ran, ["one"]);
  page.runOne();
  assert.deepEqual(ran, ["one", "two"]);
  page.runOne();
  assert.deepEqual(ran, ["one", "two", "three"]);
  assert.equal(page.count, 0, "no task is left waiting once every build ran");
});

test("3.87 · a build overtaken while it waits is passed over, and one that throws leaves the rest their turns", () => {
  const page = tasks(), turns = new BuildTurns(page.nextTask), ran: string[] = [];
  const overtaken = new AbortController();
  turns.ask(() => { throw new Error("a broken island"); }, new AbortController().signal);
  turns.ask(() => ran.push("overtaken"), overtaken.signal);
  turns.ask(() => ran.push("kept"), new AbortController().signal);
  overtaken.abort();
  assert.throws(() => page.runOne(), /a broken island/);
  page.runOne();
  assert.deepEqual(ran, ["kept"], "the overtaken build never ran, and did not take the kept one's task");
  assert.equal(page.count, 0);
});
