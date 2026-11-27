import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRecords } from "../../storage/rules/index.js";
import { MemoryTransactions } from "../../storage/store/index.js";
import { renderNote } from "./index.js";

test("14.17 · a check's embedded text holds its question, never the ids of the principles it enforces", async () => {
  const records = new SchemaRecords(new MemoryTransactions());
  const check = await records.create("check", {
    title: "Tests pin behaviour",
    description: "Each test protects a behaviour.",
    question: "Would the test fail if the behaviour were removed?",
    enforces: ["principle_0123456789ab"],
  });

  const text = renderNote(check);

  assert.match(text, /Would the test fail if the behaviour were removed\?/);
  assert.doesNotMatch(text, /principle_0123456789ab/);
});
