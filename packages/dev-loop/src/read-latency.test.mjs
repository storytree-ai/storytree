// `pnpm lag:reads` (packages/dev-loop/src/read-latency.mjs): the page's reads timed over a seeded
// project with a fixed latency added to every query, against the real Postgres `pnpm test` provides.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { measureReads, seedLagProject } from "./read-latency.mjs";

test("8.1 every query a page read makes is counted and delayed by the added latency; the seeding is neither", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  const timers = t.mock.method(globalThis, "setTimeout");
  const addedWaits = () => timers.mock.calls.filter(({ arguments: args }) => args[1] === 40);
  try {
    await seedLagProject(storytree, url, project, { arcs: 3, incrementsPerArc: 2, stories: 1 });
    // Reproduce a loaded machine pausing the undelayed sample for a second.
    const realNow = performance.now.bind(performance);
    let clockReads = 0;
    const clock = t.mock.method(performance, "now", () => realNow() + (++clockReads === 2 ? 1_000 : 0));
    const quick = await measureReads({ storytree, project, delayMs: 0, rounds: 1, reads: ["arcViews"] });
    clock.mock.restore();
    assert.equal(addedWaits().length, 0, "neither the seed nor the undelayed read adds latency");
    const slow = await measureReads({ storytree, project, delayMs: 40, rounds: 1, reads: ["arcViews"] });
    const [fast] = quick.filter(({ read }) => read === "arcViews");
    const [delayed] = slow.filter(({ read }) => read === "arcViews");
    assert.ok(fast.queries > 0, "the read's queries are counted");
    assert.equal(delayed.queries, fast.queries, "the same queries, whatever the delay");
    assert.equal(addedWaits().length, delayed.queries, "every counted query requests the full 40 ms delay");
    // Timer rounding can finish just shy of 40 ms; contention can only lengthen this read.
    // The exact requested delay is checked above, independently of either run's wall time.
    assert.ok(delayed.ms >= 20, `${delayed.ms} ms with 40 ms added per query`);
  } finally {
    await storytree.dropProject(project).catch(() => {});
    await storytree.close();
  }
});
