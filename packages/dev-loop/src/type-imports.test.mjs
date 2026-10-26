// A type-only import ends only at the library (ADR-1017 D2): a planted checkout of three stories, read the
// way the code survey reads it, so the check and the map never disagree about what is type-only.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { typeImportProblems } from "./type-imports.mjs";

function plant(files) {
  const root = mkdtempSync(path.join(tmpdir(), "type-imports-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof text === "string" ? text : JSON.stringify(text));
  }
  return root;
}

const manifest = (name) => ({ name, type: "module", exports: { ".": "./src/index.ts" } });

test("3.8 a type-only import ending at a story other than the library is refused and named; one at the library, one by value and one in a test are not", async (t) => {
  const root = plant({
    "packages/library/package.json": manifest("@t/library"),
    "packages/library/src/index.ts": 'export type { Row } from "./row.js";\n',
    "packages/library/src/row.ts": "export type Row = { id: string };\n",
    "packages/shop/package.json": manifest("@t/shop"),
    "packages/shop/src/index.ts": 'export type { Cart } from "./cart.js";\nexport { price } from "./price.js";\n',
    "packages/shop/src/cart.ts": "export type Cart = { items: string[] };\n",
    "packages/shop/src/price.ts": "export const price = 1;\n",
    "packages/till/package.json": { ...manifest("@t/till"), dependencies: { "@t/library": "workspace:*", "@t/shop": "workspace:*" } },
    // Capability 1 reads the shop's cart by type alone: refused.
    "packages/till/src/basket.ts": 'import type { Cart } from "@t/shop";\nexport const count = (cart: Cart) => cart.items.length;\n',
    // Capability 2 takes a row's shape from the library and the shop's price by value: both pass.
    "packages/till/src/total.ts": 'import type { Row } from "@t/library";\nimport { price } from "@t/shop";\nexport const total = (rows: Row[]) => rows.length * price;\n',
    "packages/till/src/basket.test.ts": 'import { test } from "node:test";\nimport type { Cart } from "@t/shop";\nimport { count } from "./basket.js";\ntest("1.1 counts", () => { const cart: Cart = { items: [] }; count(cart); });\n',
    "packages/till/src/total.test.ts": 'import { test } from "node:test";\nimport { total } from "./total.js";\ntest("2.1 totals", () => { total([]); });\n',
  });
  t.after(() => removeTemp(root));

  const problems = await typeImportProblems(root, ["library", "shop", "till"]);

  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /packages\/till\/src\/basket\.ts/);
  assert.match(problems[0], /packages\/shop\/src\/cart\.ts/);
  assert.match(problems[0], /move it into the library/);
});
