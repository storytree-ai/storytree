/**
 * Capability 7 · Mutation report: contracts 7.1 to 7.9. 7.1 reads breaks from source text; 7.2 runs a real report on a
 * small package of node tests in a temp folder; 7.3 and 7.4 run it through the brief and take tools on the real Postgres
 * `pnpm test` provides, against a git checkout whose branch adds an untested branch.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { quietFor, removeTemp, waitUntil } from "@storytree/test-waits";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import { aridList, briefWithReport, changeBreaks, fileBreaks, MUTATION_SURVIVOR, mutationReport, openLedger, openReviews, qualityTools, readReach, runTests, spread, type ReviewReturn, type TestRun } from "../index.js";

/** A diff adding every line of each file. */
function adding(files: Record<string, string>): string {
  return Object.entries(files).map(([file, text]) => {
    const lines = text.replace(/\n$/, "").split("\n");
    return [`diff --git a/${file} b/${file}`, "--- /dev/null", `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n");
  }).join("\n") + "\n";
}

/** Write `files` under `dir`. */
function write(dir: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
}

/**
 * A package whose new `grade` has a branch no test takes, a file no test reaches, and a file whose only test always fails, and a
 * package downstream of it that imports `grade` by the package's name.
 */
const PACKAGE: Record<string, string> = {
  "packages/demo/package.json": JSON.stringify({ name: "@t/demo", type: "module", exports: { "./grade": "./src/grade.mjs" } }),
  "packages/report/package.json": JSON.stringify({ name: "@t/report", type: "module", dependencies: { "@t/demo": "workspace:*" } }),
  "packages/report/src/report.mjs": "import { grade } from \"@t/demo/grade\";\nexport const line = (n) => [n, grade(n)].join(\": \");\n",
  "packages/demo/src/grade.mjs": [
    "export function grade(n, strict) {",
    "  if (n > 100 && strict) return \"huge\";",
    "  if (n > 10) return \"big\";",
    "  return \"small\";",
    "}",
  ].join("\n") + "\n",
  "packages/demo/src/grade.test.mjs": [
    "import assert from \"node:assert/strict\";",
    "import { test } from \"node:test\";",
    "import { grade } from \"./grade.mjs\";",
    "test(\"grades\", () => { assert.equal(grade(11), \"big\"); assert.equal(grade(5), \"small\"); });",
  ].join("\n") + "\n",
  "packages/demo/src/loud.mjs": "import { grade } from \"./grade.mjs\";\nexport const loud = (n) => grade(n) === \"big\";\n",
  "packages/demo/src/broken.mjs": "export const on = (x) => x === 1;\n",
  "packages/demo/src/broken.test.mjs": "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { on } from \"./broken.mjs\";\ntest(\"always red\", () => { assert.equal(on(1), false); });\n",
};

const SOURCE = [
  "const LIMIT_MS = 30 > 2 ? 1 : 0;",
  "export function f(a: number, b: boolean): boolean {",
  "  console.log(a > 1);",
  "  if (a === 2 && b) return !b;",
  "  const total = a + 1 > 3 ? true : false;",
  "  const s = \"x\" + a;",
  "  return b || a > 9;",
  "}",
].join("\n") + "\n";

test("7.1 · a change's breaks are at most one per changed source line, none on a logging call, an upper-case constant's setting, string joining or a line on the arid list", () => {
  const breaks = fileBreaks("packages/x/src/f.ts", SOURCE, [1, 2, 3, 4, 5, 6, 7], [{ file: "packages/x/src/f.ts", source: "return b || a > 9;" }]);
  assert.deepEqual(breaks.map(({ line, what }) => ({ line, what })), [
    { line: 4, what: "`===` to `!==`" },
    { line: 5, what: "`+` to `-`" },
  ]);
  const planted = breaks[0]!;
  assert.equal(SOURCE.slice(0, planted.at) + planted.replacement + SOURCE.slice(planted.at + planted.length), SOURCE.replace("a === 2", "a !== 2"));
  // A line the change did not add gets none.
  assert.deepEqual(fileBreaks("packages/x/src/f.ts", SOURCE, [5]).map(({ line }) => line), [5]);
});

test("7.1 · a change with more room than about 15 breaks gets 15, spread evenly across it, and its tests get none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-spread-"));
  try {
    const many = Array.from({ length: 30 }, (_, index) => `export const v${index} = (n) => n === ${index};`).join("\n") + "\n";
    const files = { "packages/demo/src/many.mjs": many, "packages/demo/src/many.test.mjs": "export const t = (n) => n === 1;\n" };
    write(dir, files);
    const { breaks, candidates } = changeBreaks(dir, adding(files));
    assert.equal(candidates, 30);
    assert.equal(breaks.length, 15);
    assert.deepEqual(breaks.map(({ line }) => line), Array.from({ length: 15 }, (_, index) => 2 * index + 1));
    assert.ok(breaks.every(({ file }) => file === "packages/demo/src/many.mjs"));
    assert.deepEqual(spread([1, 2, 3]), [1, 2, 3]);
  } finally {
    await removeTemp(dir);
  }
});

test("7.1 · a change touching only a hand-run script in an evidence folder plants no breaks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-evidence-"));
  try {
    const files = { "packages/x/evidence/y/capture.mjs": "export const shot = (n) => n === 1 ? \"a\" : \"b\";\n" };
    write(dir, files);
    const { breaks, candidates } = changeBreaks(dir, adding(files));
    assert.equal(candidates, 0);
    assert.deepEqual(breaks, []);
  } finally {
    await removeTemp(dir);
  }
});

test("7.2 · each break runs against the tests that reach its file: an untested branch survives, ranked by the files depending on it, a file no test reaches survives untried, and a file whose tests fail unbroken is not run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-mutate-"));
  try {
    write(dir, PACKAGE);
    const report = await mutationReport(dir, adding(PACKAGE));
    assert.equal(report.ran, true);
    if (!report.ran) return;
    assert.deepEqual(report.survivors.map(({ file, line, what, damage, untried }) => ({ file, line, what, damage, untried })), [
      { file: "packages/demo/src/grade.mjs", line: 2, what: "`>` to `<=`", damage: 2, untried: undefined },
      { file: "packages/demo/src/loud.mjs", line: 2, what: "`===` to `!==`", damage: 0, untried: true },
    ]);
    assert.equal(report.caught, 1);
    assert.equal(report.planted, 4);
    assert.deepEqual(report.notRun.map(({ file, line }) => ({ file, line })), [{ file: "packages/demo/src/broken.mjs", line: 1 }]);
    assert.match(report.notRun[0]!.why, /fail with nothing broken/);
    // Every break is written back.
    for (const file of ["packages/demo/src/grade.mjs", "packages/demo/src/broken.mjs"]) assert.equal(readFileSync(join(dir, file), "utf8"), PACKAGE[file]);
  } finally {
    await removeTemp(dir);
  }
});

/** A folder under infra/, no package but a unit `pnpm test` runs, whose test imports its code directly, beside a package with a file no test reaches. */
const INFRA: Record<string, string> = {
  "infra/host/host.mjs": "export const healthy = (rows) => rows > 0;\n",
  "infra/host/host.test.mjs": "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { healthy } from \"./host.mjs\";\ntest(\"healthy\", () => { assert.equal(healthy(1), true); assert.equal(healthy(0), false); });\n",
  "infra/other/other.mjs": "export const same = (a, b) => a === b;\n",
  "packages/lone/package.json": JSON.stringify({ name: "@t/lone", type: "module" }),
  "packages/lone/src/lone.mjs": "export const lone = (n) => n === 1;\n",
};

test("7.2 · a break in a file of an infra/ folder runs against the tests that folder's unit runs, and one in a file no test reaches survives untried", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-infra-"));
  try {
    write(dir, INFRA);
    const report = await mutationReport(dir, adding(INFRA));
    assert.equal(report.ran, true);
    if (!report.ran) return;
    assert.equal(report.planted, 3);
    assert.equal(report.caught, 1);
    assert.deepEqual(report.survivors.map(({ file, untried }) => ({ file, untried })), [
      { file: "infra/other/other.mjs", untried: true },
      { file: "packages/lone/src/lone.mjs", untried: true },
    ]);
    // A test in another infra/ folder that imports the file is one downstream of it, not one of its own.
    write(dir, { "infra/other/other.test.mjs": "import { test } from \"node:test\";\nimport { healthy } from \"../host/host.mjs\";\ntest(\"uses\", () => { healthy(1); });\n" });
    const reach = readReach(dir, ["infra/host", "infra/other"]);
    assert.deepEqual(reach.tests("infra/host/host.mjs"), ["infra/host/host.test.mjs"]);
    assert.deepEqual(reach.downstream("infra/host/host.mjs"), ["infra/other/other.test.mjs"]);
  } finally {
    await removeTemp(dir);
  }
});

/**
 * A desktop page no test imports: a capture kit bundles it by its path from the checkout's root, and a test imports the kit; a
 * second page a test bundles by its path beside the test; a third a test names only to check it is there.
 */
const BUNDLED: Record<string, string> = {
  "apps/web/package.json": JSON.stringify({ name: "@t/web", type: "module" }),
  "apps/web/src/page/page.mjs": "export const label = (n) => (n > 1 ? \"many\" : \"one\");\n",
  "apps/web/src/capture/build.mjs": [
    "import path from \"node:path\";",
    "import { pathToFileURL } from \"node:url\";",
    "const root = path.resolve(import.meta.dirname, \"../../../..\");",
    "export async function page() {",
    "  const options = { entryPoints: [path.join(root, \"apps/web/src/page/page.mjs\")], bundle: true };",
    "  return import(pathToFileURL(options.entryPoints[0]).href);",
    "}",
  ].join("\n") + "\n",
  "apps/web/src/page/page.test.mjs": "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { page } from \"../capture/build.mjs\";\ntest(\"labels\", async () => { const { label } = await page(); assert.equal(label(2), \"many\"); assert.equal(label(1), \"one\"); });\n",
  "apps/web/src/page/side.mjs": "export const on = (n) => n === 3;\n",
  "apps/web/src/page/side.test.mjs": [
    "import assert from \"node:assert/strict\";",
    "import path from \"node:path\";",
    "import { pathToFileURL } from \"node:url\";",
    "import { test } from \"node:test\";",
    "test(\"bundles\", async () => {",
    "  const options = { entryPoints: [path.join(import.meta.dirname, \"side.mjs\")] };",
    "  const { on } = await import(pathToFileURL(options.entryPoints[0]).href);",
    "  assert.equal(on(3), true);",
    "});",
  ].join("\n") + "\n",
  "apps/web/src/page/lone.mjs": "export const off = (n) => n === 4;\n",
  "apps/web/src/page/lone.test.mjs": "import assert from \"node:assert/strict\";\nimport { existsSync } from \"node:fs\";\nimport path from \"node:path\";\nimport { test } from \"node:test\";\ntest(\"is there\", () => { assert.ok(existsSync(path.join(import.meta.dirname, \"lone.mjs\"))); });\n",
};

test("7.2 · a break in a page no test imports, which a capture kit or a test bundles by its path, runs against the tests that bundle it, not as reached by no test", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-bundled-"));
  try {
    write(dir, BUNDLED);
    const pages = Object.fromEntries(["apps/web/src/page/page.mjs", "apps/web/src/page/side.mjs", "apps/web/src/page/lone.mjs"].map((file) => [file, BUNDLED[file]!]));
    const report = await mutationReport(dir, adding(pages));
    assert.equal(report.ran, true);
    if (!report.ran) return;
    assert.equal(report.planted, 3);
    assert.equal(report.caught, 2);
    // A path named outside `entryPoints`, as a file checked or read, bundles nothing.
    assert.deepEqual(report.survivors.map(({ file, untried }) => ({ file, untried })), [{ file: "apps/web/src/page/lone.mjs", untried: true }]);
  } finally {
    await removeTemp(dir);
  }
});

/**
 * A command no test imports: its test runs it in a child process, and the package's coverage map, measured with child
 * processes followed, credits it to capability 3, which that test is numbered with; a test numbered 4 runs something else.
 * A second file is credited to both, to 4 the more.
 */
const SPAWNED: Record<string, string> = {
  "packages/tool/package.json": JSON.stringify({ name: "@t/tool", type: "module" }),
  "packages/tool/survey-coverage.json": JSON.stringify({ "src/size.mjs": { 3: 1 }, "src/both.mjs": { 3: 1, 4: 2 } }),
  "packages/tool/src/size.mjs": "const size = (n) => (n > 10 ? \"big\" : \"small\");\nprocess.stdout.write(size(Number(process.argv[2])));\n",
  "packages/tool/src/size.test.mjs": [
    "import assert from \"node:assert/strict\";",
    "import { execFileSync } from \"node:child_process\";",
    "import path from \"node:path\";",
    "import { test } from \"node:test\";",
    "const size = (n) => execFileSync(process.execPath, [path.join(import.meta.dirname, \"size.mjs\"), String(n)], { encoding: \"utf8\" });",
    "test(\"3.1 · sizes\", () => { assert.equal(size(11), \"big\"); assert.equal(size(5), \"small\"); });",
  ].join("\n") + "\n",
  "packages/tool/src/other.test.mjs": "import { test } from \"node:test\";\ntest(\"4.1 · other\", () => {});\n",
};

test("7.2 · a break in code a test runs only in a child process, which the package's coverage map credits to the test's capability, runs against that test and is caught, not reached by no test", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-spawned-"));
  try {
    write(dir, SPAWNED);
    const reach = readReach(dir, ["packages/tool"]);
    assert.deepEqual(reach.tests("packages/tool/src/size.mjs"), ["packages/tool/src/size.test.mjs"]);
    // The tests of the capability the map credits the more come first.
    assert.deepEqual(reach.tests("packages/tool/src/both.mjs"), ["packages/tool/src/other.test.mjs", "packages/tool/src/size.test.mjs"]);
    const report = await mutationReport(dir, adding({ "packages/tool/src/size.mjs": SPAWNED["packages/tool/src/size.mjs"]! }));
    assert.equal(report.ran, true);
    if (!report.ran) return;
    assert.equal(report.planted, 1);
    assert.equal(report.caught, 1);
    assert.deepEqual(report.survivors, []);
  } finally {
    await removeTemp(dir);
  }
});

/**
 * A node:test reporter no test imports: a test runs `node --test` with it as the reporter, named by its package's name, and
 * checks what it prints. A node --test run writes no coverage from the process its reporters run in, so no map credits it.
 */
const REPORTED: Record<string, string> = {
  "packages/tool/package.json": JSON.stringify({ name: "@t/tool", type: "module", exports: { "./reporter": "./src/reporter.mjs" } }),
  "packages/tool/src/reporter.mjs": [
    "export default async function* passes(source) {",
    "  let passed = 0;",
    "  for await (const event of source) if (event.type === \"test:pass\") passed += 1;",
    "  yield passed === 1 ? \"one\" : \"other\";",
    "}",
  ].join("\n") + "\n",
  "packages/tool/src/fixture/one.mjs": "import { test } from \"node:test\";\ntest(\"one\", () => {});\n",
  "packages/tool/src/reporter.test.mjs": [
    "import assert from \"node:assert/strict\";",
    "import { execFileSync } from \"node:child_process\";",
    "import path from \"node:path\";",
    "import { test } from \"node:test\";",
    "const { NODE_TEST_CONTEXT: _parent, ...env } = process.env;",
    "test(\"reports\", () => {",
    "  const out = execFileSync(process.execPath, [\"--test\", \"--test-reporter=@t/tool/reporter\", \"--test-reporter-destination=stdout\", \"src/fixture/one.mjs\"],",
    "    { cwd: path.join(import.meta.dirname, \"..\"), env, encoding: \"utf8\" });",
    "  assert.equal(out, \"one\");",
    "});",
  ].join("\n") + "\n",
};

test("7.2 · a break in a node:test reporter a test runs only as its `node --test` child's --test-reporter, named by its package's name, runs against that test and is caught, not reached by no test", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-reported-"));
  try {
    write(dir, REPORTED);
    assert.deepEqual(readReach(dir, ["packages/tool"]).tests("packages/tool/src/reporter.mjs"), ["packages/tool/src/reporter.test.mjs"]);
    const report = await mutationReport(dir, adding({ "packages/tool/src/reporter.mjs": REPORTED["packages/tool/src/reporter.mjs"]! }));
    assert.equal(report.ran, true);
    if (!report.ran) return;
    assert.equal(report.planted, 2);
    assert.equal(report.caught, 2);
    assert.deepEqual(report.survivors, []);
  } finally {
    await removeTemp(dir);
  }
});

/**
 * A package whose `rule` is reached by more of its own tests than the downstream cap, all beside it and none noticing its
 * branch, and by one test in a sibling folder, reached through another file, that does.
 */
const CROWDED: Record<string, string> = {
  "packages/crowd/package.json": JSON.stringify({ name: "@t/crowd", type: "module" }),
  "packages/crowd/src/core/rule.mjs": "export const rule = (n) => (n > 5 ? \"many\" : \"few\");\n",
  ...Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`packages/crowd/src/core/near${index}.test.mjs`,
    "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { rule } from \"./rule.mjs\";\ntest(\"is a function\", () => { assert.equal(typeof rule, \"function\"); });\n"])),
  "packages/crowd/src/side/count.mjs": "import { rule } from \"../core/rule.mjs\";\nexport const count = (n) => rule(n);\n",
  "packages/crowd/src/side/count.test.mjs": "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { count } from \"./count.mjs\";\ntest(\"counts\", () => { assert.equal(count(9), \"many\"); assert.equal(count(1), \"few\"); });\n",
};

test("7.2 · a break runs against every test of its own package that reaches its file, however many, so one whose only killing test sits in a sibling folder beyond the nearest is caught, not a survivor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-crowded-"));
  try {
    write(dir, CROWDED);
    const report = await mutationReport(dir, adding({ "packages/crowd/src/core/rule.mjs": CROWDED["packages/crowd/src/core/rule.mjs"]! }));
    assert.equal(report.ran, true);
    if (!report.ran) return;
    assert.equal(report.planted, 1);
    assert.deepEqual(report.survivors, []);
    assert.equal(report.caught, 1);
  } finally {
    await removeTemp(dir);
  }
});

/**
 * A package whose own test misses a branch that the test of a package downstream of it, importing it by name, takes; that test
 * also imports a package linked from outside the checkout.
 */
const DOWNSTREAM: Record<string, string> = {
  "packages/pick/package.json": JSON.stringify({ name: "@t/pick", type: "module", exports: { ".": "./src/pick.mjs" } }),
  "packages/pick/src/pick.mjs": "export const pick = (n) => (n > 0 ? \"up\" : \"down\");\nexport const flag = (n) => n === 3;\n",
  "packages/pick/src/pick.test.mjs": "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { flag } from \"./pick.mjs\";\ntest(\"flags\", () => { assert.equal(flag(3), true); });\n",
  "packages/use/package.json": JSON.stringify({ name: "@t/use", type: "module", dependencies: { "@t/pick": "workspace:*" } }),
  "packages/use/src/use.test.mjs": "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { pick } from \"@t/pick\";\nimport { twice } from \"outside\";\ntest(\"picks\", () => { assert.equal(pick(1), \"up\"); assert.equal(pick(-1), \"down\"); assert.equal(twice(2), 4); });\n",
};

test("7.5 · a break its own package's tests miss, or cannot judge because they all fail unbroken, is run against the tests downstream that reach its file before it is called a survivor; one those tests cannot judge either, or the report's time runs out on, is not run, never a survivor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-downstream-"));
  const outside = mkdtempSync(join(tmpdir(), "qa-outside-"));
  // Its copy is made a folder deeper than the checkout, so a link out of the checkout read as one into it misses.
  const scratch = mkdtempSync(join(tmpdir(), "qa-downstream-scratch-"));
  try {
    write(dir, DOWNSTREAM);
    write(outside, { "package.json": JSON.stringify({ name: "outside", type: "module", exports: "./index.mjs" }), "index.mjs": "export const twice = (n) => n * 2;\n" });
    // The downstream package's tests resolve @t/pick as pnpm links it, and a package whose folder is outside the checkout.
    // Junctions, as pnpm links on Windows, where a directory symlink needs Developer Mode; POSIX ignores the type.
    mkdirSync(join(dir, "packages/use/node_modules/@t"), { recursive: true });
    symlinkSync(join(dir, "packages/pick"), join(dir, "packages/use/node_modules/@t/pick"), "junction");
    symlinkSync(outside, join(dir, "packages/use/node_modules/outside"), "junction");
    const diff = adding({ "packages/pick/src/pick.mjs": DOWNSTREAM["packages/pick/src/pick.mjs"]! });
    const report = await mutationReport(dir, diff, [], { scratch });
    assert.equal(report.ran, true);
    if (!report.ran) return;
    assert.deepEqual({ planted: report.planted, caught: report.caught, survivors: report.survivors, notRun: report.notRun }, { planted: 2, caught: 2, survivors: [], notRun: [] });
    assert.equal(readFileSync(join(dir, "packages/pick/src/pick.mjs"), "utf8"), DOWNSTREAM["packages/pick/src/pick.mjs"]);

    // Its own package's tests pass with the break, and the time runs out on the tests downstream.
    let clock = 0;
    const run: TestRun = async (_root, tests, limitMs) => {
      if (!tests.includes("packages/use/src/use.test.mjs")) return { passed: true, ms: 1 };
      clock += limitMs;
      return { passed: false, ms: limitMs, timedOut: true };
    };
    const timed = await mutationReport(dir, diff, [], { run, budgetMs: 300, now: () => clock });
    assert.ok(timed.ran);
    assert.deepEqual({ caught: timed.caught, survivors: timed.survivors }, { caught: 0, survivors: [] });
    assert.deepEqual(timed.notRun.map(({ line, why }) => ({ line, why })), [{ line: 1, why: "the report's time ran out first" }, { line: 2, why: "the report's time ran out first" }]);

    // Its own package's tests fail with nothing broken: the tests downstream still judge its breaks.
    write(dir, { "packages/pick/src/pick.test.mjs": "import { test } from \"node:test\";\nimport { flag } from \"./pick.mjs\";\ntest(\"needs what this run lacks\", () => { flag(3); throw new Error(\"red\"); });\n" });
    const ownRed = await mutationReport(dir, diff);
    assert.ok(ownRed.ran);
    assert.deepEqual({ caught: ownRed.caught, survivors: ownRed.survivors.map(({ line }) => line), notRun: ownRed.notRun.map(({ line }) => line) }, { caught: 1, survivors: [2], notRun: [] });

    // The tests downstream that reach its file fail with nothing broken: a break its own tests miss is not run, never a survivor.
    write(dir, {
      "packages/pick/src/pick.test.mjs": DOWNSTREAM["packages/pick/src/pick.test.mjs"]!,
      "packages/use/src/use.test.mjs": "import { test } from \"node:test\";\nimport { pick } from \"@t/pick\";\ntest(\"needs what this run lacks\", () => { pick(1); throw new Error(\"red\"); });\n",
    });
    const downstreamRed = await mutationReport(dir, diff);
    assert.ok(downstreamRed.ran);
    assert.deepEqual({ caught: downstreamRed.caught, survivors: downstreamRed.survivors }, { caught: 1, survivors: [] });
    assert.deepEqual(downstreamRed.notRun.map(({ line }) => line), [1]);
    assert.match(downstreamRed.notRun[0]!.why, /packages\/use\/src\/use\.test\.mjs/);
    assert.match(downstreamRed.notRun[0]!.why, /fail with nothing broken/);
  } finally {
    await removeTemp(dir);
    await removeTemp(outside);
    await removeTemp(scratch);
  }
});

/** A file whose break one test kills, held with another test that fails with nothing broken. */
const MIXED: Record<string, string> = {
  "packages/mixed/package.json": JSON.stringify({ name: "@t/mixed", type: "module" }),
  "packages/mixed/src/same.mjs": "export const same = (a, b) => a === b;\n",
  "packages/mixed/src/same.test.mjs": [
    "import assert from \"node:assert/strict\";",
    "import { test } from \"node:test\";",
    "import { same } from \"./same.mjs\";",
    "test(\"always red\", () => { assert.fail(\"needs what this run lacks\"); });",
    "test(\"same\", () => { assert.equal(same(1, 1), true); });",
  ].join("\n") + "\n",
};

test("7.6 · a break is caught when a test that passed with nothing broken no longer passes with it planted, so a test failing unbroken leaves out only itself, not the other tests in its file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-mixed-"));
  try {
    write(dir, MIXED);
    const report = await mutationReport(dir, adding({ "packages/mixed/src/same.mjs": MIXED["packages/mixed/src/same.mjs"]! }));
    assert.ok(report.ran);
    assert.deepEqual({ planted: report.planted, caught: report.caught, survivors: report.survivors, notRun: report.notRun }, { planted: 1, caught: 1, survivors: [], notRun: [] });
    assert.equal(readFileSync(join(dir, "packages/mixed/src/same.mjs"), "utf8"), MIXED["packages/mixed/src/same.mjs"]);
  } finally {
    await removeTemp(dir);
  }
});

/** A package whose test needs the environment `pnpm test` gives a unit: no agent's session, and the embedder off. */
const ENVIRONED: Record<string, string> = {
  "packages/environed/package.json": JSON.stringify({ name: "@t/environed", type: "module" }),
  "packages/environed/src/same.mjs": "export const same = (a, b) => a === b;\n",
  "packages/environed/src/same.test.mjs": [
    "import assert from \"node:assert/strict\";",
    "import { test } from \"node:test\";",
    "import { same } from \"./same.mjs\";",
    "test(\"same, as no session\", () => {",
    "  assert.deepEqual([process.env.STORYTREE_SESSION_ID, process.env.CODEX_THREAD_ID, process.env.CLAUDE_CODE_SESSION_ID, process.env.STORYTREE_EMBEDDER], [undefined, undefined, undefined, \"off\"]);",
    "  assert.equal(same(1, 1), true);",
    "});",
  ].join("\n") + "\n",
};

test("7.7 · a report run from inside an agent's session gives its tests the environment `pnpm test` gives them, so a test reading it passes unbroken and catches its break", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-environed-"));
  try {
    write(dir, ENVIRONED);
    const lane: TestRun = (root, tests, limitMs, env = process.env) => runTests(root, tests, limitMs, { ...env, STORYTREE_SESSION_ID: "a-lane", CODEX_THREAD_ID: "a-thread", CLAUDE_CODE_SESSION_ID: "a-claude" });
    const report = await mutationReport(dir, adding({ "packages/environed/src/same.mjs": ENVIRONED["packages/environed/src/same.mjs"]! }), [], { run: lane });
    assert.ok(report.ran);
    assert.deepEqual({ planted: report.planted, caught: report.caught, notRun: report.notRun }, { planted: 1, caught: 1, notRun: [] });
  } finally {
    await removeTemp(dir);
  }
});

/** A file of one break, reached by one test, for a report whose runs are given by hand. */
const KILLED = { file: "packages/killed/src/on.mjs", text: "export const on = (x) => x === 1;\n" };
const KILLED_REACH = { tests: () => ["packages/killed/src/on.test.mjs"], downstream: () => [], damage: () => 0 };

/** Run a report on `diff` in `dir` in a process of its own whose run with a break planted never ends, then kill it outright, as a tool's timeout does; `beside` runs while it hangs. */
async function killedMidBreak(dir: string, diff: string, scratch: string, beside: () => Promise<void> = async () => {}): Promise<void> {
  const script = join(dir, "hang.mjs");
  const planted = join(dir, "planted");
  writeFileSync(script, [
    `import { mutationReport } from ${JSON.stringify(new URL("./mutation.ts", import.meta.url).href)};`,
    "import { readFileSync, writeFileSync } from \"node:fs\";",
    "import { join } from \"node:path\";",
    "setInterval(() => {}, 1000);",
    `const reach = { tests: () => ["packages/killed/src/on.test.mjs"], downstream: () => [], damage: () => 0 };`,
    `const first = ${JSON.stringify(KILLED.text)};`,
    `await mutationReport(${JSON.stringify(dir)}, ${JSON.stringify(diff)}, [], { scratch: ${JSON.stringify(scratch)}, reach, run: async (root) => readFileSync(join(root, ${JSON.stringify(KILLED.file)}), "utf8") === first ? { passed: true, ms: 1 } : (writeFileSync(${JSON.stringify(planted)}, ""), new Promise(() => {})) });`,
  ].join("\n") + "\n");
  const hanging = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), script], { cwd: dir, stdio: "ignore" });
  const gone = new Promise((resolve) => hanging.once("exit", resolve));
  try {
    await waitUntil(() => existsSync(planted), 30_000, "the hanging report to plant its break");
    await beside();
  } finally {
    hanging.kill("SIGKILL");
    await gone;
  }
}

test("7.8 · a report never changes the checkout it is given: its breaks are planted in a copy, so a reader of the checkout, or a report beside it, sees its files unchanged, and a killed report's copy is removed by the next report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-killed-"));
  const scratch = mkdtempSync(join(tmpdir(), "qa-killed-scratch-"));
  const target = join(dir, KILLED.file);
  const diff = adding({ [KILLED.file]: KILLED.text });
  try {
    write(dir, { [KILLED.file]: KILLED.text });
    // Read while each run runs: the checkout holds the original, the copy the tests run in holds the break.
    const seen: { checkout: string; ran: string }[] = [];
    const report = await mutationReport(dir, diff, [], { scratch, reach: KILLED_REACH, run: async (root) => { seen.push({ checkout: readFileSync(target, "utf8"), ran: readFileSync(join(root, KILLED.file), "utf8") }); return { passed: seen.length === 1, ms: 1 }; } });
    assert.deepEqual({ ran: report.ran, caught: report.ran && report.caught }, { ran: true, caught: 1 });
    assert.deepEqual(seen.map(({ checkout }) => checkout), [KILLED.text, KILLED.text], "the checkout unchanged while every run runs");
    assert.deepEqual(seen.map(({ ran }) => ran), [KILLED.text, "export const on = (x) => x !== 1;\n"], "the break planted where the tests run");

    await killedMidBreak(dir, diff, scratch, async () => {
      assert.equal(readFileSync(target, "utf8"), KILLED.text, "the checkout unchanged while a break is planted");
      const beside = await mutationReport(dir, diff, [], { scratch, reach: KILLED_REACH, run: async (root) => ({ passed: readFileSync(join(root, KILLED.file), "utf8") === KILLED.text, ms: 1 }) });
      assert.deepEqual({ ran: beside.ran, caught: beside.ran && beside.caught }, { ran: true, caught: 1 }, "a report beside it runs on the original");
    });
    const left = readdirSync(scratch).filter((name) => name.startsWith("st-mutation-copy-"));
    assert.equal(left.length, 1, "the killed report's copy is left");
    assert.equal(readFileSync(target, "utf8"), KILLED.text);
    await mutationReport(dir, diff, [], { scratch, reach: KILLED_REACH, run: async () => ({ passed: true, ms: 1 }) });
    assert.deepEqual(readdirSync(scratch).filter((name) => name.startsWith("st-mutation-copy-")), [], "the next report removes it, and its own");
  } finally {
    await removeTemp(dir);
    await removeTemp(scratch);
  }
});

test("7.9 · the throwaway Postgres of a report killed outright is stopped and its folder removed when the next report starts, and a live report's, or a process its stale pid file names that is not its server, is left alone", async () => {
  const gone = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => gone.once("exit", resolve));
  // Its own scratch folder, so no other test's report sweeps these at the same time.
  const scratch = mkdtempSync(join(tmpdir(), "qa-scratch-"));
  const orphan = mkdtempSync(join(scratch, `st-mutation-pg-${gone.pid}-`));
  const stale = mkdtempSync(join(scratch, `st-mutation-pg-${gone.pid}-`));
  const live = mkdtempSync(join(scratch, `st-mutation-pg-${process.pid}-`));
  const dir = mkdtempSync(join(tmpdir(), "qa-orphan-"));
  // A server's command line names its data folder, as pg_ctl starts it; the stranger's names none.
  const sleep = (...args: string[]) => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...args], { stdio: "ignore" });
  const server = sleep("-D", join(orphan, "data"));
  const stranger = sleep();
  try {
    assert.notEqual(server.pid, gone.pid, "the dead report's pid was handed to its server; run again");
    write(orphan, { "data/postmaster.pid": `${server.pid}\n${join(orphan, "data")}\n` });
    write(stale, { "data/postmaster.pid": `${stranger.pid}\n${join(stale, "data")}\n` });
    write(live, { "data/postmaster.pid": `${server.pid}\n${join(live, "data")}\n` });
    const report = await mutationReport(dir, "", [], { scratch });
    assert.ok(report.ran);
    await waitUntil(() => server.exitCode !== null || server.signalCode !== null, 10_000, "the orphaned server to stop");
    assert.equal(existsSync(orphan), false, "its folder goes");
    assert.equal(existsSync(live), true, "a live report's folder stays");
    await quietFor(() => stranger.exitCode !== null || stranger.signalCode !== null, 1_000, "a process that is not the folder's server ending");
  } finally {
    server.kill("SIGKILL");
    stranger.kill("SIGKILL");
    await removeTemp(scratch);
    await removeTemp(dir);
  }
});

/** A git checkout whose origin/main holds a readme, and whose branch adds {@link PACKAGE}, its tests saved red. */
function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-mutation-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
  git("init", "-q");
  writeFileSync(join(dir, "README.md"), "demo\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  write(dir, PACKAGE);
  git("add", ".");
  git("commit", "-qm", "change");
  // Its new tests were seen red, as `pnpm test` saves them, so the red-run check (2.14) finds nothing here.
  write(dir, { ".pgtest/red-runs.jsonl": [["packages/demo/src/grade.test.mjs", "grades"], ["packages/demo/src/broken.test.mjs", "always red"]].map(([file, test]) => JSON.stringify({ file, test })).join("\n") + "\n" });
  return dir;
}

/** An increment naming one capability with no contracts, and no live checks. */
async function plan(library: Library): Promise<string> {
  const story = await library.addStory({ title: "Grades" });
  const capability = await library.addCapability({ title: "1 · Grading", story: story.id });
  const arc = await library.createArc({ title: "Grade", intent: "Grade numbers", endState: "Numbers graded", stories: [story.id] });
  return (await library.addIncrement({ arc: arc.id, title: "Grade", objective: "Grade numbers", body: "Grade numbers.", capabilities: [capability.id] })).id;
}

type Act = (args: Record<string, unknown>, call: Record<string, unknown>) => Promise<{ text: string; data: Record<string, unknown> }>;

function tools(): Record<string, Act> {
  const found: Record<string, Act> = {};
  qualityTools().registerTools!((name, _description, _input, act) => { found[name] = act as never; });
  return found;
}

const CLEAN: ReviewReturn = { review: 1, checks: [], contracts: [] };

test("7.3 · the brief read from a change's worktree carries its mutation report, and taking its return records each survivor as a hit found by the mutation report, standing until answered", async () => {
  const dir = checkout();
  try {
    await withLibrary(async (library, storytree) => {
      const increment = await plan(library);
      const call = { library, storytree, project: library.name };
      const brief = await tools().quality_brief!({ increment, worktree: dir }, call);
      assert.match(brief.text, /Mutation report: 4 breaks planted on the change's lines, 1 caught by a test, 2 survived, 1 not run/);
      assert.match(brief.text, /packages\/demo\/src\/grade\.mjs:2 {2}`>` to `<=` {2}\(2 files depend on it\)/);

      const taken = await tools().quality_take!({ increment, return: CLEAN, worktree: dir }, call);
      const hits = (taken.data["taken"] as { hits: { check: string; file: string; line: number; foundBy: string; source?: string }[] }).hits;
      assert.deepEqual(hits.map(({ check, file, line, foundBy, source }) => ({ check, file, line, foundBy, source })), [
        { check: MUTATION_SURVIVOR, file: "packages/demo/src/grade.mjs", line: 2, foundBy: "mutation", source: "if (n > 100 && strict) return \"huge\";" },
        { check: MUTATION_SURVIVOR, file: "packages/demo/src/loud.mjs", line: 2, foundBy: "mutation", source: "export const loud = (n) => grade(n) === \"big\";" },
      ]);
      assert.equal((await (await openReviews(storytree)).standing(library.name, increment)).length, 2);
      assert.match(taken.text, /2 findings stand/);
    });
  } finally {
    await removeTemp(dir);
  }
});

test("7.4 · a rejected survivor's line joins the arid list and is not offered again, and stands no longer without a review accepting it; a report that cannot run says why and the brief goes on", async () => {
  const dir = checkout();
  try {
    await withLibrary(async (library, storytree) => {
      const increment = await plan(library);
      const call = { library, storytree, project: library.name };
      await tools().quality_brief!({ increment, worktree: dir }, call);
      const taken = await tools().quality_take!({ increment, return: CLEAN, worktree: dir }, call);
      const [grade, loud] = (taken.data["taken"] as { hits: { id: number }[] }).hits;
      const ledger = await openLedger(storytree);
      await ledger.answer(library.name, grade!.id, { answer: "rejected", reason: "a strict grade above 100 is never asked for" });
      await ledger.answer(library.name, loud!.id, { answer: "fixed" });

      const reviews = await openReviews(storytree);
      assert.deepEqual(await reviews.standing(library.name, increment), []);
      assert.deepEqual(await aridList(storytree, library.name), [{ file: "packages/demo/src/grade.mjs", source: "if (n > 100 && strict) return \"huge\";" }]);
      const again = await mutationReport(dir, adding(PACKAGE), await aridList(storytree, library.name));
      assert.equal(again.ran && again.planted, 3);
      assert.ok(again.ran && !again.survivors.some(({ file }) => file === "packages/demo/src/grade.mjs"));

      // A report whose tests cannot be run says why, and the brief is issued all the same.
      const brief = await reviews.brief(library, increment, adding(PACKAGE));
      const { text, mutation } = await briefWithReport(storytree, brief, dir, { run: async () => { throw new Error("no node to run tests with"); } });
      assert.deepEqual(mutation, { ran: false, reason: "no node to run tests with" });
      assert.match(text, /Mutation report: not run \(no node to run tests with\)/);
    });
  } finally {
    await removeTemp(dir);
  }
});
