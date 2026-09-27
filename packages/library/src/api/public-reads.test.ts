/** Capability 7.5: whole-record reads agree with the memory twin; history stays as written. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect, NewerSchemaError, UnknownTypeError, type HistoryEntry, type HistoryFilter, type Library, type SchemaRecord } from "@storytree/library";
import { connect as connectProject } from "../project/index.js";
import { SchemaRecords } from "../schema/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { MemoryTransactions } from "../transactions/index.js";

for (const backend of ["memory", "public postgres"] as const) {
  test(`7.5 [${backend}] get/list read live records whole and history keeps every original write`, async () => {
    const name = uniqueProjectName();
    const server = backend === "memory" ? undefined : await connectProject({ url: testServerUrl() });
    const api = backend === "memory" ? undefined : await connect({ url: testServerUrl() });
    try {
      const project = await server?.openProject(name);
      const transactions = project?.transactions ?? new MemoryTransactions();
      const records = project?.records ?? new SchemaRecords(transactions);
      const reader: Pick<Library, "get" | "list" | "history"> = await api?.openProject(name) ?? records;
      assert.equal(await reader.get("missing"), null);
      assert.deepEqual(await reader.list("story"), []);
      assert.deepEqual(await reader.history({ id: "missing" }), []);

      const original = await records.create("story", { title: "Sign up", description: "Visitors join." }, { id: "z-story", actor: "person:Sam" });
      const first = await records.create("story", { title: "First by id" }, { id: "a-story" });
      await records.create("memory", { text: "Not a story" });
      const edited = await records.edit(original.id, { title: "Join" }, { actor: "session:agent-42" });
      assert.deepEqual(await reader.get(original.id), edited, "the complete envelope and fields");
      const stories: SchemaRecord<"story">[] = await reader.list("story");
      assert.deepEqual(stories, [first, edited], "only this kind, in id order");

      await records.retire(original.id, "Superseded", { actor: "person:Sam" });
      assert.equal(await reader.get(original.id), null);
      assert.deepEqual(await reader.list("story"), [first]);
      const filter: HistoryFilter = { id: original.id };
      const history: HistoryEntry[] = await reader.history(filter);
      assert.deepEqual(history.map(({ recordId, type, action, record, actor, reason }) => ({ recordId, type, action, record, actor, reason })), [
        { recordId: original.id, type: "story", action: "created", record: original, actor: "person:Sam", reason: undefined },
        { recordId: original.id, type: "story", action: "updated", record: edited, actor: "session:agent-42", reason: undefined },
        { recordId: original.id, type: "story", action: "retired", record: edited, actor: "person:Sam", reason: "Superseded" },
      ]);
      for (const [index, entry] of history.entries()) {
        assert.ok(Number.isFinite(Date.parse(entry.at)), "history carries when it was written");
        if (index > 0) assert.ok(entry.seq > history[index - 1]!.seq);
      }
      assert.deepEqual(await reader.history({ id: original.id, since: history[0]!.seq }), history.slice(1));
      assert.equal(Object.hasOwn((await reader.history({ id: first.id }))[0]!, "actor"), false);
      const all = await reader.history();
      assert.equal(all.length, 5);
      assert.deepEqual(await reader.history({ since: history[0]!.seq }), all.slice(1));
      assert.deepEqual(await reader.history({ since: all.at(-1)!.seq }), []);

      // Live reads upgrade old records; history must not rewrite the past or add a new event.
      const old = await transactions.save({ id: "old-arc", type: "arc", version: 1, fields: { title: "Launch", description: "Ship sign-up" } });
      const before = await transactions.history();
      const upgraded = await reader.get(old.id);
      assert.equal(upgraded?.type, "arc");
      assert.equal(upgraded?.version, 2);
      assert.equal(upgraded?.type === "arc" && upgraded.fields.intent, "Ship sign-up");
      assert.deepEqual(await reader.list("arc"), [upgraded]);
      assert.deepEqual((await reader.history({ id: old.id }))[0]?.record, old);
      assert.deepEqual(await transactions.history(), before, "reads write nothing");

      // A caller owns its returned data, never the store's current record or history.
      upgraded!.fields.title = "Changed locally";
      history[0]!.record.fields.title = "Changed locally";
      const unchanged = await reader.get(old.id);
      assert.equal(unchanged?.type === "arc" && unchanged.fields.title, "Launch");
      assert.equal((await reader.history({ id: original.id }))[0]?.record.fields.title, "Sign up");
      await assert.rejects(reader.list("unknown" as never), UnknownTypeError);
      await transactions.save({ id: "future-story", type: "story", version: 999, fields: { title: "Future" } });
      await assert.rejects(reader.get("future-story"), NewerSchemaError);
      await assert.rejects(reader.list("story"), NewerSchemaError);
    } finally {
      await api?.close();
      await server?.close();
      if (server !== undefined) await dropTestDatabases([`storytree_${name}`]);
    }
  });
}
