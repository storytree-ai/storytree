import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestResult } from "../run-results/run-results.js";
import { judgeRun, proofsAt, unclaimedVerdicts, verdictOf, type PlanTree } from "./verdicts.js";

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

test("2.5 a failing verdict's note carries, after its tally, the first line of the first message its failed tests carry, cut to 200 characters; a failure with no message leaves the tally alone", () => {
  const enoent = "ENOENT: no such file or directory, open '/tmp/t/torn-down.txt'\n    at Object.openSync (node:fs:573:18)";
  const failing = verdictOf([
    { status: "passed" },
    { status: "failed" },
    { status: "failed", message: enoent },
    { status: "failed", message: "a later failure" },
  ]);
  assert.equal(failing.state, "failing");
  assert.equal(failing.note, "1/4 tests passed; first failure: ENOENT: no such file or directory, open '/tmp/t/torn-down.txt'", "the first failure that has a message, its first line only");
  assert.equal(verdictOf([{ status: "failed" }]).note, "0/1 tests passed", "no message: the tally alone");
  assert.equal(verdictOf([{ status: "passed", message: "kept quiet" }]).note, "1/1 tests passed", "a passing verdict quotes nothing");
  const long = verdictOf([{ status: "failed", message: `Expected values to be strictly equal: ${"x".repeat(400)}` }]).note!;
  assert.ok(long.length <= "0/1 tests passed; first failure: ".length + 200, "a long message is cut to fit a note");
  assert.match(long, /…$/);
});

/** A pytest file in the cart's package; the checkout's package holds one at the same path inside it. */
const CART_PYTEST = [
  `"""The cart's totals."""`,
  `import sys`,
  `import pytest`,
  ``,
  `class TestTotals:`,
  `    @pytest.mark.skipif(sys.platform == "win32", reason="platform:posix: needs a POSIX shell")`,
  `    def test_1_1_shell(self):`,
  `        assert True`,
  ``,
  `def test_check_out_1_2_handoff():`,
  `    assert True`,
  ``,
  `@pytest.fixture`,
  `def key():`,
  `    return "k"`,
  `def test_lists_inside():`,
  `    """1.2 · cart lists what is in it"""`,
  ``,
  `@pytest.mark.skipif(`,
  `    sys.platform == "win32", reason="platform:posix: needs a POSIX shell")`,
  `def test_1_2_lists():`,
  `    assert True`,
  ``,
  `def test_1_2_keeps():`,
  `    if True:`,
  `        pytest.skip("owner: needs a key")`,
].join("\n");
const PY_FILES = [
  ...FILES,
  { path: "packages/review-the-cart/tests/test_total.py", text: CART_PYTEST },
  { path: "packages/check-out/tests/test_total.py", text: [`def test_1_1_shell():`, `    pass`, `def test_1_1_form(case):`, `    pass`].join("\n") },
];
const ran = (file: string, name: string, suites: string[] = [], status: TestResult["status"] = "passed"): TestResult => ({ name, suites, status, file });
const lineOf = (text: string) => CART_PYTEST.split("\n").findIndex((line) => line.startsWith(text)) + 1;

test("2.6 · a pytest result counts for contract N.M by the number its test's name carries, for the one story whose package holds that test in the node id's file, or the story whose package the name names; a docstring's number reaches no log", () => {
  const cart = "packages/review-the-cart/tests/test_total.py";
  const { verdicts, unmatched } = judgeRun(proofsAt(TREE, PY_FILES), [
    ran(cart, "test_1_1_shell", ["TestTotals"]),
    ran("tests/test_total.py", "test_1_1_shell"),
    ran(cart, "test_check_out_1_2_handoff"),
    ran(cart, "test_lists_inside"),
    ran(cart, "test_1_2_gone"),
    ran("tests/test_total.py", "test_1_1_form[a]"),
  ]);
  assert.deepEqual(
    Object.fromEntries([...verdicts].map(([id, verdict]) => [id, [verdict.state, verdict.total]])),
    { c_cart_11: ["passing", 1], c_cart_12: ["not-checked", 0], c_out_11: ["passing", 1], c_out_12: ["passing", 1] },
    "the cart's 1.1 by its file's path from the top; checkout's 1.2 by the package its name names; checkout's 1.1 by the one package whose tests/test_total.py holds test_1_1_form",
  );
  assert.deepEqual(unmatched.map(({ name }) => name), ["test_1_1_shell", "test_lists_inside", "test_1_2_gone"], "a path two packages hold, a number only a docstring carries, and a test the file does not hold credit nothing");

  const started = performance.now();
  const hostile = judgeRun(proofsAt(TREE, PY_FILES), [ran(cart, `${"[".repeat(60_000)}\n`)]);
  assert.ok(performance.now() - started < 1000, "a result name of many brackets is cut at its first in one pass");
  assert.equal(hostile.unmatched.length, 1);
});

test("2.7 · a skipped pytest test, which -rA names only by its file and line, is tied to the test at that line, its decorators' or its body's, so its skip leaves that test's contract not checked", () => {
  const cart = "tests/test_total.py";
  const proofs = proofsAt(TREE, PY_FILES.filter(({ path }) => !path.startsWith("packages/check-out/tests/")));
  const platformSkip: TestResult = { name: "", suites: [], status: "skipped", file: cart, line: lineOf("@pytest.mark.skipif("), message: "platform:posix: needs a POSIX shell", platform: "win32" };
  const passedOnLinux: TestResult = { ...ran(cart, "test_1_2_lists"), platform: "linux" };
  assert.deepEqual(
    [judgeRun(proofs, [platformSkip, passedOnLinux]).verdicts.get("c_cart_12")].map((verdict) => [verdict?.state, verdict?.total]),
    [["passing", 2]],
    "the skip at the decorator is test_1_2_lists's, proved by the Linux job",
  );
  const classSkip: TestResult = { ...platformSkip, line: lineOf("    @pytest.mark.skipif(") };
  const classPassedOnLinux: TestResult = { ...ran(cart, "test_1_1_shell", ["TestTotals"]), platform: "linux" };
  assert.deepEqual(
    [judgeRun(proofs, [classSkip, classPassedOnLinux]).verdicts.get("c_cart_11")].map((verdict) => [verdict?.state, verdict?.total]),
    [["passing", 2]],
    "a skip names no class, yet it is the class's test_1_1_shell, proved by the Linux job",
  );
  const bodySkip: TestResult = { ...platformSkip, line: lineOf(`    """1.2 · cart lists`) };
  assert.deepEqual(judgeRun(proofs, [bodySkip]).unmatched.map(({ name }) => name), ["test_lists_inside"], "a skip two lines above the next test's decorators is the test whose body it is in");
  const fixtureSkip: TestResult = { ...platformSkip, line: lineOf("@pytest.fixture") };
  const fromFixture = judgeRun(proofs, [fixtureSkip]);
  assert.deepEqual([fromFixture.unmatched, fromFixture.verdicts.get("c_out_12")!.total], [[], 1], "a fixture's decorators are no test's: the skip there is in the body above, test_check_out_1_2_handoff's");
  const ownerSkip: TestResult = { name: "", suites: [], status: "skipped", file: cart, line: lineOf(`        pytest.skip(`), message: "owner: needs a key" };
  const { verdicts, unmatched } = judgeRun(proofs, [platformSkip, passedOnLinux, ownerSkip]);
  assert.deepEqual([verdicts.get("c_cart_12")!.state, verdicts.get("c_cart_12")!.skip], ["not-checked", "owner"], "the skip in test_1_2_keeps's body is its own");
  assert.deepEqual(unmatched, []);
});

test("2.8 · an imported story's pytest files are those under the folders its code was imported from (`.` the project's top), each file the story's whose folder holding it is deepest, so a flat project's tests/ credit its one story and a workspace member's tests credit the member; a story storytree built keeps its packages/<name>/ tests", () => {
  const story = (id: string, title: string, contract: string, folder?: string): PlanTree["stories"][number] =>
    ({ id, title, ...(folder === undefined ? {} : { mapped: { folders: [folder] } }), capabilities: [{ id: `cap_${id}`, title: "1 · Api", contracts: [{ id: contract, title: "1.1 · it answers" }] }] });
  const tree: PlanTree = { stories: [story("story_root", "checkbox", "c_root_11", "."), story("story_sdk", "checkbox-sdk", "c_sdk_11", "libs/sdk"), story("story_web", "web", "c_web_11")] };
  const test = "def test_1_1_answers():\n    pass\n";
  const files = ["tests/test_api.py", "libs/sdk/tests/test_client.py", "packages/web/tests/test_web.py"].map((path) => ({ path, text: test }));
  const { verdicts, unmatched } = judgeRun(proofsAt(tree, files), [
    ran("tests/test_api.py", "test_1_1_answers"),
    ran("libs/sdk/tests/test_client.py", "test_1_1_answers", [], "failed"),
    ran("packages/web/tests/test_web.py", "test_1_1_answers", [], "failed"),
  ]);
  assert.deepEqual(
    Object.fromEntries([...verdicts].map(([id, verdict]) => [id, [verdict.state, verdict.total]])),
    { c_root_11: ["passing", 1], c_sdk_11: ["failing", 1], c_web_11: ["failing", 1] },
    "the top's tests/ is the root story's; libs/sdk's and packages/web's tests are the member's and the built story's alone, though the root's folder holds them too",
  );
  assert.deepEqual(unmatched, []);
});

test("2.9 · a result counts for each contract whose provedBy names its test: a pytest result by its node id's file, then any classes and test, its parameters included, a file or class naming all it holds; any other result by its own title or a suite's", () => {
  const contract = (id: string, number: string, provedBy: string[]) => ({ id, title: `1.${number} · it holds`, provedBy });
  const tree: PlanTree = {
    stories: [
      {
        id: "story_api",
        title: "checkbox",
        mapped: { folders: ["."] },
        capabilities: [{
          id: "cap_api",
          title: "1 · Api",
          contracts: [
            contract("c_file", "1", ["tests/test_api.py"]),
            contract("c_class", "2", ["tests/test_api.py::TestAuth"]),
            contract("c_one", "3", ["tests/test_api.py::test_lists"]),
            contract("c_title", "4", ["sums the cart"]),
            contract("c_elsewhere", "5", ["tests/test_other.py::test_lists"]),
          ],
        }],
      },
    ],
  };
  const files = [{ path: "tests/test_api.py", text: "class TestAuth:\n    def test_login(self):\n        pass\n\ndef test_lists():\n    pass\n" }];
  const { verdicts, unmatched } = judgeRun(proofsAt(tree, files), [
    ran("tests/test_api.py", "test_login", ["TestAuth"], "failed"),
    ran("tests/test_api.py", "test_lists[a]"),
    ran("tests/test_api.py", "test_lists[b]"),
    pass("adds tax", ["sums the cart"]),
    pass("sums the cart twice"),
  ]);
  assert.deepEqual(
    Object.fromEntries([...verdicts].map(([id, verdict]) => [id, [verdict.state, verdict.total]])),
    { c_file: ["failing", 3], c_class: ["failing", 1], c_one: ["passing", 2], c_title: ["passing", 1], c_elsewhere: ["not-checked", 0] },
    "the file names its three results, the class its one, the test both its parameters, and the suite's title its test",
  );
  assert.deepEqual(unmatched, [pass("sums the cart twice")], "a title only beginning with one names nothing");
});

test("2.10 · a result no contract claims counts for each explored capability covering its test's file or a file that file imports, judged by the one rule; a capability no such result reaches gets none", async () => {
  const tree: PlanTree = {
    stories: [
      {
        id: "story_app",
        title: "checkbox",
        mapped: { folders: ["."] },
        capabilities: [
          { id: "cap_stats", title: "Stats", covers: ["app/stats"], contracts: [] },
          { id: "cap_cart", title: "Cart", covers: ["app/cart.py"], contracts: [{ id: "c_total", title: "1.1 · totals the cart", provedBy: ["tests/test_cart.py::test_total"] }] },
          { id: "cap_helpers", title: "Helpers", covers: ["tests/helpers.py"], contracts: [] },
          { id: "cap_admin", title: "Admin", covers: ["app/admin.py"], contracts: [] },
        ],
      },
    ],
  };
  const files = [
    { path: "app/__init__.py", text: "" },
    { path: "app/stats/__init__.py", text: "" },
    { path: "app/stats/week.py", text: "def week():\n    return 3\n" },
    { path: "app/cart.py", text: "def total():\n    return 0\n" },
    { path: "app/admin.py", text: "" },
    { path: "tests/helpers.py", text: "" },
    { path: "tests/test_stats.py", text: "from app.stats.week import week\nfrom app import cart\n\ndef test_week():\n    assert week() == 4\n\ndef test_month():\n    pass\n" },
    { path: "tests/test_cart.py", text: "from app.cart import total\n\ndef test_total():\n    assert total() == 1\n\ndef test_empty():\n    pass\n" },
    { path: "tests/test_helpers.py", text: "def test_nothing():\n    pass\n" },
  ];
  const results = [
    { ...ran("tests/test_stats.py", "test_week", [], "failed"), message: "assert 3 == 4" },
    ran("tests/test_stats.py", "test_month"),
    ran("tests/test_cart.py", "test_total", [], "failed"),
    ran("tests/test_cart.py", "test_empty"),
    pass("sums the cart"),
  ];
  const { verdicts, unmatched } = judgeRun(proofsAt(tree, files), results);
  assert.equal(verdicts.get("c_total")?.state, "failing", "control: the claimed test credits its contract");
  assert.deepEqual(unmatched.map(({ name }) => name), ["test_week", "test_month", "test_empty", "sums the cart"]);
  const reached = await unclaimedVerdicts(tree, files, unmatched);
  assert.deepEqual(
    Object.fromEntries([...reached].map(([id, { state, note }]) => [id, { state, note }])),
    {
      // test_stats.py imports app/stats/week.py (Stats) and app/cart.py (Cart); test_cart.py's unclaimed test_empty reaches Cart.
      cap_stats: { state: "failing", note: "1/2 tests passed; first failure: assert 3 == 4" },
      cap_cart: { state: "failing", note: "2/3 tests passed; first failure: assert 3 == 4" },
    },
    "test_total, which a contract claims, counts for no capability; the title-only result reaches none, and Helpers and Admin are reached by no unclaimed test",
  );
});

test("2.11 · a result no contract claims that names no file (TAP's) is the one test file holding its title, else its nearest suite's that one file holds, and counts for the capabilities that file reaches as 2.10; a title no test file holds, or two do, reaches none", async () => {
  const tree: PlanTree = {
    stories: [
      {
        id: "story_shop",
        title: "shop",
        mapped: { folders: ["."] },
        capabilities: [
          { id: "cap_total", title: "Total", covers: ["src/total.js"], contracts: [] },
          { id: "cap_tax", title: "Tax", covers: ["src/tax.js"], contracts: [] },
          { id: "cap_other", title: "Other", covers: ["src/other.js"], contracts: [] },
        ],
      },
    ],
  };
  const files = [
    { path: "src/total.js", text: "export const total = () => 0;\n" },
    { path: "src/tax.js", text: "export const tax = () => 0;\n" },
    // Neither is a JavaScript test file, so the title each passes to a call is no test's.
    { path: "src/other.js", text: `export const other = () => log("adds the shopper's tax");\n` },
    { path: "tests/test_tax.py", text: `def test_logs():\n    check("adds the shopper's tax")\n` },
    { path: "src/total.test.js", text: [
      `import { describe, it } from "node:test";`, `import { total } from "./total.js";`,
      `describe("cart", () => {`, `  it("sums the cart", () => {});`, `  it("returns null", () => {});`, `});`,
    ].join("\n") },
    { path: "src/tax.test.js", text: [
      `import { test } from "node:test";`, `import { tax } from "./tax.js";`,
      `test('adds the shopper\\'s tax', () => {});`, `test("returns null", () => {});`,
    ].join("\n") },
  ];
  const results: TestResult[] = [
    { ...pass("sums the cart", ["cart"]), status: "failed", message: "expected 1" },
    // Two files hold "returns null": the suite "cart", which one does, names its file.
    pass("returns null", ["cart"]),
    pass("adds the shopper's tax"),
    // Held by two files with no suite to tell them apart, and held by none.
    { ...pass("returns null"), status: "failed" },
    { ...pass("is nowhere"), status: "failed" },
  ];
  const { unmatched } = judgeRun(proofsAt(tree, files), results);
  assert.equal(unmatched.length, 5, "control: no contract claims any of them");
  const reached = await unclaimedVerdicts(tree, files, unmatched);
  assert.deepEqual(
    Object.fromEntries([...reached].map(([id, { state, note }]) => [id, { state, note }])),
    {
      cap_total: { state: "failing", note: "1/2 tests passed; first failure: expected 1" },
      cap_tax: { state: "passing", note: "1/1 tests passed" },
    },
    "the ambiguous and the unheld failures reach no capability, and Other is reached by none",
  );
});

test("2.12 · a contract on an edge inside a story counts a test's result as a capability's contract does: by the number its title carries, in the story's package, or by its provedBy", () => {
  const tree: PlanTree = {
    stories: [{
      id: "story_cart",
      title: "Review the cart",
      capabilities: [
        { id: "cap_cart", title: "1 · Cart page", contracts: [{ id: "c_cart_11", title: "1.1 · Cart page shows its shell" }] },
        { id: "cap_total", title: "2 · Totals", contracts: [] },
      ],
      edges: [{ contracts: [
        { id: "c_edge_21", title: "2.1 · Totals read the cart's rows" },
        { id: "c_edge_proved", title: "Totals see a removed row", provedBy: ["a removed row leaves the total"] },
      ] }],
    }],
  };
  const files = [{ path: "packages/review-the-cart/src/total.test.js", text: [
    `import { test } from "node:test";`,
    `test("2.1 totals read the cart's rows", () => {});`,
    `test("a removed row leaves the total", () => {});`,
  ].join("\n") }];
  const { verdicts, unmatched } = judgeRun(proofsAt(tree, files), [
    pass("2.1 totals read the cart's rows"),
    { name: "a removed row leaves the total", suites: [], status: "failed" },
  ]);
  assert.deepEqual(
    Object.fromEntries([...verdicts].map(([id, verdict]) => [id, [verdict.state, verdict.total]])),
    { c_cart_11: ["not-checked", 0], c_edge_21: ["passing", 1], c_edge_proved: ["failing", 1] },
    "the edge's numbered contract by its test's title, and the other by the test its provedBy names",
  );
  assert.deepEqual(unmatched, []);
});
