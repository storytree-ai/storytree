// Capability 8 · Code survey
import assert from "node:assert/strict";
import { test } from "node:test";

import type { StorySurvey } from "@storytree/library";

import { nestedParts } from "./nested-parts.js";

const file = (path: string, capability?: string) => ({ path, lines: 1, ...(capability === undefined ? {} : { capability }) });

test("8.67 a capability's parts are its folders with their own entry file, nested as deep as the code goes; the package's top, a folder with no entry and a test file are no level, and a shuffled survey gives the same tree", () => {
  const survey: StorySurvey = {
    files: [
      file("src/index.ts", "cap-tax"),
      file("src/tax/index.ts", "cap-tax"), file("src/tax/rates.ts", "cap-tax"),
      file("src/tax/transactions/index.ts", "cap-tax"), file("src/tax/transactions/ledger.ts", "cap-tax"),
      file("src/tax/transactions/payments/index.ts", "cap-tax"), file("src/tax/transactions/payments/card.ts", "cap-tax"),
      file("src/tax/helpers/round.ts", "cap-tax"),
    ],
    imports: [],
    tests: [{ kind: "test", path: "src/tax/fixtures/index.test.ts", titles: [], imports: [] }],
  };
  const expected = {
    capabilities: {
      "cap-tax": [{
        folder: "src/tax", entry: "src/tax/index.ts", files: ["src/tax/helpers/round.ts", "src/tax/index.ts", "src/tax/rates.ts"],
        parts: [{
          folder: "src/tax/transactions", entry: "src/tax/transactions/index.ts", files: ["src/tax/transactions/index.ts", "src/tax/transactions/ledger.ts"],
          parts: [{ folder: "src/tax/transactions/payments", entry: "src/tax/transactions/payments/index.ts", files: ["src/tax/transactions/payments/card.ts", "src/tax/transactions/payments/index.ts"], parts: [] }],
        }],
      }],
    },
    clashes: [],
  };
  assert.deepEqual(nestedParts(survey, [""]), expected);
  assert.deepEqual(nestedParts({ ...survey, files: [...survey.files].reverse() }, [""]), expected);
});

test("8.67 in Python a folder with __init__.py is a level and a namespace package is not; the module's own folder under src is the top; a package nested inside the story's package is a level", () => {
  const survey: StorySurvey = {
    files: [
      file("src/shop/__init__.py", "cap-cart"), file("src/shop/cart/__init__.py", "cap-cart"), file("src/shop/cart/items.py", "cap-cart"),
      file("src/shop/plugins/stripe.py", "cap-cart"),
      file("vendor/pay/lib/charge.ts", "cap-cart"),
    ],
    imports: [],
  };
  assert.deepEqual(nestedParts(survey, ["", "vendor/pay"]), {
    capabilities: {
      "cap-cart": [
        { folder: "src/shop/cart", entry: "src/shop/cart/__init__.py", files: ["src/shop/cart/__init__.py", "src/shop/cart/items.py"], parts: [] },
        { folder: "vendor/pay", files: ["vendor/pay/lib/charge.ts"], parts: [] },
      ],
    },
    clashes: [],
  });
  assert.equal(nestedParts({ files: [file("src/a.ts", "cap-cart")], imports: [] }, [""]), undefined);
});

test("8.68 a part shared by several capabilities appears inside each, clipped to that capability's own files, and under none whose files it does not hold", () => {
  const survey: StorySurvey = {
    files: [
      file("src/cart/index.ts", "cap-cart"), file("src/cart/items.ts", "cap-cart"), file("src/cart/prices.ts", "cap-prices"),
      file("src/cart/discounts/index.ts"), file("src/cart/discounts/coupon.ts", "cap-prices"),
      file("src/till/index.ts", "cap-till"),
    ],
    imports: [],
  };
  assert.deepEqual(nestedParts(survey, [""])?.capabilities, {
    "cap-cart": [{ folder: "src/cart", entry: "src/cart/index.ts", files: ["src/cart/index.ts", "src/cart/items.ts"], parts: [] }],
    "cap-prices": [{
      folder: "src/cart", entry: "src/cart/index.ts", files: ["src/cart/prices.ts"],
      parts: [{ folder: "src/cart/discounts", entry: "src/cart/discounts/index.ts", files: ["src/cart/discounts/coupon.ts"], parts: [] }],
    }],
    "cap-till": [{ folder: "src/till", entry: "src/till/index.ts", files: ["src/till/index.ts"], parts: [] }],
  });
});

test("8.69 an import reaching round a part's entry is a clash naming the part it reaches, each part it enters and those it goes round, with a suggested refactor; an import through the entry or within a part is none, and the part stays", () => {
  const files = [
    file("src/tax/index.ts", "cap-tax"), file("src/tax/report.ts", "cap-tax"),
    file("src/tax/transactions/index.ts", "cap-tax"), file("src/tax/transactions/ledger.ts", "cap-tax"),
    file("src/tax/transactions/payments/index.ts", "cap-tax"), file("src/tax/transactions/payments/card.ts", "cap-tax"),
  ];
  const imports = [
    { from: "src/tax/report.ts", to: "src/tax/transactions/payments/card.ts" },
    { from: "src/tax/index.ts", to: "src/tax/transactions/payments/index.ts" },
    { from: "src/tax/index.ts", to: "src/tax/transactions/index.ts" },
    { from: "src/tax/transactions/ledger.ts", to: "src/tax/transactions/payments/index.ts" },
    { from: "src/tax/transactions/payments/index.ts", to: "src/tax/transactions/payments/card.ts" },
  ];
  const parts = nestedParts({ files, imports }, [""])!;
  assert.deepEqual(parts.clashes.map(({ suggestion, ...clash }) => clash), [
    { from: "src/tax/index.ts", to: "src/tax/transactions/payments/index.ts", part: "src/tax/transactions/payments", enters: ["src/tax/transactions", "src/tax/transactions/payments"], around: ["src/tax/transactions"] },
    { from: "src/tax/report.ts", to: "src/tax/transactions/payments/card.ts", part: "src/tax/transactions/payments", enters: ["src/tax/transactions", "src/tax/transactions/payments"], around: ["src/tax/transactions", "src/tax/transactions/payments"] },
  ]);
  assert.equal(parts.clashes[1]!.suggestion,
    "As per storytree guidelines, this is the way you could potentially refactor it: src/tax/report.ts reaches into src/tax/transactions/payments/card.ts round the entry of src/tax/transactions, so have src/tax/transactions/index.ts offer what it takes, and import it from there.");
  assert.deepEqual(parts.capabilities["cap-tax"]?.[0]?.parts[0]?.parts.map((part) => part.folder), ["src/tax/transactions/payments"]);
});
