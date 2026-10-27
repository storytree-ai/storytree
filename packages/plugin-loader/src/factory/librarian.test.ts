/**
 * Capability 5 · Factory plugins, contract 5.10 (ADR-1178 D5, question_0700cb2e567c: option A): a plugin's manifest
 * names its own librarian's database role and update right, storytree fences that role from it to the plugin's kinds,
 * and the database refuses that librarian a core kind. Run as 1.24 runs: a role that owns the project's database, the
 * owner's account fencing the writer the manifest gives, and the librarian's own account writing as storytree writes.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { connect, fenceOutsideWriter } from "@storytree/library";
import { createTestRole, dropTestDatabases, dropTestRoles, testRoleUrl, uniqueProjectName, withTestClient, withTestClientAs } from "@storytree/library/testing/pg";

import { checkPlugin } from "./contract.js";
import { PLUGIN_INTERFACE, pluginLibrarian } from "./factory.js";

const note = (writers: readonly string[]) => ({
  kind: "voice.note",
  version: 1,
  writers,
  fields: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false },
});

/** A factory folder holding one plugin per entry, each with a storytree manifest of the given extra fields. */
function factory(t: TestContext, plugins: Readonly<Record<string, Record<string, unknown>>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-factory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, manifest] of Object.entries(plugins)) {
    mkdirSync(path.join(root, "plugins", name), { recursive: true });
    writeFileSync(path.join(root, "plugins", name, "package.json"), JSON.stringify({ name, type: "module", storytree: { interface: PLUGIN_INTERFACE, ...manifest } }));
  }
  return root;
}

/** Write one record as storytree does, as `client`: its history entry first, then the record, in one transaction. */
async function put(client: { query(sql: string, params?: unknown[]): Promise<unknown> }, id: string, type: string, action: "created" | "updated" = "created"): Promise<void> {
  const record = { id, type, version: 1, fields: { text: id }, createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z" };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO record_event (record_id, type, action, record, actor, at) VALUES ($1, $2, $3, $4::jsonb, 'librarian', now())", [id, type, action, JSON.stringify(record)]);
    await client.query(
      `INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ($1, $2, 1, $3::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET fields = excluded.fields, updated_at = excluded.updated_at`,
      [id, type, JSON.stringify(record.fields)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

test("5.10 · A plugin's manifest names its librarian's own database role and update right; storytree fences that role from it to the plugin's kinds, and the database refuses the librarian's write to a core kind", async (t) => {
  const run = uniqueProjectName();
  const [owner, librarian, creator] = [`${run}-owner`, `${run}-librarian`, `${run}-creator`];
  const database = `storytree_${run}`;
  const folder = factory(t, {
    voice: { recordKinds: [note(["storytree_voice"])], librarian: { role: librarian, update: true } },
    shared: { recordKinds: [{ ...note([librarian]), kind: "shared.note" }], librarian: { role: librarian } },
    roleless: { recordKinds: [{ ...note(["storytree_voice"]), kind: "roleless.note" }], librarian: { update: true } },
    kindless: { librarian: { role: librarian } },
    quiet: { recordKinds: [{ ...note(["storytree_voice"]), kind: "quiet.note" }] },
  });

  const writer = pluginLibrarian(folder, "voice");
  assert.deepEqual(writer, { role: librarian, kinds: ["voice.note"], update: true }, "its own role, every kind of its plugin, and the right to change them");
  assert.equal(pluginLibrarian(folder, "quiet"), undefined, "a plugin naming no librarian has none");
  for (const [plugin, why] of [
    ["shared", /librarian's role .* also writes shared\.note: give the librarian a role of its own/],
    ["roleless", /roleless's librarian names no role/],
    ["kindless", /kindless's librarian has no kinds to keep/],
  ] as const) {
    assert.throws(() => pluginLibrarian(folder, plugin), why, plugin);
    assert.match(checkPlugin(folder, plugin).problems.join("\n"), why, `plugin check says so for ${plugin} too`);
  }
  assert.deepEqual(checkPlugin(folder, "voice").adds, { recordKinds: 1, librarian: 1 });

  const opened: { close(): Promise<void> }[] = [];
  try {
    await createTestRole(owner, { createdb: false });
    await createTestRole(librarian, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${owner}"`));
    const storytree = await connect({ url: testRoleUrl(owner) });
    opened.push(storytree);
    await storytree.openProject(run);
    await withTestClientAs(owner, (client) => put(client, "story-checkout", "story"), database);

    await withTestClientAs(owner, (client) => fenceOutsideWriter(client, writer!), database);

    const asLibrarian = <T>(fn: (client: { query(sql: string, params?: unknown[]): Promise<any> }) => Promise<T>) => withTestClientAs(librarian, fn, database);
    await asLibrarian((client) => put(client, "note-1", "voice.note"));
    await asLibrarian((client) => put(client, "note-1", "voice.note", "updated"));
    for (const type of ["story", "decision"]) {
      await assert.rejects(asLibrarian((client) => put(client, `${type}-2`, type)), /row-level security/, `${type}, a core kind`);
    }
    assert.equal((await asLibrarian((client) => client.query("UPDATE record SET fields = '{}' WHERE id = 'story-checkout'"))).rowCount, 0, "nor may it change the owner's story");
    assert.deepEqual((await withTestClient((client) => client.query("SELECT id, type FROM record ORDER BY id"), database)).rows,
      [{ id: "note-1", type: "voice.note" }, { id: "story-checkout", type: "story" }], "only its plugin's note was written, and changed");
  } finally {
    await Promise.allSettled(opened.map((each) => each.close()));
    await dropTestDatabases([database]);
    await dropTestRoles([librarian, owner, creator]);
  }
});
