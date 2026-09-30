/**
 * Capability 8 · Cloud connection (GCP), contract 8.1 in the library story: capability 2's
 * behaviour suite, unchanged, passes against a real Cloud SQL instance reached with Google sign-in.
 * Each test gets a fresh project, opened through the cloud path (connect({ cloudSql })) and named
 * with uniqueProjectName(), and a PgTransactions on that project's pool. Its database is dropped on
 * the instance afterwards, pass or fail, over a connection of its own.
 *
 * The proof is live, so it runs only when it is given an instance and an account:
 *   STORYTREE_TEST_CLOUDSQL_INSTANCE  the instance's connection name, project:region:instance
 *   STORYTREE_TEST_CLOUDSQL_USER      the Google account signed in with
 *                                     `gcloud auth application-default login`: a Cloud SQL IAM
 *                                     database user on the instance that may create databases,
 *                                     itself or through a role granted to it (an IAM user cannot
 *                                     be given CREATEDB, so the owner runs the two lines that
 *                                     opening a project without one prints)
 * Without them it is skipped, visibly and with the reason, never passed. With only one of them it
 * fails, rather than skip a proof someone meant to run.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cloudSqlServer, connect, type CloudSqlConfig } from "../project/index.js";
import { dropTestDatabases, uniqueProjectName } from "../testing/pg.js";
import { transactionsBehaviourSuite } from "./behaviour-suite.js";
import { PgTransactions } from "./pg.js";

const CONTRACT =
  "8.1 capability 2's behaviour suite, unchanged, passes against a real Cloud SQL instance reached with Google sign-in";
const OWNER_GATED =
  "owner: live Cloud SQL proof needs STORYTREE_TEST_CLOUDSQL_INSTANCE/USER and a database user that may create databases, itself or through a granted role";

const instance = process.env.STORYTREE_TEST_CLOUDSQL_INSTANCE ?? "";
const user = process.env.STORYTREE_TEST_CLOUDSQL_USER ?? "";

if (instance === "" && user === "") {
  test(CONTRACT, { skip: OWNER_GATED }, () => {});
} else if (instance === "" || user === "") {
  test(CONTRACT, () => {
    assert.fail(
      "only one of STORYTREE_TEST_CLOUDSQL_INSTANCE and STORYTREE_TEST_CLOUDSQL_USER is set: " +
        "set both to run the live proof, or neither to skip it",
    );
  });
} else {
  liveProof({ instance, user });
}

/** Register capability 2's behaviour suite, as it is, against projects on the instance `cloudSql` names. */
function liveProof(cloudSql: CloudSqlConfig): void {
  describe(CONTRACT, () => {
    transactionsBehaviourSuite("cloud-sql", async () => {
      const name = uniqueProjectName();
      const database = `storytree_${name}`;
      const storytree = await connect({ cloudSql });
      const dispose = async (): Promise<void> => {
        try {
          await storytree.close();
        } finally {
          await dropOnInstance(cloudSql, [database]);
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
  });
}

/**
 * Drop a test's databases on the instance, over a connection of their own to its `postgres`
 * database. One the user made by borrowing a role is that role's, and is dropped as the user all the
 * same (dropTestDatabases says why), as src/project/cloud-connection.test.ts proves offline.
 */
async function dropOnInstance(cloudSql: CloudSqlConfig, databases: readonly string[]): Promise<void> {
  const server = await cloudSqlServer(cloudSql);
  try {
    await dropTestDatabases(databases, server.admin);
  } finally {
    try {
      await server.admin.end();
    } finally {
      server.close();
    }
  }
}
