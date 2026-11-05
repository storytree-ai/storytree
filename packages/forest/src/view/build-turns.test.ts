/**
 * Capability 3 · Story node render (the forest story): the islands' builds take turns, a few to a task (3.87), so opening
 * a map with every island laid out runs no long task that builds several. Plain functions, so read without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BuildTurns } from "./build-turns.js";

/** A page whose tasks run only when the test says, one at a time, on a clock each build moves. */
function tasks() {
  const queued: (() => void)[] = [];
  let ms = 0;
  return {
    nextTask: (run: () => void) => { queued.push(run); }, runOne: () => queued.shift()?.(), get count() { return queued.length; },
    now: () => ms, takes: (spent: number) => { ms += spent; },
  };
}

test("3.87 · islands' builds run in the order asked, in later tasks, the next only while it fits the task's budget", () => {
  const page = tasks(), turns = new BuildTurns(page.nextTask, 50, page.now), ran: string[] = [];
  for (const [island, ms] of [["one", 20], ["two", 20], ["three", 20], ["four", 10], ["five", 60], ["six", 1]] as const) {
    turns.ask(() => { ran.push(island); page.takes(ms); }, new AbortController().signal);
  }
  assert.deepEqual(ran, [], "nothing builds in the task that asked");
  page.runOne();
  assert.deepEqual(ran, ["one", "two"], "40 ms in, another 20 ms build would pass 50 ms, so the task ends");
  page.runOne();
  assert.deepEqual(ran.slice(2), ["three", "four", "five"], "builds that fit share a task; one over the budget runs, and ends it");
  page.runOne();
  assert.deepEqual(ran.slice(5), ["six"]);
  assert.equal(page.count, 0, "no task is left waiting once every build ran");
});

test("3.87 · a build overtaken while it waits is passed over, and one that throws leaves the rest their turns", () => {
  const page = tasks(), turns = new BuildTurns(page.nextTask, 50, page.now), ran: string[] = [];
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
