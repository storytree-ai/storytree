/**
 * Capability 1 · Project libraries, contracts 1.23-1.25 (ADR-1178 D1 and D5): an outside writer's own database role,
 * fenced by fenceOutsideWriter as the project database's owner, inserts only its plugin's kinds, is refused everything
 * else, and its rows carry its role in `recorded_by`. Run as Cloud SQL and the Mint box run it: a role that owns the
 * project's database, an owner's account acting as it, and the writer's account with no role to take on. The writer
 * writes as storytree writes a record (the history entry first, then the record put with INSERT ... ON CONFLICT DO
 * UPDATE), on a plain connection of its own: its rights, not the library's care.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client } from "pg";

import { connect } from "./index.js";
import { fenceOutsideWriter, type OutsideWriter } from "./outside-writer.js";
import { createTestRole, dropTestDatabases, dropTestRoles, testRoleUrl as as, uniqueProjectName, withTestClient, withTestClientAs } from "../testing/pg.js";

interface Fenced {
  /** Run `fn` on a connection of the writer's own. */
  readonly asWriter: <T>(fn: (client: Client) => Promise<T>) => Promise<T>;
  /** Run one statement as the writer. */
  readonly writerSql: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: any[] }>;
  /** Run one statement as the server's superuser, which the policies do not bind. */
  readonly adminSql: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  /** Fence the writer again, with another grant, as the owner. */
  readonly refence: (grant: Omit<OutsideWriter, "role">) => Promise<void>;
  readonly writer: string;
  readonly story: string;
}

/** A project with one story, written by its owner, and a writer fenced by `grant` (its role filled in). */
async function withFencedWriter(grant: Omit<OutsideWriter, "role">, body: (fenced: Fenced) => Promise<void>): Promise<void> {
  const run = uniqueProjectName();
  const [owner, writer, creator] = [`${run}-owner`, `${run}-writer`, `${run}-creator`];
  const database = `storytree_${run}`;
  const opened: { close(): Promise<void> }[] = [];
  try {
    await createTestRole(owner, { createdb: false });
    await createTestRole(writer, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${owner}"`));
    const storytree = await connect({ url: as(owner) });
    opened.push(storytree);
    const project = await storytree.openProject(run);
    await project.transactions.save({ id: "story-checkout", type: "story", fields: { title: "Checkout" } });

    await withTestClientAs(owner, (client) => fenceOutsideWriter(client, { role: writer, ...grant }), database);

    const asWriter = <T>(fn: (client: Client) => Promise<T>) => withTestClientAs(writer, fn, database);
    await body({
      asWriter,
      writerSql: (sql, params = []) => asWriter((client) => client.query(sql, params)),
      adminSql: (sql, params = []) => withTestClient((client) => client.query(sql, params), database),
      refence: (narrower) => withTestClientAs(owner, (client) => fenceOutsideWriter(client, { role: writer, ...narrower }), database),
      writer,
      story: "story-checkout",
    });
  } finally {
    await Promise.allSettled(opened.map((each) => each.close()));
    await dropTestDatabases([database]);
    await dropTestRoles([writer, owner, creator]);
  }
}

/** Write one record as storytree does: its history entry first, then the record itself, in one transaction. */
async function put(client: Client, id: string, type: string, action: "created" | "updated" = "created"): Promise<void> {
  const record = { id, type, version: 1, fields: { text: `${type} ${id}` }, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z" };
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO record_event (record_id, type, action, record, actor, at) VALUES ($1, $2, $3, $4::jsonb, 'the door', now())",
      [id, type, action, JSON.stringify(record)],
    );
    await client.query(
      `INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ($1, $2, 1, $3::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET type = excluded.type, version = excluded.version, fields = excluded.fields,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
      [id, type, JSON.stringify(record.fields)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

test("1.23 · An outside writer's role, fenced to its plugin's kinds, inserts a record of its own kind, and each history entry carries its role in recorded_by", async () => {
  await withFencedWriter({ kinds: ["voice.note"] }, async ({ asWriter, adminSql, writer }) => {
    await asWriter((client) => put(client, "note-1", "voice.note"));
    await asWriter((client) => put(client, "note-2", "voice.note"));

    assert.deepEqual((await adminSql("SELECT id, type FROM record WHERE type = 'voice.note' ORDER BY id")).rows,
      [{ id: "note-1", type: "voice.note" }, { id: "note-2", type: "voice.note" }]);
    assert.deepEqual((await adminSql("SELECT record_id, actor, recorded_by FROM record_event WHERE type = 'voice.note' ORDER BY seq")).rows, [
      { record_id: "note-1", actor: "the door", recorded_by: writer },
      { record_id: "note-2", actor: "the door", recorded_by: writer },
    ], "the door is read from the database's stamp, beside whatever actor the writer sends");
    assert.deepEqual((await asWriter((client) => client.query("SELECT id FROM record ORDER BY id"))).rows.map((row) => row.id),
      ["note-1", "note-2"], "it reads its own kind, and the owner's story is not there for it");
  });
});

test("1.24 · An outside writer's role is refused a core kind, another plugin's kind, an update, a delete and any change to the tables", async () => {
  await withFencedWriter({ kinds: ["voice.note"] }, async ({ asWriter, writerSql, adminSql, refence, writer, story }) => {
    // The template itself fences a writer to one plugin's kinds: it will not grant a core kind, nor two plugins'.
    await assert.rejects(refence({ kinds: ["decision"] }), /only a plugin's kinds/);
    await assert.rejects(refence({ kinds: ["voice.note", "diary.entry"] }), /one plugin, not voice and diary/);
    await asWriter((client) => put(client, "note-1", "voice.note"));

    for (const [id, type] of [["decision-1", "decision"], ["story-2", "story"], ["mark-1", "voice.mark"], ["other-1", "diary.entry"]]) {
      await assert.rejects(asWriter((client) => put(client, id!, type!)), /row-level security/, type);
      await assert.rejects(writerSql(
        "INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ($1, $2, 1, '{}', now(), now())", [id, type],
      ), /row-level security/, `${type}, the record alone`);
    }
    // A history entry that says it is the writer's kind is refused when its record is not, or its id names another
    // record, its own included: an insert-only writer adds history for a new record only.
    await assert.rejects(writerSql(
      "INSERT INTO record_event (record_id, type, action, record) VALUES ('sly', 'voice.note', 'created', '{\"id\": \"sly\", \"type\": \"decision\"}')",
    ), /row-level security/);
    for (const id of [story, "note-1"]) {
      await assert.rejects(writerSql(
        "INSERT INTO record_event (record_id, type, action, record) VALUES ($1, 'voice.note', 'created', $2::jsonb)",
        [id, JSON.stringify({ id, type: "voice.note" })],
      ), /row-level security/, id);
    }

    // No update, its own record included: storytree's put of an existing id is refused, and a plain UPDATE finds no row.
    await assert.rejects(asWriter((client) => put(client, "note-1", "voice.note", "updated")), /row-level security/);
    assert.equal((await writerSql("UPDATE record SET fields = '{}' WHERE id = 'note-1'")).rowCount, 0);
    assert.equal((await writerSql("UPDATE record SET fields = '{}' WHERE id = $1", [story])).rowCount, 0);
    for (const remove of ["DELETE FROM record WHERE id = 'note-1'", "DELETE FROM record_event", "TRUNCATE record"]) {
      await assert.rejects(writerSql(remove), /permission denied|append-only/, remove);
    }
    for (const ddl of [
      "CREATE TABLE door_own (n int)",
      "ALTER TABLE record DISABLE ROW LEVEL SECURITY",
      `DROP POLICY "${writer} insert" ON record`,
      "CREATE INDEX IF NOT EXISTS record_updated_idx ON record (updated_at)",
    ]) {
      await assert.rejects(writerSql(ddl), /must be owner|permission denied/, ddl);
    }

    assert.deepEqual((await adminSql("SELECT id, fields->>'text' AS text FROM record ORDER BY id")).rows,
      [{ id: "note-1", text: "voice.note note-1" }, { id: story, text: null }], "nothing but its first note was written");
  });
});

test("1.25 · An outside writer whose plugin declares updates may change its own kind's records, and still no other record nor another kind", async () => {
  await withFencedWriter({ kinds: ["voice.note"], update: true, reads: ["story"] }, async ({ asWriter, writerSql, adminSql, refence, story }) => {
    await asWriter((client) => put(client, "note-1", "voice.note"));
    await asWriter((client) => put(client, "note-1", "voice.note", "updated"));
    assert.deepEqual((await adminSql("SELECT action FROM record_event WHERE record_id = 'note-1' ORDER BY seq")).rows.map((row) => row.action),
      ["created", "updated"]);

    assert.equal((await writerSql("UPDATE record SET type = 'decision' WHERE id = 'note-1'").catch((error: Error) => error.message)),
      'new row violates row-level security policy for table "record"', "it may not turn its record into another kind");
    assert.equal((await writerSql("UPDATE record SET fields = '{}' WHERE id = $1", [story])).rowCount, 0, "it reads the story, and still may not change it");
    await assert.rejects(writerSql(
      "INSERT INTO record_event (record_id, type, action, record) VALUES ($1, 'voice.note', 'updated', $2::jsonb)",
      [story, JSON.stringify({ id: story, type: "voice.note" })],
    ), /row-level security/, "no history under another kind's id");
    assert.deepEqual((await asWriter((client) => client.query("SELECT id FROM record ORDER BY id"))).rows.map((row) => row.id),
      ["note-1", story], "it reads the kinds its grant names");

    // Applied again narrower, the update and the read it was given are taken back.
    await refence({ kinds: ["voice.note"] });
    await assert.rejects(asWriter((client) => put(client, "note-1", "voice.note", "updated")), /row-level security/);
    assert.deepEqual((await asWriter((client) => client.query("SELECT id FROM record ORDER BY id"))).rows.map((row) => row.id), ["note-1"]);
  });
});
