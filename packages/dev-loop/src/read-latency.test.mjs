// `pnpm lag:reads` (packages/dev-loop/src/read-latency.mjs): the page's reads timed over a seeded
// project with a fixed latency added to every query, against the real Postgres `pnpm test` provides.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { measureReads, seedLagProject } from "./read-latency.mjs";

test("8.1 every query a page read makes is counted and delayed by the added latency; the seeding is neither", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  try {
    await seedLagProject(storytree, url, project, { arcs: 3, incrementsPerArc: 2, stories: 1 });
    const quick = await measureReads({ storytree, url, project, delayMs: 0, rounds: 1, reads: ["arcViews"] });
    const slow = await measureReads({ storytree, url, project, delayMs: 40, rounds: 1, reads: ["arcViews"] });
    const [fast] = quick.filter(({ read }) => read === "arcViews");
    const [delayed] = slow.filter(({ read }) => read === "arcViews");
    assert.ok(fast.queries > 0, "the read's queries are counted");
    assert.equal(delayed.queries, fast.queries, "the same queries, whatever the delay");
    assert.ok(delayed.ms >= fast.ms + 40, `${delayed.ms} ms with 40 ms added per query, ${fast.ms} ms without`);
  } finally {
    await storytree.dropProject(project).catch(() => {});
    await storytree.close();
  }
});
