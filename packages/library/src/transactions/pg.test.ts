/**
 * Capability 2's behaviour suite against Postgres. Each test gets a fresh project, opened through
 * capability 1 on the server `pnpm test` provides and named with uniqueProjectName(), and a
 * PgTransactions on that project's pool. The project's database is dropped afterwards, pass or
 * fail, so tests share the server without seeing each other's records. Then contract 2.21, which only Postgres can be
 * behind for.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { transactionsBehaviourSuite } from "./behaviour-suite.js";
import { PgTransactions } from "./pg.js";

transactionsBehaviourSuite("postgres", async () => {
  const name = uniqueProjectName();
  const database = `storytree_${name}`;
  const storytree = await connect({ url: testServerUrl() });
  const dispose = async (): Promise<void> => {
    try {
      await storytree.close();
    } finally {
      await dropTestDatabases([database]);
    }
  };
  try {
    const project = await storytree.openProject(name);
    return { store: new PgTransactions(project.pool), cleanup: dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
});

test("2.21 [postgres] a library whose history has no place for the outside-text mark yet writes and reads its history as before, leaving the mark off", async () => {
  const name = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const project = await storytree.openProject(name);
    // As a shared library stands until merged code, opened with its owner's rights, adds the column.
    await project.pool.query("ALTER TABLE record_event DROP COLUMN outside_read");
    const store = new PgTransactions(project.pool);
    const outsideRead = () => ["gh pr view 12"];
    await store.save({ id: "p-1", type: "principle", fields: { v: 1 }, actor: "session:one", outsideRead });
    await store.edit({ id: "p-1", fields: { v: 2 }, actor: "session:one", outsideRead });
    await store.retire({ id: "p-1", reason: "overtaken", actor: "session:one", outsideRead });
    await store.save({ id: "n-1", type: "note", fields: { v: 1 }, actor: "session:one" });
    const history = await store.history();
    assert.deepEqual(history.map((entry) => [entry.recordId, entry.action, entry.outsideRead]),
      [["p-1", "created", undefined], ["p-1", "updated", undefined], ["p-1", "retired", undefined], ["n-1", "created", undefined]]);
    assert.equal((await store.revertWrites({ of: "session:one", actor: "session:two" })).length, 1, "revertWrites reads the history too");
    assert.equal((await storytree.snapshot(name)).history.length, 5, "and so does a snapshot");
  } finally {
    try {
      await storytree.close();
    } finally {
      await dropTestDatabases([`storytree_${name}`]);
    }
  }
});
