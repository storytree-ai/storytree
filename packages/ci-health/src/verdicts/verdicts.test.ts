import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestResult } from "../run-results/run-results.js";
import { judgeRun, proofsAt, type PlanTree } from "./verdicts.js";

/** Two stories whose contract numbers repeat, as every user's do: each has a 1.1. */
const TREE: PlanTree = {
  stories: [
    { id: "story_cart", title: "Review the cart", capabilities: [{ id: "cap_cart", title: "1 · Cart page", contracts: [{ id: "c_cart_11", title: "1.1 · Cart page shows its shell" }, { id: "c_cart_12", title: "1.2 · Cart lists its contents" }] }] },
    { id: "story_out", title: "Check out", capabilities: [{ id: "cap_out", title: "1 · Checkout pages", contracts: [{ id: "c_out_11", title: "1.1 · Your information page shows the form" }, { id: "c_out_12", title: "1.2 · Missing details show the error" }] }] },
  ],
};

/** The test files at the run's commit, in repository coordinates. */
const FILES = [
  { path: "packages/review-the-cart/src/cart.js", text: "export const cart = 1;\n" },
  { path: "packages/review-the-cart/src/cart.test.js", text: [
    `import { test } from "node:test";`, `import { cart } from "./cart.js";`,
    `test("1.1 cart page shows its shell", () => {});`,
    `test("1.2 cart lists what is in cart-contents", (t) => { t.test("one row per product", () => {}); });`,
    `test("1.1 the header is shared", () => {});`,
  ].join("\n") },
  { path: "packages/check-out/src/checkout.test.js", text: [
    `import { test } from "node:test";`,
    `test("1.1 your information page shows the form", () => {});`,
    `test("1.1 the header is shared", () => {});`,
    `test("1.2 missing details show the error", () => {});`,
    `test('1.2 the shopper\\'s details are kept', () => {});`,
  ].join("\n") },
  { path: "packages/not-a-story/src/other.test.js", text: `test("1.2 missing details show the error", () => {});` },
];

const pass = (name: string, suites: string[] = []): TestResult => ({ name, suites, status: "passed" });

test("2.1 a result counts for contract N.M of the one story whose package's tests carry its exact title at the run's commit; a title carried by two stories' tests, or by none, credits nothing and is unmatched", () => {
  const { verdicts, unmatched } = judgeRun(proofsAt(TREE, FILES), [
    pass("1.1 cart page shows its shell"),
    pass("one row per product", ["1.2 cart lists what is in cart-contents"]),
    pass("1.1 the header is shared"),
    pass("1.1 nobody's test"),
    pass("1.2 missing details show the error"),
    pass("1.2 the shopper's details are kept"),
  ]);
  assert.deepEqual(
    Object.fromEntries([...verdicts].map(([id, verdict]) => [id, [verdict.state, verdict.total]])),
    { c_cart_11: ["passing", 1], c_cart_12: ["passing", 1], c_out_11: ["not-checked", 0], c_out_12: ["passing", 2] },
    "the cart's 1.1 and 1.2 by their own titles, checkout's 1.2 by its own two, one written with an escaped quote (the stray package is no story); checkout's 1.1 got nothing",
  );
  assert.deepEqual(unmatched.map(({ name }) => name), ["1.1 the header is shared", "1.1 nobody's test"]);
});

test("2.2 a contract is passing only when it has tests and every one passed, failing when any failed, and not checked when one was skipped or none ran", () => {
  const proofs = proofsAt(TREE, FILES);
  const { verdicts } = judgeRun(proofs, [
    pass("1.1 cart page shows its shell"),
    { name: "1.2 cart lists what is in cart-contents", suites: [], status: "passed" },
    { name: "one row per product", suites: ["1.2 cart lists what is in cart-contents"], status: "failed" },
    { name: "1.1 your information page shows the form", suites: [], status: "skipped", message: "not on this platform" },
  ]);
  const read = (id: string) => verdicts.get(id)!;
  assert.equal(read("c_cart_11").state, "passing");
  assert.equal(read("c_cart_11").note, "1/1 tests passed");
  assert.equal(read("c_cart_12").state, "failing", "one failed subtest fails its contract");
  assert.equal(read("c_cart_12").note, "1/2 tests passed");
  assert.equal(read("c_out_11").state, "not-checked", "a skipped test is no pass");
  assert.match(read("c_out_11").note, /1 of 1 tests skipped \(not on this platform\)/);
  assert.equal(read("c_out_12").state, "not-checked", "no test ran");
  assert.equal(read("c_out_12").total, 0);
});

test("2.3 a test skipped on one platform for a platform reason counts passed when the same test passed on every job of the platform it needs; otherwise it stays skipped, and a contract a skip leaves not checked carries the skip's kind", () => {
  const proofs = proofsAt(TREE, FILES);
  const onPosix = "platform:posix: a stand-in gh on PATH must be an .exe on Windows";
  const { verdicts } = judgeRun(proofs, [
    // The cart's 1.1: skipped on Windows, passed on Linux and macOS, the platforms it needs.
    { name: "1.1 cart page shows its shell", suites: [], status: "skipped", message: onPosix, platform: "win32" },
    { name: "1.1 cart page shows its shell", suites: [], status: "passed", platform: "linux" },
    { name: "1.1 cart page shows its shell", suites: [], status: "passed", platform: "darwin" },
    // The cart's 1.2: skipped on Windows, and on macOS too, a platform it needs: no credit.
    { name: "1.2 cart lists what is in cart-contents", suites: [], status: "skipped", message: onPosix, platform: "win32" },
    { name: "1.2 cart lists what is in cart-contents", suites: [], status: "passed", platform: "linux" },
    { name: "1.2 cart lists what is in cart-contents", suites: [], status: "skipped", message: "platform:posix", platform: "darwin" },
    // Checkout's 1.1: needs Windows, and no Windows job ran it.
    { name: "1.1 your information page shows the form", suites: [], status: "skipped", message: "platform:win32 needs Windows", platform: "linux" },
    // Checkout's 1.2: only the owner can run it.
    { name: "1.2 missing details show the error", suites: [], status: "skipped", message: "owner: needs a signed-in account", platform: "linux" },
    { name: "1.2 the shopper's details are kept", suites: [], status: "skipped", message: "slow", platform: "linux" },
  ]);
  const read = (id: string) => verdicts.get(id)!;
  assert.deepEqual([read("c_cart_11").state, read("c_cart_11").passed, read("c_cart_11").skipped], ["passing", 3, 0], "the platform it needs passed it");
  assert.equal(read("c_cart_11").skip, undefined);
  assert.equal(read("c_cart_12").state, "not-checked", "macOS, a platform it needs, skipped it too");
  assert.equal(read("c_cart_12").skip, "platform:posix");
  assert.equal(read("c_out_11").state, "not-checked", "no job of the platform it needs ran it");
  assert.equal(read("c_out_11").skip, "platform:win32");
  assert.equal(read("c_out_12").skip, "owner", "an owner skip outranks any other");
  assert.equal(judgeRun(proofs, [{ name: "1.1 cart page shows its shell", suites: [], status: "skipped", message: "slow" }]).verdicts.get("c_cart_11")!.skip, "other");
});

test("2.4 a result no test holds by its exact title counts for contract N.M of the one story whose test calls a helper with N.M and a title, when the result's name begins with that number and ends with that title; held by two stories, it credits nothing", () => {
  const helper = (number: string) => [
    `import { test } from "node:test";`,
    `for (const backend of ["memory", "postgres"]) {`,
    "  const contract = (number, title, body) => test(`${number} [${backend}] ${title}`, body);",
    `  contract("${number}", "a wait is cleared as its blocker lands", async () => {});`,
    `}`,
  ].join("\n");
  const files = [
    { path: "packages/review-the-cart/src/cart.test.js", text: helper("1.2") },
    { path: "packages/check-out/src/checkout.test.js", text: `${helper("1.1")}\n${`test("1.2 missing details show the error", () => {});`}` },
    { path: "packages/review-the-cart/src/shared.test.js", text: helper("1.1") },
  ];
  const { verdicts, unmatched } = judgeRun(proofsAt(TREE, files), [
    pass("1.2 [memory] a wait is cleared as its blocker lands"),
    pass("1.2 [postgres] a wait is cleared as its blocker lands"),
    pass("1.2 missing details show the error"),
    pass("1.1 [memory] a wait is cleared as its blocker lands"),
    pass("1.20 [memory] a wait is cleared as its blocker lands"),
    pass("1.2 [memory] another title"),
  ]);
  assert.deepEqual(
    Object.fromEntries([...verdicts].map(([id, verdict]) => [id, [verdict.state, verdict.total]])),
    { c_cart_11: ["not-checked", 0], c_cart_12: ["passing", 2], c_out_11: ["not-checked", 0], c_out_12: ["passing", 1] },
    "the cart's 1.2 through its helper's number and title, both backends; checkout's 1.2 by its exact title; 1.1's bare number is held by both stories",
  );
  assert.deepEqual(unmatched.map(({ name }) => name), ["1.1 [memory] a wait is cleared as its blocker lands", "1.20 [memory] a wait is cleared as its blocker lands", "1.2 [memory] another title"]);
});
