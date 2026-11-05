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

test("5.2 a type-only import ending at a story other than the library is refused and named; one at the library, one by value, one in a test and one between two capabilities of the importer's own story are not", async (t) => {
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
    "packages/till/src/basket.ts": 'import type { Cart } from "@t/shop";\nexport type Line = string;\nexport const count = (cart: Cart) => cart.items.length;\n',
    // Capability 2 takes a row's shape from the library and the shop's price by value: both pass.
    "packages/till/src/total.ts": 'import type { Row } from "@t/library";\nimport { price } from "@t/shop";\nexport const total = (rows: Row[]) => rows.length * price;\n',
    // Capability 3 reads capability 1's line by type alone, inside the till's own story: passes.
    "packages/till/src/receipt.ts": 'import type { Line } from "./basket.js";\nexport const print = (line: Line) => line;\n',
    "packages/till/src/receipt.test.ts": 'import { test } from "node:test";\nimport { print } from "./receipt.js";\ntest("3.1 prints", () => { print(""); });\n',
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

test("5.3 a type-only import whose importer also imports the same story by value from another capability names both capabilities and says the type may move to the value edge's side", async (t) => {
  const root = plant({
    "packages/shop/package.json": manifest("@t/shop"),
    "packages/shop/src/index.ts": 'export type { Cart } from "./cart.js";\nexport { price } from "./price.js";\n',
    // A re-cut moved the cart to capability 2, leaving the price in capability 1.
    "packages/shop/src/cart.ts": "export type Cart = { items: string[] };\nexport const empty: Cart = { items: [] };\n",
    "packages/shop/src/price.ts": "export const price = 1;\n",
    "packages/shop/src/cart.test.ts": 'import { test } from "node:test";\nimport { empty } from "./cart.js";\ntest("2.1 empty", () => { void empty; });\n',
    "packages/shop/src/price.test.ts": 'import { test } from "node:test";\nimport { price } from "./price.js";\ntest("1.1 price", () => { void price; });\n',
    "packages/till/package.json": { ...manifest("@t/till"), dependencies: { "@t/shop": "workspace:*" } },
    "packages/till/src/total.ts": 'import type { Cart } from "@t/shop";\nimport { price } from "@t/shop";\nexport const total = (cart: Cart) => cart.items.length * price;\n',
  });
  t.after(() => removeTemp(root));

  const problems = await typeImportProblems(root, ["library", "shop", "till"]);

  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /packages\/shop\/src\/cart\.ts is shop's capability 2/);
  assert.match(problems[0], /packages\/shop\/src\/price\.ts \(capability 1\) by value/);
  assert.match(problems[0], /move the type to the value edge's side/);
});
