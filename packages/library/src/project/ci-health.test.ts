/**
 * Capability 8 · Cloud connection (GCP), contract 8.4 (ADR-0747): CI's health account, granted
 * exactly what each authored grants.sql grants, opens the project, records a contract's verified
 * health, and is refused any other record and any change to the tables; the project's owner is
 * unaffected. Run here as Cloud SQL runs it: a role that owns the project's database, an owner's
 * account acting as it (contract 8.3), and CI's account with no role to take on. grants.sql is run
 * as written for CI and the library host, with only its two names (the database, CI's user)
 * swapped for this test's. Its health history cannot reserve or raise decision numbers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { Knowledge } from "../knowledge/index.js";
import { connect as connectProjects } from "./index.js";
import { NumberTakenError } from "../transactions/index.js";
import { createTestRole, dropTestDatabases, dropTestRoles, testServerUrl, uniqueProjectName, withTestClient, withTestClientAs } from "../testing/pg.js";

const GRANTS_FILES = ["ci-health", "library-host"];

function as(user: string): string {
  const url = new URL(testServerUrl());
  url.username = user;
  return url.href;
}

for (const source of GRANTS_FILES) test(`8.4 CI's health account (${source}/grants.sql) writes health without controlling storytree decision numbers`, async () => {
  const run = uniqueProjectName();
  const [owner, ci, creator] = [`${run}-owner@storytree.test`, `${run}-ci-health@storytree.test`, `${run}-creator`];
  const database = `storytree_${run}`;
  const opened: { close(): Promise<void> }[] = [];
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

    const grants = readFileSync(new URL(`../../../../infra/${source}/grants.sql`, import.meta.url), "utf8")
      .replaceAll("storytree_storytree", database).replaceAll("storytree-ci-health@storytree-498613.iam", ci);
    await withTestClientAs(owner, (client) => client.query(grants), database);

    const ownerProjects = await connectProjects({ url: as(owner) });
    opened.push(ownerProjects);
    const ownerProject = await ownerProjects.openProject(run);
    // Exact production numbering mode over real SchemaRecords/PgTransactions, while the
    // disposable database retains its unique test name for isolation and safe cleanup.
    const decisions = new Knowledge(ownerProject.records, "storytree");
    const decision = { title: "Use a queue", text: "Jobs wait their turn.", status: "accepted" as const };
    await decisions.setDecisionNumberFloor(662, { apply: true });
    assert.equal((await decisions.recordDecision(decision)).fields.number, 663);
    await ownerProject.transactions.save({ id: "old-artifact", type: "legacy", fields: { number: 1000 } });
    await ownerProject.transactions.retire({ id: "old-artifact", reason: "its number remains reserved" });

    const onCi = await connect({ url: as(ci) });
    opened.push(onCi);
    const recorder = await onCi.openProject(run);
    // The same account on a plain connection of its own: its rights, not the library's care.
    const asCi = (sql: string, params: unknown[] = []) => withTestClientAs(ci, (client) => client.query(sql, params), database);
    await recorder.recordVerified(contract.id, "passing", { by: "storytree test run on CI", note: "1/1 tests passed" });
    assert.equal((await onLaptop.health(contract.id)).verified.state, "passing", "the owner reads what CI recorded");

    // These are the health role's actual SQL rights, bypassing application validation. A
    // fresh-id event needs no current row; its arbitrary number must have no authority.
    const poison = { id: "fresh-health", type: "health", version: 1, fields: { number: 5000 } };
    assert.equal((await asCi(
      "INSERT INTO record_event (record_id, type, action, record) VALUES ($1, 'health', 'created', $2::jsonb)",
      [poison.id, JSON.stringify(poison)],
    )).rowCount, 1, "the authored grants accept the health event");
    assert.equal(await ownerProject.transactions.get(poison.id), null, "history alone exercises the boundary");
    await assert.rejects(asCi(
      "INSERT INTO record_event (record_id, type, action, record) VALUES ('forbidden-decision', 'decision', 'created', $1::jsonb)",
      [JSON.stringify({ ...poison, id: "forbidden-decision", type: "decision" })],
    ), /row-level security/);
    await assert.rejects(asCi(
      "INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ('forbidden-decision', 'decision', 1, $1::jsonb, now(), now())",
      [JSON.stringify({ ...decision, number: 5000 })],
    ), /row-level security/);
    assert.equal((await decisions.recordDecision(decision)).fields.number, 1001, "only non-health history raises the floor");
    await assert.rejects(decisions.recordDecision({ ...decision, number: 1000 }), NumberTakenError);
    assert.equal((await decisions.recordDecision({ ...decision, number: 5000 })).fields.number, 5000, "health cannot reserve an explicit number");
    await assert.rejects(decisions.recordDecision({ ...decision, number: 5000 }), NumberTakenError, "the owner's decision now reserves it");
    assert.equal((await decisions.recordDecision(decision)).fields.number, 5001, "owner decisions still advance numbering");

    // Anything but health is refused, and leaves nothing behind.
    await assert.rejects(recorder.addStory({ title: "Refunds", description: "Written by CI?" }), /row-level security/);
    // Rows it may not change are not there for it to change: the edit finds no story, and a plain
    // UPDATE changes no row.
    assert.equal(await recorder.editStory(story.id, { title: "Renamed by CI" }), null);
    assert.equal((await asCi("UPDATE record SET fields = '{}' WHERE id = $1", [story.id])).rowCount, 0);
    await assert.rejects(
      asCi("INSERT INTO record_event (record_id, type, action, record) VALUES ($1, 'health', 'updated', '{}')", [story.id]),
      /row-level security/,
      "no history entry under another record's id, even one that says it is health",
    );
    assert.deepEqual((await onLaptop.projectTree()).stories.map((each) => [each.title, each.description]), [["Checkout", "Paying for an order."]]);
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
