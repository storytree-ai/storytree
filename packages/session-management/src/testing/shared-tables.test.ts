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
      await reader.query(`SELECT count(*) FROM ${first}`);
      // The change takes the second table, then, a moment later, the first: the order a rules change meets it in.
      const change = changeSharedTables(undefined, (client) =>
        client.query(`LOCK TABLE ${second} IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(0.3); LOCK TABLE ${first} IN ACCESS EXCLUSIVE MODE`),
      );
      await waitUntil(async () => {
        const held = await reader.query("SELECT 1 FROM pg_locks WHERE relation = $1::regclass AND mode = 'AccessExclusiveLock' AND granted", [second]);
        return held.rowCount === 1;
      }, 10_000, "the change to hold the second table");
      // The reader now waits on the change, and the change will wait on the reader: Postgres must end one of them.
      await reader.query(`SELECT count(*) FROM ${second}`);
      await reader.query("COMMIT");
      await change;
    });
  } finally {
    await withTestClient((client) => client.query(`DROP TABLE IF EXISTS ${first}, ${second}`));
  }
});
