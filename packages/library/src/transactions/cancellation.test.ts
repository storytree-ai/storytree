/** Contract 2.11: the cancellation boundary on both transaction backends. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions } from "./memory.js";
import { PgTransactions } from "./pg.js";

for (const backend of ["memory", "postgres"] as const) {
  test(`2.11 [${backend}] cancellation before a write leaves no change; cancellation after it starts preserves the write and its history`, async () => {
    const name = uniqueProjectName();
    const server = backend === "postgres" ? await connect({ url: testServerUrl() }) : undefined;
    try {
      const store = server === undefined ? new MemoryTransactions() : new PgTransactions((await server.openProject(name)).pool);
      const original = await store.save({ id: "kept", type: "note", fields: { title: "Before cancellation" } });
      const before = await store.history();
      const cancelled = new AbortController();
      cancelled.abort(new Error("cancel queued write"));
      const options = { signal: cancelled.signal, actor: "cancelled-writer" };
      await assert.rejects(store.save({ id: "new", type: "note", fields: {}, ...options }), /cancel queued write/);
      await assert.rejects(store.edit({ id: "kept", fields: { title: "Unwanted edit" }, ...options }), /cancel queued write/);
      await assert.rejects(store.retire({ id: "kept", reason: "Unwanted retirement", ...options }), /cancel queued write/);
      assert.equal(await store.get("new"), null);
      assert.deepEqual(await store.get("kept"), original);
      assert.deepEqual(await store.history(), before);

      // Validation runs inside the write, after Postgres takes the lock. Cancelling here is too late.
      for (const verb of ["save", "edit"] as const) {
        const late = new AbortController();
        const written = await store[verb]({
          id: "kept", type: "note", fields: { title: verb }, actor: "started-writer", signal: late.signal,
          validate: () => late.abort(new Error("cancel after start")),
        });
        assert.equal(late.signal.aborted, true);
        assert.equal(written?.fields.title, verb);
        assert.deepEqual(await store.get("kept"), written);
        const history = await store.history({ id: "kept" });
        assert.deepEqual(history.at(-1)?.record, written);
        assert.equal(history.at(-1)?.actor, "started-writer");
      }
    } finally {
      if (server !== undefined) {
        try {
          await server.close();
        } finally {
          await dropTestDatabases([`storytree_${name}`]);
        }
      }
    }
  });
}
