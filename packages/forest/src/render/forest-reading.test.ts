/**
 * The forest's reading: the live reading's news, with the project's tree read again when the library
 * changed. A first read that fails, as a slow or cloud library's connection timeout can, is retried
 * until it lands, so the forest is drawn once the library answers. The reads and timers are stand-ins.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Timers } from "@storytree/arc-surface";
import type { AnnotatedTree } from "@storytree/library";

import { forestReading, type ForestReads } from "./forest-reading.js";

const tree: AnnotatedTree = { arcs: [], stories: [] } as unknown as AnnotatedTree;

/** Timers that fire only when the test ticks them. */
function handTimers(): Timers & { tick(): Promise<void> } {
  const runs: (() => void)[] = [];
  return {
    now: () => 0,
    every(ms, run) {
      if (ms === 2_000) runs.push(run);
      return () => runs.splice(runs.indexOf(run), 1);
    },
    async tick() {
      for (const run of runs) run();
      await settle();
    },
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

test("a first read of the tree that fails is retried, and the forest is drawn once the library answers", async () => {
  let failing = true;
  const reads: ForestReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => {
      if (failing) throw new Error("Connection terminated due to connection timeout");
      return tree;
    },
  };
  const timers = handTimers();
  const drawn: AnnotatedTree[] = [];
  const errors: unknown[] = [];
  const reading = forestReading({ project: "shop", reads, timers, onTree: (read) => drawn.push(read), onError: (error) => errors.push(error) });
  await settle();
  assert.equal(errors.length, 1);
  assert.equal(drawn.length, 0);

  failing = false;
  await timers.tick();
  assert.deepEqual(drawn, [tree]);
  reading.stop();
});

/** Timers whose clock the test sets, firing every 2-second ask when ticked. */
function clockTimers(): Timers & { at: number; tick(): Promise<void> } {
  const runs: (() => void)[] = [];
  return {
    at: 0,
    now() { return this.at; },
    every(ms, run) {
      if (ms === 2_000) runs.push(run);
      return () => runs.splice(runs.indexOf(run), 1);
    },
    async tick() {
      for (const run of [...runs]) run();
      await settle();
    },
  };
}

const survey = { "story-shop": { files: [{ path: "src/claim.ts", lines: 1 }], imports: [] } };

test("the tree is drawn without waiting for the code's survey, and drawn again with the survey once it lands", async () => {
  let land: (value: typeof survey) => void = () => {};
  const reads: ForestReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => tree,
    codeSurvey: () => new Promise((resolve) => { land = resolve; }),
  };
  const drawn: unknown[] = [];
  const reading = forestReading({ project: "shop", reads, timers: clockTimers(), onTree: (_read, _news, read) => drawn.push(read), onError: () => {} });
  await settle();
  assert.deepEqual(drawn, [{}]);

  land(survey);
  await settle();
  assert.deepEqual(drawn, [{}, survey]);
  reading.stop();
});

test("the code is surveyed again at most every 10 seconds however often the tree changes, and a change in between is surveyed once they pass", async () => {
  let cursor = 0;
  let surveys = 0;
  const reads: ForestReads = {
    changesSince: async () => ({ changes: [{ seq: ++cursor } as never], cursor }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => tree,
    codeSurvey: async () => (surveys++, survey),
  };
  const timers = clockTimers();
  const drawn: unknown[] = [];
  const reading = forestReading({ project: "shop", reads, timers, onTree: (_read, _news, read) => drawn.push(read), onError: () => {} });
  await settle();
  assert.equal(surveys, 1);

  for (let second = 2; second < 10; second += 2) {
    timers.at = second * 1_000;
    await timers.tick();
  }
  assert.equal(surveys, 1);

  timers.at = 10_000;
  await timers.tick();
  assert.equal(surveys, 2);
  assert.deepEqual(drawn.at(-1), survey);
  reading.stop();
});
