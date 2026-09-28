/**
 * Capability 2 · Agent activity log, contract 2.5 (ADR-0735 D3): the log opens on whichever server
 * the library resolved to, through the library's connection, so two machines sharing one library
 * share one log. Here "two machines" are two connections, each naming its own machine.
 *
 * Against the test server always; against a real Cloud SQL instance only when it is given one and
 * an account (STORYTREE_TEST_CLOUDSQL_INSTANCE / STORYTREE_TEST_CLOUDSQL_USER, as the library's
 * contract 8.1 takes them); without them that half is skipped, visibly and with the reason.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect, type ConnectOptions } from "@storytree/library";

import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { ACTIVITY_DATABASE, openActivityLog } from "./index.js";

const CONTRACT = "2.5 lines two machines write for one project, each through its own library connection, are both read back from either, in order";

async function twoMachines(library: ConnectOptions): Promise<void> {
  const project = uniqueProjectName();
  const [laptop, mint] = await Promise.all([connect(library), connect(library)]);
  try {
    const [fromLaptop, fromMint] = await Promise.all([
      openActivityLog(laptop, { machine: "laptop" }),
      openActivityLog(mint, { machine: "mint" }),
    ]);
    await fromLaptop.append(project, { session: "a", harness: "claude-code", source: "hook", kind: "command-run", command: "first" });
    await fromMint.append(project, { session: "b", harness: "codex", source: "hook", kind: "command-run", command: "second" });
    for (const log of [fromLaptop, fromMint]) {
      const { lines } = await log.since(project, 0);
      assert.deepEqual(lines.map((line) => [line.session, line.machine]), [["a", "laptop"], ["b", "mint"]]);
    }
    await Promise.all([fromLaptop.close(), fromMint.close()]);
  } finally {
    // Only this test's lines go; the log's database is shared by everything on the server.
    await (await laptop.ownDatabase(ACTIVITY_DATABASE)).query("DELETE FROM activity WHERE project = $1", [project]).catch(() => undefined);
    await Promise.all([laptop.close(), mint.close()]);
  }
}

test(`${CONTRACT} (local server)`, () => twoMachines({ url: testServerUrl() }));

const instance = process.env.STORYTREE_TEST_CLOUDSQL_INSTANCE ?? "";
const user = process.env.STORYTREE_TEST_CLOUDSQL_USER ?? "";
test(`${CONTRACT} (Cloud SQL, live)`, {
  skip: instance === "" || user === "" ? "live Cloud SQL proof needs STORYTREE_TEST_CLOUDSQL_INSTANCE/USER — owner-gated" : false,
}, () => twoMachines({ cloudSql: { instance, user } }));
