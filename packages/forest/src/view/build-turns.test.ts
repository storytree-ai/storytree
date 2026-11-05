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
  turns.ask(() => { ran.push("overtaken"); }, overtaken.signal);
  turns.ask(() => { ran.push("kept"); }, new AbortController().signal);
  overtaken.abort();
  assert.throws(() => page.runOne(), /a broken island/);
  page.runOne();
  assert.deepEqual(ran, ["kept"], "the overtaken build never ran, and did not take the kept one's task");
  assert.equal(page.count, 0);
});

test("3.87 · a build in steps takes a turn for each, its next step ahead of later builds, and one overtaken between steps runs no more", () => {
  const page = tasks(), turns = new BuildTurns(page.nextTask, 50, page.now), ran: string[] = [];
  const inSteps = (island: string, ms: number): (() => void) => {
    const step = (n: number) => () => { ran.push(`${island}${n}`); page.takes(ms); return n < 3 ? step(n + 1) : undefined; };
    return step(1);
  };
  const overtaken = new AbortController();
  turns.ask(inSteps("big", 30), new AbortController().signal);
  turns.ask(inSteps("small", 30), overtaken.signal);
  turns.ask(() => { ran.push("later"); page.takes(30); }, new AbortController().signal);
  page.runOne();
  assert.deepEqual(ran, ["big1"], "a 30 ms step leaves no room for another in its task");
  page.runOne();
  page.runOne();
  assert.deepEqual(ran, ["big1", "big2", "big3"], "each step in a turn of its own, ahead of the builds asked after it");
  page.runOne();
  overtaken.abort();
  page.runOne();
  page.runOne();
  assert.deepEqual(ran.slice(3), ["small1", "later"], "the overtaken build's next steps never run");
  assert.equal(page.count, 0);
});
