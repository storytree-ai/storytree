/** ADR-0650: writes use artifact kinds; opening an old project preserves its records and history. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRecords } from "../schema/records.js";
import { MemoryTransactions } from "../transactions/memory.js";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { connect } from "./storytree.js";

test("6.8 saving memory is refused with the reason and writes nothing", async () => {
  const transactions = new MemoryTransactions();
  const records = new SchemaRecords(transactions);
  await assert.rejects(records.create("memory" as never, { text: "Keep this" } as never), /memory.*harness.*artifact/i);
  assert.deepEqual(await transactions.history(), []);
});

test("6.9 opening an old project converts explicit kinds once and reports unclassified memories without losing history", async (t) => {
  const name = uniqueProjectName();
  const server = await connect({ url: testServerUrl() });
  try {
    const before = await server.openProject(name);
    const cover = await before.knowledge.recordDecision({ title: "Mailer", text: "Use a verified sender", status: "accepted" });
    const original = await before.transactions.save({ id: "old-definition", type: "memory", fields: { text: "Definition: Sender\nThe verified sending domain.", links: [cover.id] }, actor: "session:old" });
    const ambiguous = await before.transactions.save({ id: "old-unclear", type: "memory", fields: { text: "Remember to check this later" } });
    const history = await before.transactions.history();
    await before.close();
    const warnings = t.mock.method(console, "warn", () => {});
    const after = await server.openProject(name);
    const converted = await after.records.get(original.id);
    assert.equal(converted?.type, "definition");
    assert.deepEqual(converted?.fields, { term: "Sender", meaning: "The verified sending domain.", links: [cover.id] });
    assert.equal(converted?.createdAt, original.createdAt);
    assert.deepEqual(await after.knowledge.relatedNotes(cover.id), [converted]);
    assert.deepEqual(await after.transactions.get(ambiguous.id), ambiguous);
    assert.match(warnings.mock.calls.map(({ arguments: args }) => args.join(" ")).join("\n"), /old-unclear.*not converted.*history/i);
    const upgraded = await after.transactions.history();
    assert.deepEqual(upgraded.slice(0, history.length), history);
    assert.equal(upgraded.length, history.length + 1);
    assert.equal(upgraded.at(-1)?.actor, "upgrade:adr-0650");
    await after.close();
    const again = await server.openProject(name);
    assert.deepEqual(await again.transactions.history(), upgraded);
  } finally {
    await server.close();
    await dropTestDatabases([`storytree_${name}`]);
  }
});
