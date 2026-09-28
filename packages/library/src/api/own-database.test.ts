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
