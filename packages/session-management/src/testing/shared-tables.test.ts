/**
 * Capability 2 · Agent activity log, contract 2.14's own harness: the cloud account's tests change the rules of tables
 * every other test on the server reads at once, and that change must never be what fails another test.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { withTestClient } from "@storytree/library/testing/pg";
import { waitUntil } from "@storytree/test-waits";

import { changeSharedTables } from "./shared-tables.js";

test("2.14 · A change to shared tables that meets another test's reader in a deadlock loses it and is made again, and the reader's transaction goes on", async () => {
  const [first, second] = ["a", "b"].map((name) => `shared_tables_${name}_${randomBytes(4).toString("hex")}`) as [string, string];
  await withTestClient((client) => client.query(`CREATE TABLE ${first} (n int); CREATE TABLE ${second} (n int)`));
  try {
    await withTestClient(async (reader) => {
      // The reader holds the first table, as a test reading the log inside a transaction does.
      await reader.query("BEGIN");
      assert.equal((await reader.query(`SELECT count(*)::int AS n FROM ${first}`)).rows[0].n, 0);
      // The change takes the second table and, once the reader waits on it, the first: the order a rules change meets
      // it in. Postgres must then end one of them; the reader waited first, so its deadlock check would end the reader.
      let attempts = 0;
      const change = changeSharedTables(undefined, async (client) => {
        attempts++;
        await client.query("BEGIN");
        await client.query(`LOCK TABLE ${second} IN ACCESS EXCLUSIVE MODE`);
        if (attempts === 1) {
          await waitUntil(async () => {
            const waiting = await client.query("SELECT 1 FROM pg_locks WHERE relation = $1::regclass AND NOT granted", [second]);
            return waiting.rowCount === 1;
          }, 10_000, "the reader to wait on the second table");
        }
        await client.query(`LOCK TABLE ${first} IN ACCESS EXCLUSIVE MODE`);
        await client.query("COMMIT");
        return "made";
      });
      await waitUntil(async () => {
        const held = await withTestClient((watcher) => watcher.query("SELECT 1 FROM pg_locks WHERE relation = $1::regclass AND mode = 'AccessExclusiveLock' AND granted", [second]));
        return held.rowCount === 1;
      }, 10_000, "the change to hold the second table");
      assert.equal((await reader.query(`SELECT count(*)::int AS n FROM ${second}`)).rows[0].n, 0, "the reader's read is answered, not ended by a deadlock");
      await reader.query("COMMIT");
      assert.equal(await change, "made");
      assert.equal(attempts, 2, "the change gave up its first try and was made on the second");
    });
  } finally {
    await withTestClient((client) => client.query(`DROP TABLE IF EXISTS ${first}, ${second}`));
  }
});
