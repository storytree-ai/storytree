// Capability 8 · Storytree's own test and gate entries. ADR-1199 D2 / increment_343265b93ea4: storytree's three
// code-structure rules run as one lint step, `pnpm lint`, in the gate and in CI on every pull request.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { gateSteps } from "./gate-steps.mjs";
import { lint, RULES } from "./lint.mjs";

test("8.5 pnpm lint runs the three rules and fails naming each rule and file that breaks; it passes when none does", async (t) => {
  assert.deepEqual(RULES.map(({ name }) => name), ["type-imports", "package-boundaries", "allocation"]);

  const root = mkdtempSync(path.join(tmpdir(), "lint-"));
  t.after(() => removeTemp(root));
  mkdirSync(path.join(root, "packages", "mark", "src"), { recursive: true });
  writeFileSync(path.join(root, "packages", "mark", "src", "orphan.mjs"), "export const orphan = 1;\n");
  const lines = [];
  const code = await lint({ root, rules: RULES.filter(({ name }) => name === "allocation"), log: (line) => lines.push(line) });
  assert.equal(code, 1);
  assert.ok(lines.some((line) => /^allocation: packages\/mark\/src\/orphan\.mjs /.test(line)), lines.join("\n"));

  const broken = [{ name: "clean", problems: async () => [] }, { name: "rule-b", problems: () => ["packages/x/a.ts breaks it", "packages/x/b.ts too"] }];
  lines.length = 0;
  assert.equal(await lint({ root, rules: broken, log: (line) => lines.push(line) }), 1);
  assert.deepEqual(lines.slice(0, 2), ["rule-b: packages/x/a.ts breaks it", "rule-b: packages/x/b.ts too"]);
  assert.match(lines.at(-1), /2 problems/);

  lines.length = 0;
  assert.equal(await lint({ root, rules: broken.slice(0, 1), log: (line) => lines.push(line) }), 0);
  assert.match(lines.at(-1), /clean/);
});

test("8.5 the gate runs pnpm lint as one of its steps, in place of the type-import check on its own", () => {
  const names = gateSteps.map(({ name }) => name);
  assert.ok(names.includes("lint"), names.join(", "));
  assert.ok(!names.includes("check:type-imports"), names.join(", "));
  const { args } = gateSteps.find(({ name }) => name === "lint").command();
  assert.equal(args.at(-1), "packages/repo-checks/src/lint.mjs");
});
