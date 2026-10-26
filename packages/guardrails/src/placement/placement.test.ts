/**
 * Capability 5 · The placement report (the Guardrails story): each package's counted callers and the placement
 * they imply, over small checkouts laid out as the habits card says.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { check } from "../index.js";

import { placementReport, type Placement } from "./placement.js";

/** A checkout holding `files` (repo-relative path to text), removed after the test. */
function plant(t: TestContext, files: Record<string, string>): string {
  const at = mkdtempSync(path.join(tmpdir(), "placement-"));
  t.after(() => rmSync(at, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(at, file)), { recursive: true });
    writeFileSync(path.join(at, file), text);
  }
  return at;
}

/** A package named `name` under packages/, with one source file of `code`. */
const pkg = (name: string, code: string, dir = `packages/${name}`): Record<string, string> => ({
  [`${dir}/package.json`]: JSON.stringify({ name, exports: { ".": "./src/index.ts" } }),
  [`${dir}/src/index.ts`]: code,
});

const of = (placements: readonly Placement[], dir: string): Placement => placements.find((placed) => placed.package === dir)!;

test("5.1 · a package's counted callers are the other packages whose production code imports it, type-only imports included; tests and testing helpers make none", async (t: TestContext) => {
  const { placements } = await placementReport(plant(t, {
    ...pkg("core", "export const core = 1;\nexport type Money = number;\n"),
    ...pkg("cart", 'import { core } from "core";\nexport const cart = core;\n'),
    ...pkg("pay", 'import type { Money } from "core";\nexport const pay = (m: Money) => m;\n'),
    ...pkg("shop", "export const shop = 1;\n"),
    "packages/shop/src/shop.test.ts": 'import { core } from "core";\ntest("1.1 shop", () => core);\n',
    "packages/shop/src/testing/helper.ts": 'export { core } from "core";\nexport const helper = 1;\n',
  }));
  assert.deepEqual(of(placements, "packages/core").callers, ["packages/cart", "packages/pay"]);
  assert.deepEqual(of(placements, "packages/core").uncounted, []);
});

test("5.2 · the front-door frames' imports and the declared composition root's are listed as delivery mechanisms, not counted", async (t: TestContext) => {
  const { placements } = await placementReport(plant(t, {
    ...pkg("core", "export const core = 1;\n"),
    ...pkg("cli", 'import { core } from "core";\nexport const run = core;\n'),
    ...pkg("app", 'import { core } from "core";\nexport const frame = core;\n'),
    "apps/desktop/package.json": JSON.stringify({ name: "desktop" }),
    "apps/desktop/src/main.ts": 'import { core } from "core";\nexport const start = core;\n',
  }), { frames: [{ story: "cli", dirs: ["packages/cli"], frontDoor: true }, { story: "app", dirs: ["packages/app"] }, { story: "app", dirs: ["apps/desktop"], compositionRoot: true }] });
  const core = of(placements, "packages/core");
  assert.deepEqual(core.callers, ["packages/app"]);
  assert.deepEqual(core.uncounted.map(({ caller, kind }) => `${caller} ${kind}`), ["apps/desktop delivery mechanism", "packages/cli delivery mechanism"]);
  assert.equal(of(placements, "packages/cli").placement, "delivery mechanism");
});

test("5.3 · a forwarder the code survey detects, and a build step or cleanup storytree.check.json declares, is listed as plumbing by its kind, not counted", async (t: TestContext) => {
  const { placements, stale, text } = await placementReport(plant(t, {
    ...pkg("core", "export const core = 1;\n"),
    ...pkg("bridge", 'export { core } from "core";\n'),
    ...pkg("tools", 'import { core } from "core";\nexport const build = core;\n'),
    ...pkg("setup", 'import { core } from "core";\nexport const forget = core;\n'),
  }), { placement: { plumbing: [
    { from: "packages/tools/src/index.ts", to: "core", kind: "build step", said: "the owner", on: "2026-10-21" },
    { from: "packages/setup/src/index.ts", to: "core", kind: "cleanup", said: "the owner", on: "2026-10-21" },
    { from: "packages/setup/src/index.ts", to: "bridge", kind: "cleanup", said: "the owner", on: "2026-10-21" },
  ] } });
  const core = of(placements, "packages/core");
  assert.deepEqual(core.callers, []);
  assert.deepEqual(core.uncounted, [
    { caller: "packages/bridge", kind: "forwarder", file: "packages/bridge/src/index.ts" },
    { caller: "packages/setup", kind: "cleanup", file: "packages/setup/src/index.ts" },
    { caller: "packages/tools", kind: "build step", file: "packages/tools/src/index.ts" },
  ]);
  assert.deepEqual(stale.map(({ from, to }) => `${from} ${to}`), ["packages/setup/src/index.ts bridge"]);
  assert.match(text, /Stale: the cleanup packages\/setup\/src\/index\.ts → bridge in storytree\.check\.json's placement\.plumbing matches no import/);
});

test("5.4 · each count implies a placement: at or above the threshold its own story, one caller inside that story, none its own story, between them separate ways; one placed differently from today is named, with the loop moving it would make", async (t: TestContext) => {
  const at = plant(t, {
    ...pkg("core", "export const core = 1;\n"),
    ...pkg("cart", 'import { core } from "core";\nimport { tax } from "tax";\nexport const cart = core + tax;\n'),
    ...pkg("pay", 'import { core } from "core";\nimport { rate } from "rate";\nimport { rate as fee } from "fee";\nexport const pay = core + rate + fee;\n'),
    ...pkg("tax", "export const tax = 1;\n"),
    // rate's one counted caller is pay, which also reaches it through fee's forwarder: moving rate inside pay would make a loop.
    ...pkg("rate", "export const rate = 1;\n"),
    ...pkg("fee", 'export { rate } from "rate";\n'),
  });
  const kept = await placementReport(at);
  assert.equal(of(kept.placements, "packages/core").placement, "own story");
  assert.equal(of(kept.placements, "packages/core").differs, false);
  assert.equal(of(kept.placements, "packages/cart").placement, "own story");
  assert.deepEqual(of(kept.placements, "packages/tax"), { package: "packages/tax", callers: ["packages/cart"], uncounted: [], placement: "inside", inside: "packages/cart", differs: true });
  assert.deepEqual(of(kept.placements, "packages/rate").loop, ["packages/pay", "packages/fee", "packages/rate"]);
  assert.match(kept.text, /packages\/tax: 1 counted caller \(packages\/cart\): inside packages\/cart, unlike today\./);
  assert.match(kept.text, /a loop: packages\/pay → packages\/fee → packages\/rate, with packages\/rate inside packages\/pay/);
  assert.match(kept.text, /Placed differently from today: packages\/fee, packages\/rate, packages\/tax\./);

  const raised = await placementReport(at, { placement: { threshold: 3 } });
  assert.equal(of(raised.placements, "packages/core").placement, "separate ways");
  assert.equal(of(raised.placements, "packages/core").differs, true);
});

test("5.5 · storytree check prints the placement report and never fails on it; placement off leaves it out", async (t: TestContext) => {
  const files = {
    "package.json": JSON.stringify({ name: "shop", workspaces: ["packages/*"] }),
    "packages/cart/package.json": JSON.stringify({ name: "cart", dependencies: { tax: "*" } }),
    "packages/cart/src/cart.js": 'import { tax } from "tax";\nexport const cart = () => tax;\n',
    "packages/cart/test/cart.test.js": 'import { test } from "node:test";\nimport { cart } from "../src/cart.js";\ntest("1.1 carts", () => cart());\n',
    "packages/tax/package.json": JSON.stringify({ name: "tax", exports: { ".": "./src/tax.js" } }),
    "packages/tax/src/tax.js": "export const tax = 1;\n",
    "packages/tax/test/tax.test.js": 'import { test } from "node:test";\nimport { tax } from "../src/tax.js";\ntest("1.1 taxes", () => tax);\n',
  };
  const report = await check(plant(t, files));
  assert.equal(report.passed, true, report.text);
  assert.match(report.text, /placement report[^\n]*\n(?:.*\n)*  - packages\/tax: 1 counted caller \(packages\/cart\): inside packages\/cart, unlike today/);
  assert.match(report.text, /storytree check passed/);

  const off = await check(plant(t, { ...files, "storytree.check.json": JSON.stringify({ placement: { off: true } }) }));
  assert.equal(off.passed, true, off.text);
  assert.doesNotMatch(off.text, /placement report/);
});
