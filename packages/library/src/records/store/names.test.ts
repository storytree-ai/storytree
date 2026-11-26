import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../../project/index.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../../testing/pg.js";
import { MemoryTransactions } from "./memory.js";
import { PgTransactions } from "./pg.js";
import type { Transactions } from "./types.js";

async function listsNaming(store: Transactions): Promise<void> {
  const held = await store.save({ id: "a-held", type: "note", fields: { capability: "cap_1", title: "Holds it" } });
  const listed = await store.save({ id: "b-listed", type: "other", fields: { capabilities: ["cap_0", "cap_1", "cap_2"] } });
  await store.save({ id: "c-prose", type: "note", fields: { body: "this mentions cap_1 in prose", title: "cap_1 and more" } });
  await store.save({ id: "d-nested", type: "note", fields: { anchor: { capability: "cap_1" } } });
  await store.save({ id: "e-near", type: "note", fields: { capability: "cap_10", capabilities: ["cap_1x", "xcap_1"] } });
  await store.save({ id: "f-object-member", type: "note", fields: { members: [{ id: "cap_1" }] } });
  const last = await store.save({ id: "g-last", type: "note", fields: { links: ["cap_1"], status: "open" } });
  await store.save({ id: "h-gone", type: "note", fields: { capability: "cap_1" } });
  await store.retire({ id: "h-gone", reason: "retired" });
  await store.save({ id: "i-unasked", type: "third", fields: { capability: "cap_1" } });
  const other = await store.save({ id: "j-other-id", type: "note", fields: { capability: "cap_2" } });

  assert.deepEqual(await store.list(["note", "other"], { names: "cap_1" }), [held, listed, last], "a field holding it and a list holding it, of the types asked, in id order");
  assert.deepEqual(await store.list("note", { names: "cap_2" }), [other]);
  assert.deepEqual(await store.list(["note", "other"], { names: "cap_9" }), [], "none for an id nothing names");
  assert.deepEqual(await store.list(["note", "other"], { names: "cap_1", where: { status: "open" } }), [last], "it narrows with the other filters");
}

test("2.26 · [memory] list narrows to the records naming an id in a top-level field, as its value or a member of its list; prose, nested fields, near misses and retired records do not count", async () => {
  await listsNaming(new MemoryTransactions());
});

test("2.26 · [postgres] list narrows to the records naming an id in a top-level field, as its value or a member of its list; prose, nested fields, near misses and retired records do not count", async () => {
  const name = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const project = await storytree.openProject(name);
    await listsNaming(new PgTransactions(project.pool));
  } finally {
    try {
      await storytree.close();
    } finally {
      await dropTestDatabases([`storytree_${name}`]);
    }
  }
});
