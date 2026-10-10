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
  const writer = await (await first.ownDatabase(name, { tables })).connect();
  try {
    await writer.query("BEGIN");
    await writer.query("INSERT INTO entries (said) VALUES ('mid-write')");
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<"waited">((resolve) => (timer = setTimeout(() => resolve("waited"), 5000)));
    const opened = await Promise.race([second.ownDatabase(name, { tables }).then(() => "opened" as const), waited]);
    clearTimeout(timer);
    assert.equal(opened, "opened", "the second connection's set-up waited on the writer's lock");
    await writer.query("COMMIT");
  } finally {
    await writer.query("ROLLBACK").catch(() => undefined);
    writer.release();
    await Promise.all([first.close(), second.close()]);
    await dropTestDatabases([name]);
  }
});
