// `pnpm lag:reads` (packages/dev-loop/src/read-latency.mjs): the page's reads timed over a seeded
// project with a fixed latency added to every query, against the real Postgres `pnpm test` provides.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";

import { measureReads, seedLagProject } from "./read-latency.mjs";

test("8.1 every query is counted and delayed, seeding is neither, and the reported time is the median", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  const timers = t.mock.method(globalThis, "setTimeout");
  const addedWaits = () => timers.mock.calls.filter(({ arguments: args }) => args[1] === 40);
  try {
    await seedLagProject(storytree, url, project, { arcs: 3, incrementsPerArc: 2, stories: 1 });
    // Keep the database reads real; supply three elapsed times (90, 10, 30 ms).
    // Their median differs from the first, minimum, maximum and mean.
    const times = [0, 90, 100, 110, 200, 230];
    const clock = t.mock.method(performance, "now", () => times.shift());
    const quick = await measureReads({ storytree, project, delayMs: 0, rounds: 3, reads: ["arcViews"] });
    clock.mock.restore();
    assert.equal(addedWaits().length, 0, "neither the seed nor the undelayed read adds latency");
    const slow = await measureReads({ storytree, project, delayMs: 40, rounds: 1, reads: ["arcViews"] });
    const [fast] = quick.filter(({ read }) => read === "arcViews");
    const [delayed] = slow.filter(({ read }) => read === "arcViews");
    assert.equal(fast.ms, 30, "report the median of the measured rounds");
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

test("8.1 pnpm lag:reads reports the same query count with and without added latency", () => {
  assert.ok(process.env.STORYTREE_TEST_PG_URL, "run the tests via `pnpm test`");
  const run = (delay) => execFileSync(process.execPath, [process.env.npm_execpath, "--silent", "run", "lag:reads", "--delay", String(delay), "--rounds", "3", "--reads", "arcViews"], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)), encoding: "utf8", timeout: 30_000,
  });
  // A bounded command check on the test database, with no performance budget.
  const reports = [run(0), run(40)];
  const rows = reports.map((report, i) => {
    assert.match(report, new RegExp(`lag:reads: ${i * 40} ms added per query, median of 3`));
    const row = report.match(/^arcViews\s+(\d+)\s+(\d+)$/m);
    assert.ok(row, report);
    return { queries: Number(row[1]), ms: Number(row[2]) };
  });
  assert.ok(rows[0].queries > 0);
  assert.equal(rows[1].queries, rows[0].queries);
});
