// Cleanup behind cloud connection contract 8.1 must never hide a database it failed to drop.
import assert from "node:assert/strict";
import { test } from "node:test";

import { dropTestDatabases, uniqueProjectName } from "./pg.js";

test("database cleanup propagates errors other than a refusal to terminate a backend", async () => {
  for (const error of [
    Object.assign(new Error("must be owner of database"), { code: "42501", routine: "dropdb" }),
    Object.assign(new Error("database has prepared transactions"), { code: "55006", routine: "TerminateOtherDBBackends" }),
  ]) {
    let attempts = 0;
    await assert.rejects(dropTestDatabases([uniqueProjectName()], {
      query: async () => { attempts++; throw error; },
    }), (caught: unknown) => caught === error);
    assert.equal(attempts, 1);
  }
});

test("database cleanup propagates a database still in use after a bounded number of tries instead of leaving it silently or retrying forever", async () => {
  const termination = Object.assign(new Error("permission denied to terminate process"), {
    code: "42501", routine: "TerminateOtherDBBackends",
  });
  const occupied = Object.assign(new Error("database is being accessed by other users"), { code: "55006", routine: "dropdb" });
  let attempts = 0;
  await assert.rejects(dropTestDatabases([uniqueProjectName()], {
    query: async () => { throw ++attempts === 1 ? termination : occupied; },
  }), (caught: unknown) => caught === occupied);
  assert.equal(attempts, 7, "FORCE, then plain DROP and its five retries");
});
