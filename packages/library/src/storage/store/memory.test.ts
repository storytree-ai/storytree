import assert from "node:assert/strict";
import { test } from "node:test";

import { transactionsBehaviourSuite } from "./testing/behaviour-suite.js";
import { MemoryTransactions } from "./index.js";

transactionsBehaviourSuite("memory", async () => ({
  store: new MemoryTransactions(),
  cleanup: async () => {},
}));

test("2.12 [memory] `from` keeps a retirement made at or after it, timed when it was made, not when its record was last written", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-28T09:00:00.000Z") });
  const store = new MemoryTransactions();
  await store.save({ id: "note-1", type: "note", fields: { v: 1 } });
  t.mock.timers.tick(60_000);
  await store.retire({ id: "note-1", reason: "overtaken" });

  const all = await store.history();
  assert.deepEqual(all.map((entry) => [entry.action, entry.at]), [["created", "2026-11-28T09:00:00.000Z"], ["retired", "2026-11-28T09:01:00.000Z"]]);
  assert.deepEqual(await store.history({ from: "2026-11-28T09:00:30.000Z" }), [all[1]]);
  assert.deepEqual(await store.history({ from: "2026-11-28T09:01:00.000Z" }), [all[1]]);
  assert.deepEqual(await store.history({ from: "2026-11-28T09:01:00.001Z" }), []);
});
