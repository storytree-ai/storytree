// Each story keeps its code in its own package (ADR-0649 D1-D3, in storytree 0.2's decision log):
// a story has a package, the frame (packages/app, apps/desktop) and the front door (packages/cli)
// hold no story's code, and no package reaches into another story's files. The rule lives in the
// Guardrails story (packages/guardrails), with its planted trees; `pnpm lint` refuses a change to this
// repo that breaks it in the gate and CI; this file is contract 5.1's test, run with this package's tests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { boundaryProblems } from "./package-boundaries.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("5.1 · this repo keeps every story in its own package, behind a thin frame and front door", () => {
  assert.deepEqual(boundaryProblems(root), []);
});
