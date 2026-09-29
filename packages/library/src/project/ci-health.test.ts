/**
 * Capability 8 · Cloud connection (GCP), contract 8.4 (ADR-0747): CI's health account, granted
 * exactly what infra/ci-health/grants.sql grants, opens the project, records a contract's verified
 * health, and is refused any other record and any change to the tables; the project's owner is
 * unaffected. Run here as Cloud SQL runs it: a role that owns the project's database, an owner's
 * account acting as it (contract 8.3), and CI's account with no role to take on. grants.sql is run
 * as written, with only its two names (the database, CI's user) swapped for this test's.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { connect, type Storytree } from "@storytree/library";

import { createTestRole, dropTestDatabases, dropTestRoles, testServerUrl, uniqueProjectName, withTestClient, withTestClientAs } from "../testing/pg.js";

const GRANTS = readFileSync(new URL("../../../../infra/ci-health/grants.sql", import.meta.url), "utf8");

function as(user: string): string {
  const url = new URL(testServerUrl());
  url.username = user;
  return url.href;
}

test("8.4 CI's health account (grants.sql) records a contract's verified health and is refused any other record and any table change", async () => {
  const run = uniqueProjectName();
  const [owner, ci, creator] = [`${run}-owner@storytree.test`, `${run}-ci-health@storytree.test`, `${run}-creator`];
  const database = `storytree_${run}`;
  const opened: Storytree[] = [];
  try {
    await createTestRole(owner, { createdb: false });
    await createTestRole(ci, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${owner}"`));

    const laptop = await connect({ url: as(owner) });
    opened.push(laptop);
    const onLaptop = await laptop.openProject(run);
    const story = await onLaptop.addStory({ title: "Checkout", description: "Paying for an order." });
    const capability = await onLaptop.addCapability({ title: "1 · Card payment", story: story.id });
    const contract = await onLaptop.addContract({ title: "1.1 · A declined card is refused", capability: capability.id });

    const grants = GRANTS.replaceAll("storytree_storytree", database).replaceAll("storytree-ci-health@storytree-498613.iam", ci);
    await withTestClientAs(owner, (client) => client.query(grants), database);

    const onCi = await connect({ url: as(ci) });
    opened.push(onCi);
    const recorder = await onCi.openProject(run);
    // The same account on a plain connection of its own: its rights, not the library's care.
    const asCi = (sql: string, params: unknown[] = []) => withTestClientAs(ci, (client) => client.query(sql, params), database);
    await recorder.recordVerified(contract.id, "passing", { by: "storytree test run on CI", note: "1/1 tests passed" });
    assert.equal((await onLaptop.health(contract.id)).verified.state, "passing", "the owner reads what CI recorded");

    // Anything but health is refused, and leaves nothing behind.
    await assert.rejects(recorder.addStory({ title: "Refunds", description: "Written by CI?" }), /row-level security/);
    await assert.rejects(recorder.editStory(story.id, { title: "Renamed by CI" }), /row-level security/);
    await assert.rejects(
      asCi("INSERT INTO record_event (record_id, type, action, record) VALUES ($1, 'health', 'updated', '{}')", [story.id]),
      /row-level security/,
      "no history entry under another record's id, even one that says it is health",
    );
    assert.equal((await onLaptop.projectTree()).stories.map((each) => each.title).join(), "Checkout");
    // No change to the tables, and no way out of the rule.
    for (const ddl of [
      "CREATE INDEX IF NOT EXISTS record_updated_idx ON record (updated_at)",
      "ALTER TABLE record DISABLE ROW LEVEL SECURITY",
      "DROP POLICY IF EXISTS ci_health_insert ON record",
      "CREATE TABLE ci_own (n int)",
    ]) {
      await assert.rejects(asCi(ddl), /must be owner|permission denied/, ddl);
    }

    // The owner is unaffected: it still writes every kind of record.
    await onLaptop.addStory({ title: "Refunds", description: "Written by the owner." });
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestDatabases([database]);
    await dropTestRoles([ci, owner, creator]);
  }
});
