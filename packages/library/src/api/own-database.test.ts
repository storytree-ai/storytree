/**
 * Capability 7 · Library API, contract 7.7: a connection hands its caller one named database of its
 * own beside the projects, on the same server (ADR-0735 D3). Its database is dropped afterwards.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";

test("7.7 a connection's own database is made the first time, is never a project, and closes with the connection", async () => {
  const name = `storytree-own-${uniqueProjectName()}`;
  const storytree = await connect({ url: testServerUrl() });
  try {
    const pool = await storytree.ownDatabase(name);
    assert.equal((await pool.query<{ db: string }>("SELECT current_database() AS db")).rows[0]?.db, name);
    assert.equal(await storytree.ownDatabase(name), pool, "asking again hands back the same pool");
    assert.ok(!(await storytree.listProjects()).some((project) => project.includes("own-")), "it is not listed as a project");
    await assert.rejects(storytree.ownDatabase("storytree_site"), /project/i, "a project's database is never handed out");
    await storytree.close();
    assert.equal(pool.ended, true);
  } finally {
    await storytree.close();
    await dropTestDatabases([name]);
  }
});

test("7.7 a caller hands in its tables and gets its own database set up: connections setting it up at once all succeed, and every table is there", async () => {
  const name = `storytree-own-${uniqueProjectName()}`;
  const tables = ["CREATE TABLE IF NOT EXISTS entries (id serial PRIMARY KEY, said text NOT NULL)", "CREATE INDEX IF NOT EXISTS entries_said ON entries (said)"];
  const connections = await Promise.all(Array.from({ length: 4 }, () => connect({ url: testServerUrl() })));
  try {
    const pools = await Promise.all(connections.map((storytree) => storytree.ownDatabase(name, { tables })));
    await pools[0]?.query("INSERT INTO entries (said) VALUES ('hello')");
    assert.deepEqual((await pools[3]?.query<{ said: string }>("SELECT said FROM entries"))?.rows, [{ said: "hello" }]);
    assert.equal(await connections[0]?.ownDatabase(name), pools[0], "a reader asking without tables gets the same pool");
  } finally {
    await Promise.all(connections.map((storytree) => storytree.close()));
    await dropTestDatabases([name]);
  }
});

test("7.7 once its tables are there, a new connection's set-up runs no DDL, so it never waits behind a writer's open transaction", async () => {
  const name = `storytree-own-${uniqueProjectName()}`;
  const tables = ["CREATE TABLE IF NOT EXISTS entries (id serial PRIMARY KEY, said text NOT NULL)", "ALTER TABLE entries ADD COLUMN IF NOT EXISTS at timestamptz"];
  const first = await connect({ url: testServerUrl() });
  const second = await connect({ url: testServerUrl() });
  const pool = await first.ownDatabase(name, { tables });
  const writer = await pool.connect();
  let opening: Promise<unknown> = Promise.resolve();
  try {
    await writer.query("BEGIN");
    await writer.query("INSERT INTO entries (said) VALUES ('mid-write')");
    // The server says when a backend in this database waits on a lock (asked outside the writer's
    // transaction, which reads its activity as it stood when it began): the set-up must finish without one.
    let settled = false;
    opening = second.ownDatabase(name, { tables }).finally(() => (settled = true));
    let waited = false;
    while (!settled && !waited) {
      const { rows } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
      waited = rows.length > 0;
    }
    assert.equal(waited, false, "the second connection's set-up waited on the writer's lock");
    await opening;
    await writer.query("COMMIT");
  } finally {
    await writer.query("ROLLBACK").catch(() => undefined);
    writer.release();
    await opening.catch(() => undefined);
    await Promise.all([first.close(), second.close()]);
    await dropTestDatabases([name]);
  }
});
