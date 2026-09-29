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
