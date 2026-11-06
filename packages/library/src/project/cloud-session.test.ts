/**
 * Capability 30 · Outside writers, contracts 30.6 and 30.7 (ADR-1264 D1): the cloud sessions' own account, granted
 * exactly what infra/library-host/cloud-session-grants.sql grants, opens the project as itself, reads every record and
 * writes, edits and retires the kinds a pool lane writes through storytree's own writes, and is refused everything else.
 * Run as the Mint box runs it: a role that owns the project's database, an owner's account acting as it (contract 28.1),
 * and the cloud account with no role to take on. The file is run as written, with only its two names (the database, and
 * the psql variable cloud_role) filled in with this test's.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { connect as connectLibrary, type Library } from "@storytree/library";

import { Knowledge } from "../knowledge/index.js";
import { connect } from "./index.js";
import { PgVectors } from "./embeddings.js";
import type { Project } from "./storytree.js";
import { createTestRole, dropTestDatabases, dropTestRoles, testRoleUrl as as, uniqueProjectName, withTestClient, withTestClientAs } from "../testing/pg.js";

interface Granted {
  /** The project, opened by its owner's account: its records, and its plan as the library's front doors write it. */
  readonly owner: Project;
  readonly ownerPlan: Library;
  /** The same project, opened by the cloud sessions' account. */
  readonly cloud: Project;
  readonly cloudPlan: Library;
  /** Run one statement as the cloud account on a plain connection of its own: its rights, not the library's care. */
  readonly cloudSql: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: any[] }>;
  readonly role: string;
}

/** A project its owner has written a plan, a decision and an agent role into, and the cloud account granted the file. */
async function withCloudAccount(body: (granted: Granted) => Promise<void>): Promise<void> {
  const run = uniqueProjectName();
  const [owner, cloud, creator] = [`${run}-owner`, `${run}-cloud`, `${run}-creator`];
  const database = `storytree_${run}`;
  const opened: { close(): Promise<void> }[] = [];
  try {
    await createTestRole(owner, { createdb: false });
    await createTestRole(cloud, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${owner}"`));

    const onBox = await connect({ url: as(owner) });
    opened.push(onBox);
    const ownerProject = await onBox.openProject(run);
    await new Knowledge(ownerProject.records, "storytree").setDecisionNumberFloor(1263, { apply: true });
    await ownerProject.transactions.save({ id: "agent-orchestrator", type: "agent", fields: { title: "Orchestrator" } });

    const grants = readFileSync(new URL("../../../../infra/library-host/cloud-session-grants.sql", import.meta.url), "utf8")
      .replaceAll("storytree_storytree", database).replaceAll(':"cloud_role"', `"${cloud}"`).replaceAll(":'cloud_role'", `'${cloud}'`);
    await withTestClientAs(owner, (client) => client.query(grants), database);

    const [inCloud, ownerLibrary, cloudLibrary] = [await connect({ url: as(cloud) }), await connectLibrary({ url: as(owner) }), await connectLibrary({ url: as(cloud) })];
    opened.push(inCloud, ownerLibrary, cloudLibrary);
    await body({
      owner: ownerProject,
      ownerPlan: await ownerLibrary.openProject(run),
      cloud: await inCloud.openProject(run),
      cloudPlan: await cloudLibrary.openProject(run),
      cloudSql: (sql, params = []) => withTestClientAs(cloud, (client) => client.query(sql, params), database),
      role: cloud,
    });
  } finally {
    await Promise.allSettled(opened.map((each) => each.close()));
    await dropTestDatabases([database]);
    await dropTestRoles([cloud, owner, creator]);
  }
}

test("30.6 · The cloud sessions' account opens the project as itself, reads every record, and writes, edits and retires through storytree's own writes the kinds a pool lane writes", async () => {
  await withCloudAccount(async ({ owner, ownerPlan, cloud, cloudPlan, cloudSql, role }) => {
    const story = await ownerPlan.addStory({ title: "Checkout", description: "Paying for an order." });
    const capability = await ownerPlan.addCapability({ title: "1 · Card payment", story: story.id });

    // It reads what a lane reads: the plan, the decisions and agent roles, and their history.
    assert.deepEqual((await cloudPlan.projectTree()).stories.map((each) => each.title), ["Checkout"]);
    assert.equal((await cloud.transactions.get("agent-orchestrator"))?.type, "agent");
    assert.ok((await cloud.transactions.history({ id: "agent-orchestrator" })).length > 0);

    // It writes the plan, edits the owner's, records health, and takes the next decision number from the history.
    const contract = await cloudPlan.addContract({ title: "1.1 · A declined card is refused", capability: capability.id });
    await cloudPlan.editStory(story.id, { title: "Paying" });
    await cloudPlan.recordVerified(contract.id, "passing", { by: "storytree test run in a cloud session", note: "1/1 tests passed" });
    assert.equal((await new Knowledge(cloud.records, "storytree").recordDecision({ title: "Overflow", text: "To the cloud.", status: "accepted" })).fields.number, 1264);
    for (const [id, type] of [
      ["arc-overflow", "arc"], ["increment-overflow", "increment"], ["question-overflow", "question"], ["friction-overflow", "friction"],
      ["resteer-overflow", "resteer"], ["principle-overflow", "principle"], ["research-overflow", "research"], ["fyi-overflow", "fyi"],
    ] as const) {
      await cloud.transactions.save({ id, type, fields: { title: `A ${type}` } });
      assert.equal((await cloud.transactions.edit({ id, fields: { title: `The ${type}` } }))?.fields.title, `The ${type}`, type);
    }

    // It retires one: the record leaves the table only after its retirement is in the history, which keeps it.
    await cloud.transactions.retire({ id: "increment-overflow", reason: "overtaken" });
    assert.equal(await owner.transactions.get("increment-overflow"), null);
    assert.deepEqual((await owner.transactions.history({ id: "increment-overflow" })).map((entry) => entry.action), ["created", "updated", "retired"]);

    // It fills ranked search's cache.
    const vectors = new PgVectors(cloud.pool);
    await vectors.put("a-model", new Map([["a-key", new Float32Array([1, 2])]]));
    assert.deepEqual([...(await vectors.get("a-model", ["a-key"])).get("a-key")!], [1, 2]);

    assert.equal((await ownerPlan.projectTree()).stories[0]?.title, "Paying", "the owner reads what the cloud wrote");
    assert.deepEqual((await cloudSql("SELECT DISTINCT recorded_by FROM record_event WHERE record_id = 'arc-overflow'")).rows, [{ recorded_by: role }],
      "each history entry carries the cloud account");
  });
});

test("30.7 · The cloud sessions' account is refused a kind it is not granted, a change of kind, history under another kind's id, a removal that is not a retirement, and any change to history or the tables", async () => {
  await withCloudAccount(async ({ owner, ownerPlan, cloud, cloudSql }) => {
    const story = await ownerPlan.addStory({ title: "Checkout", description: "Paying for an order." });

    // A kind it is not granted, new or the owner's.
    for (const type of ["agent", "voice.note", "decisionNumbering", "process", "feedback"]) {
      await assert.rejects(cloud.transactions.save({ id: `new-${type}`, type, fields: { title: "Written in the cloud?" } }), /row-level security/, type);
    }
    assert.equal(await cloud.transactions.edit({ id: "agent-orchestrator", fields: { title: "Rewritten" } }), null, "the agent role is not there for it to change");
    await cloud.transactions.retire({ id: "agent-orchestrator", reason: "gone?" });
    assert.ok(await owner.transactions.get("agent-orchestrator"), "nor there for it to retire");

    // A record keeps its kind, in the table and in the history, even between two kinds it may write.
    await assert.rejects(cloud.transactions.save({ id: story.id, type: "increment", fields: { title: "Rekinded" } }), /row-level security/);
    await assert.rejects(cloudSql("UPDATE record SET type = 'arc' WHERE id = $1", [story.id]), /row-level security/);
    for (const id of [story.id, "agent-orchestrator"]) {
      await assert.rejects(cloudSql(
        "INSERT INTO record_event (record_id, type, action, record) VALUES ($1, 'increment', 'updated', $2::jsonb)",
        [id, JSON.stringify({ id, type: "increment" })],
      ), /row-level security/, id);
    }
    await assert.rejects(cloudSql(
      "INSERT INTO record_event (record_id, type, action, record) VALUES ('sly', 'increment', 'created', '{\"id\": \"other\", \"type\": \"increment\"}')",
    ), /row-level security/, "an entry holds the record of its own id");

    // A live record leaves the table only after its retirement; history is never changed or removed.
    assert.equal((await cloudSql("DELETE FROM record WHERE id = $1", [story.id])).rowCount, 0);
    for (const change of ["UPDATE record_event SET reason = 'rewritten'", "DELETE FROM record_event", "TRUNCATE record_event", "TRUNCATE record"]) {
      await assert.rejects(cloudSql(change), /permission denied|append-only/, change);
    }
    for (const other of ["SELECT count(*) FROM media", "SELECT count(*) FROM feedback_screenshot", "SELECT count(*) FROM history_repair"]) {
      await assert.rejects(cloudSql(other), /permission denied/, other);
    }

    // No change to the tables, and no way out of the rules.
    for (const ddl of [
      "CREATE TABLE cloud_own (n int)",
      "ALTER TABLE record DISABLE ROW LEVEL SECURITY",
      "DROP POLICY cloud_session_insert ON record",
      "DROP TABLE record_event",
      "CREATE OR REPLACE FUNCTION cloud_session_kinds() RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['agent'] $$",
      "CREATE INDEX IF NOT EXISTS record_updated_idx ON record (updated_at)",
    ]) {
      await assert.rejects(cloudSql(ddl), /must be owner|permission denied/, ddl);
    }

    assert.deepEqual((await ownerPlan.projectTree()).stories.map((each) => each.title), ["Checkout"], "the owner's story is as it wrote it");
    await owner.transactions.save({ id: "agent-librarian", type: "agent", fields: { title: "Librarian" } });
    await owner.transactions.retire({ id: story.id, reason: "the owner is unaffected" });
  });
});
