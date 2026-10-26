// Every line of code on an island lies in a capability's territory (ADR-0838 D5): this file is how
// `pnpm test` and CI refuse a change that leaves a story package's source file reached by no numbered test.
// The rule itself, and its planted checkouts, are the Guardrails story's (packages/guardrails).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { allocationProblems } from "./allocation.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("9.1 · this checkout leaves no source file of a story package unallocated, misdeclared or undeclared", async () => {
  assert.deepEqual(await allocationProblems(root), []);
});
