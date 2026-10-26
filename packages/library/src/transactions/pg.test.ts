/**
 * Capability 2's behaviour suite against Postgres. Each test gets a fresh project, opened through
 * capability 1 on the server `pnpm test` provides and named with uniqueProjectName(), and a
 * PgTransactions on that project's pool. The project's database is dropped afterwards, pass or
 * fail, so tests share the server without seeing each other's records.
 */
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
