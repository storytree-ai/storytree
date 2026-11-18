import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { allocationProblems } from "./allocation.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("6.1 · this checkout leaves no source file of a story package unallocated, misdeclared or undeclared", async () => {
  assert.deepEqual(await allocationProblems(root), []);
});
