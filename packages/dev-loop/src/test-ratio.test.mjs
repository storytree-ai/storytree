// `pnpm test-ratio`'s report (packages/dev-loop/src/test-ratio.mjs): code lines of test and of
// implementation, per package and overall.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ratioRows } from "./test-ratio.mjs";

test("6.7 the report gives test and implementation code lines per package and overall, counting no blank or comment line and no // inside a string, template or regular expression", () => {
  const rows = ratioRows([
    { path: "packages/kettle/src/boil.ts", text: '// heats\n\nconst url = "https://x";\nconst t = `a // ${url}`;\n/* off\n   still off */ const re = /\\/\\//;\n' },
    { path: "packages/kettle/src/boil.test.ts", text: 'import { test } from "node:test";\ntest("boils", () => {});\n' },
    { path: "apps/desk/src/main.ts", text: "export const x = 1;\n" },
  ]);
  assert.deepEqual(rows, [
    ["", "test", "implementation", "ratio"],
    ["apps/desk", "0", "1", "0.00"],
    ["packages/kettle", "2", "3", "0.67"],
    ["all", "2", "4", "0.50"],
  ]);
});
