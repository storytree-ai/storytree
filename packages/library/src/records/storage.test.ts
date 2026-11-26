// Capability 36 · Storage
import assert from "node:assert/strict";
import { test } from "node:test";

import { LIBRARY_SCHEMA, MemoryTransactions, SchemaError, SchemaRecords } from "./index.js";

test("36.1 · through the Storage entry, a story saved in the in-memory store with the library schema reads back the same from the store and the rules, and a story whose title is a number is refused as a schema error naming title, writing no record and no history entry", async () => {
  const transactions = new MemoryTransactions();
  const records = new SchemaRecords(transactions, LIBRARY_SCHEMA);

  const saved = await records.create("story", { title: "Visitor can sign up" }, { id: "story-1" });
  assert.deepEqual([saved.id, saved.type, saved.version, saved.fields], ["story-1", "story", 1, { title: "Visitor can sign up" }]);
  assert.deepEqual(await records.get("story-1"), saved);
  assert.deepEqual(await transactions.get("story-1"), saved);
  const history = await transactions.history();
  assert.deepEqual(history.map(({ recordId, action, record }) => [recordId, action, record]), [["story-1", "created", saved]]);

  await assert.rejects(records.create("story", { title: 42 } as never, { id: "story-bad" }), (error: unknown) => {
    assert.ok(error instanceof SchemaError, String(error));
    assert.equal(error.type, "story");
    assert.deepEqual(error.fields, ["title"]);
    assert.equal(error.message, 'story: field "title" must be a string, not a number');
    return true;
  });
  assert.equal(await transactions.get("story-bad"), null);
  assert.equal(await records.get("story-bad"), null);
  assert.deepEqual(await transactions.history(), history);
});
