// The rules of `pnpm check:own-health` (packages/dev-loop/src/own-health.mjs): how a test run's results become
// each contract's verified health, and how a story's contracts and its package are read from 0.3's
// own library. The parsing and judging tests are pure; the library tests run against the Postgres
// `pnpm test` provides (STORYTREE_TEST_PG_URL), each in a project of its own that is dropped
// afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";
import pg from "pg";

import { checkStory } from "./check-own-health.mjs";
import { contractsCoveredBy, contractsOf, judge, packageOf, parseJunit, recordHealth, recordingTarget } from "./own-health.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const librarySrc = path.join(root, "packages", "library", "src");

test("parseJunit reads each test's name, the suites around it, its file, and whether it passed, failed or was skipped", () => {
  const results = parseJunit(JUNIT);
  assert.deepEqual(results, [
    { name: "packages\\library\\src\\transactions\\pg.test.ts", suites: [], file: "C:\\repo\\packages\\library\\src\\transactions\\pg.test.ts", status: "failed", message: "test failed" },
    { name: "1.1 openProject creates the project's database and its tables", suites: [], file: "C:\\repo\\a.test.ts", status: "passed" },
    { name: '2.3 [memory] a "quoted" <name> & more', suites: [], file: "C:\\repo\\a.test.ts", status: "passed" },
    { name: "8.1 live proof", suites: [], file: "C:\\repo\\a.test.ts", status: "skipped", message: "owner-gated" },
    { name: "3.1 fails", suites: [], file: "C:\\repo\\a.test.ts", status: "failed", message: "boom" },
    { name: "2.1 [cloud-sql] inside", suites: ["8.1 capability 2's suite"], file: "C:\\repo\\a.test.ts", status: "passed" },
    { name: "4.4 todo", suites: [], file: "C:\\repo\\a.test.ts", status: "skipped", message: "later" },
  ]);
});

test("5.4 judge: a contract passes only if every test it has passed; any failure fails it; a skipped test, or none, leaves it not checked", () => {
  const result = (name, status, extra = {}) => ({ name, suites: [], file: "C:\\repo\\a.test.ts", status, ...extra });
  const { verdicts, unmapped } = judge({
    contracts: ["1.1", "1.2", "1.3", "2.1", "2.2", "8.1", "8.2"],
    results: [
      result("1.1 [memory] one", "passed"),
      result("1.1 [postgres] one", "passed"),
      result("1.2 [memory] two", "passed"),
      result("1.2 [postgres] two", "failed", { message: "boom" }),
      result("2.1 [memory] some", "passed"),
      result("2.1 [postgres] some", "skipped", { message: "no server" }),
      result("8.1 live proof", "skipped", { message: "owner-gated" }),
      // Nested under 8.1, a test named for 2.2 counts for 8.1, the outermost numbered name.
      { name: "2.2 [cloud-sql] inside", suites: ["8.2 around it"], file: "C:\\repo\\a.test.ts", status: "passed" },
      result("robustness [memory] no number", "passed"),
      result("9.9 a contract the story does not have", "passed"),
    ],
    coverage: () => new Set(),
  });
  const brief = (number) => {
    const { state, note } = verdicts.get(number);
    return note === undefined ? { state } : { state, note };
  };
  assert.deepEqual(brief("1.1"), { state: "passing", note: "2/2 tests passed" });
  assert.deepEqual(brief("1.2"), { state: "failing", note: "1/2 tests passed" });
  assert.deepEqual(brief("1.3"), { state: "not-checked" }, "no tests");
  assert.deepEqual(brief("2.1"), { state: "not-checked" }, "a skipped test is not a pass");
  assert.deepEqual(brief("2.2"), { state: "not-checked" }, "its only test counts for 8.2");
  assert.deepEqual(brief("8.1"), { state: "not-checked" }, "all skipped");
  assert.deepEqual(brief("8.2"), { state: "passing", note: "1/1 tests passed" });
  assert.match(verdicts.get("2.1").reason, /1 of 2 tests skipped/);
  assert.match(verdicts.get("8.1").reason, /skipped.*owner-gated/);
  assert.match(verdicts.get("1.3").reason, /no tests/);
  assert.deepEqual(unmapped.map(({ name }) => name), ["robustness [memory] no number", "9.9 a contract the story does not have"]);
});

test("5.4 judge: a test file that produced no results leaves the contracts it holds not checked, never failing, and names the file", () => {
  const crashed = "C:\\repo\\packages\\library\\src\\transactions\\pg.test.ts";
  const { verdicts, crashedFiles } = judge({
    contracts: ["2.1", "2.2", "3.1"],
    results: [
      { name: "packages\\library\\src\\transactions\\pg.test.ts", suites: [], file: crashed, status: "failed", message: "test failed" },
      { name: "2.1 [memory] save", suites: [], file: "C:\\repo\\memory.test.ts", status: "passed" },
      { name: "2.2 [memory] edit", suites: [], file: "C:\\repo\\memory.test.ts", status: "failed", message: "boom" },
      { name: "3.1 [memory] schema", suites: [], file: "C:\\repo\\schema.test.ts", status: "passed" },
    ],
    coverage: (file) => (file === crashed ? new Set(["2.1", "2.2"]) : new Set()),
  });
  assert.equal(verdicts.get("2.1").state, "not-checked", "its memory half passed, but its postgres half never ran");
  assert.match(verdicts.get("2.1").reason, /pg\.test\.ts produced no results/);
  assert.equal(verdicts.get("2.1").crashed, true, "5.6: marked as a run that could not reproduce its verdict");
  assert.equal(verdicts.get("2.2").state, "failing", "a failure seen is still a failure");
  assert.equal(verdicts.get("3.1").state, "passing");
  assert.deepEqual(crashedFiles, [{ file: crashed, contracts: ["2.1", "2.2"] }]);
});

test("judge: every contract in a leading list shares the test's result, once each", async (t) => {
  for (const [title, numbers] of [
    ["2.2, 2.4 · choosing a project mentions 9.9 in prose", ["2.2", "2.4"]],
    ["2.2, 2.3 recovery", ["2.2", "2.3"]],
    ["4.1 and 4.3 queued arcs", ["4.1", "4.3"]],
    ["2.10 / 7.6 [memory] writer history", ["2.10", "7.6"]],
    ["2.1–2.4 the board names each window", ["2.1", "2.2", "2.3", "2.4"]],
    ["3.1, 3.4–3.6 the open overlay", ["3.1", "3.4", "3.5", "3.6"]],
    ["2.2, 2.2–2.4 / 2.4 and 2.3", ["2.2", "2.3", "2.4"]],
    ["3.6: delete a project", ["3.6"]],
    ["1.4, 1.6: deliver writes the hooks", ["1.4", "1.6"]],
  ]) {
    await t.test(title, () => {
      for (const [status, state] of [["passed", "passing"], ["failed", "failing"], ["skipped", "not-checked"]]) {
        const { verdicts, unmapped } = judge({
          contracts: [...numbers, "9.9"],
          results: [{ name: title, suites: [], file: "a.test.ts", status }],
          coverage: () => new Set(),
        });
        for (const number of numbers) {
          assert.equal(verdicts.get(number).state, state, `${number}: ${status}`);
          assert.equal(verdicts.get(number).total, 1, `${number} counts the test once`);
          assert.equal(verdicts.get(number)[status], 1);
        }
        assert.equal(verdicts.get("9.9").total, 0, "a number in prose gets no credit");
        assert.deepEqual(unmapped, []);
      }
    });
  }
});

test("judge: only the outermost numbered prefix gives credit, ignoring unknown numbers and later prose", () => {
  const result = (name, suites = []) => ({ name, suites, file: "a.test.ts", status: "passed" });
  const unknown = result("9.8, 9.9 · unknown contracts", ["unnumbered suite"]);
  const prose = result("mentions 2.2, 2.4 in prose");
  const { verdicts, unmapped } = judge({
    contracts: ["2.2", "2.4", "8.1", "8.2"],
    results: [
      result("2.2, 2.4 · inside", ["unnumbered suite", "8.1, 8.2 · outer", "2.2 · inner"]),
      result("9.9, 2.4 · includes a known contract"),
      result("2.2"),
      result("2.2 checks version 8.1 and 8.2, then 2.4"),
      result("2.2 8.1 is prose without a list separator"),
      unknown,
      prose,
      result("2.4 · inside an unknown numbered suite", ["9.8, 9.9 · outer"]),
    ],
    coverage: () => new Set(),
  });
  assert.deepEqual([...verdicts].map(([number, { total }]) => [number, total]), [
    ["2.2", 3], ["2.4", 1], ["8.1", 1], ["8.2", 1],
  ]);
  assert.deepEqual(unmapped.map(({ name }) => name), [unknown.name, prose.name, "2.4 · inside an unknown numbered suite"]);
});

test("contractsCoveredBy: a crashed multi-contract file leaves every named contract not checked", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "own-health-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "planted.test.ts");
  writeFileSync(file, 'test("2.2, 2.4–2.6 / 7.6 and 8.1 · mentions 9.9 in prose", () => {});');
  const numbers = ["2.2", "2.4", "2.5", "2.6", "7.6", "8.1"];
  const coverage = (source) => contractsCoveredBy(source, { root: directory });
  assert.deepEqual([...coverage(file)], numbers);
  const { verdicts, crashedFiles } = judge({
    contracts: [...numbers, "9.9"],
    results: [
      ...numbers.map((number) => ({ name: `${number} · another test`, suites: [], file: "other.test.ts", status: "passed" })),
      { name: file, suites: [], file, status: "failed" },
    ],
    coverage,
  });
  assert.deepEqual(crashedFiles, [{ file, contracts: numbers }]);
  for (const number of numbers) {
    assert.equal(verdicts.get(number).state, "not-checked");
    assert.match(verdicts.get(number).reason, /produced no results/);
  }
});

test("contractsCoveredBy reads only test titles: a comment or a fixture string naming a contract covers nothing", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "own-health-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "planted.test.ts");
  writeFileSync(
    file,
    [
      "/** Health as `1.2 · a doc comment` describes it. */",
      'const fixture = { name: "1.3 · a fixture string" };',
      'const TITLE = "1.4 · titled through a constant";',
      'test("1.1 · a test", () => {});',
      "test(TITLE, () => {});",
      'const SHARED = "1.6 · titled through a template";',
      "test(`${SHARED} (one way)`, () => {});",
      'contract(\n  "1.5", "titled through a helper", () => {});',
    ].join("\n"),
  );
  assert.deepEqual([...contractsCoveredBy(file, { root: directory })].sort(), ["1.1", "1.4", "1.5", "1.6"]);
});

test("contractsCoveredBy finds the contract numbers a test file names, in itself and in the modules it imports", () => {
  const covered = (file) => [...contractsCoveredBy(path.join(librarySrc, file), { root: librarySrc })].sort();
  assert.deepEqual(covered("transactions/pg.test.ts"), ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9"], "through behaviour-suite.ts");
  assert.deepEqual(covered("project/project-libraries.test.ts"), ["1.1", "1.10", "1.11", "1.12", "1.2", "1.3", "1.4", "1.5"]);
  assert.ok(covered("transactions/cloud-sql.test.ts").includes("8.1"));
});

/** A story in `lib` with one capability and four contracts, as `projectTree()` hands it back. */
async function kettle(lib) {
  const story = await lib.addStory({ title: "The command line" });
  const capability = await lib.addCapability({ story: story.id, title: "1 · Front door" });
  for (const [number, words] of [[1, "a"], [2, "b"], [3, "c"], [4, "d"]]) {
    await lib.addContract({ capability: capability.id, title: `1.${number} · It does ${words}` });
  }
  return (await lib.projectTree()).stories[0];
}

test("own health reads a story's contracts from the library, each number from its title, and its package from its title", async () => {
  await withLibrary(async (lib) => {
    const story = await kettle(lib);
    const { numbers, contractIds } = contractsOf(story);
    assert.deepEqual(numbers, ["1.1", "1.2", "1.3", "1.4"]);
    assert.deepEqual([...contractIds.values()], story.capabilities[0].contracts.map(({ id }) => id));
  });
  assert.equal(packageOf("The agent link"), "agent-link");
  assert.equal(packageOf("The arc surface"), "arc-surface");
  assert.equal(packageOf("The library"), "library");
  assert.equal(packageOf("The command line"), "cli", "a package named otherwise");
  assert.equal(packageOf("The world"), "forest-world");
  assert.equal(packageOf("The local database"), "local-postgres");
  assert.equal(packageOf("Process ledger"), "processes");
});

test("5.4 checking a story runs its own package's tests and records each contract's verified health from them; a run with no report, or a story with no package, records nothing", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "own-health-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await withLibrary(async (lib) => {
    const story = await kettle(lib);
    const { contractIds } = contractsOf(story);
    const ran = [];
    const quiet = { log: () => {}, error: () => {} };
    const result = (name, status) => ({ name, suites: [], file: path.join(root, "packages/cli/src/kettle.test.mjs"), status });
    const run = async (globs) => {
      ran.push(...globs);
      return { code: 1, results: [result("1.1 it does a", "passed"), result("1.2 it does b", "failed")] };
    };

    assert.equal(await checkStory(lib, story, { by: "storytree test run" }, { root, runTests: run, ...quiet }), true);
    assert.deepEqual(ran, [], "a story with no package runs no tests");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.1")), []);

    mkdirSync(path.join(root, "packages/cli/src"), { recursive: true });
    assert.equal(await checkStory(lib, story, { by: "storytree test run" }, { root, runTests: async () => ({ code: 1, results: undefined }), ...quiet }), false);
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.1")), [], "a run with no report records nothing");

    assert.equal(await checkStory(lib, story, { by: "storytree test run" }, { root, runTests: run, ...quiet }), true);
    assert.deepEqual(ran, ["packages/cli/src/**/*.test.ts", "packages/cli/src/**/*.test.mjs"]);
    assert.equal((await lib.health(contractIds.get("1.1"))).verified.state, "passing");
    assert.equal((await lib.health(contractIds.get("1.2"))).verified.state, "failing");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.3")), [], "a contract with no test is left not checked");
  });
});

test("recordHealth writes each passing or failing verdict to the verified column, with who and how many tests, and nothing for not checked", async () => {
  await withLibrary(async (lib) => {
    const { contractIds } = contractsOf(await kettle(lib));
    const verdicts = new Map([
      ["1.1", { number: "1.1", state: "passing", note: "2/2 tests passed" }],
      ["1.2", { number: "1.2", state: "failing", note: "1/2 tests passed" }],
      ["1.3", { number: "1.3", state: "not-checked", reason: "no tests" }],
    ]);
    const written = await recordHealth(lib, contractIds, verdicts);
    assert.deepEqual(written, { passing: 1, failing: 1, notChecked: 1, marked: 0 });

    const passing = await lib.health(contractIds.get("1.1"));
    assert.equal(passing.verified.state, "passing");
    assert.equal(passing.verified.by, "storytree test run");
    assert.equal(passing.verified.note, "2/2 tests passed");
    assert.deepEqual(passing.reported, { state: "not-checked" }, "the reported column is left alone");
    assert.equal((await lib.health(contractIds.get("1.2"))).verified.state, "failing");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.3")), [], "nothing is written for a contract not checked");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.4")), [], "nor for one with no verdict");
  });
});

test("recordHealth writes as the writer it is given: a run on CI says so, with its commit in the note", async () => {
  await withLibrary(async (lib) => {
    const { contractIds } = contractsOf(await kettle(lib));
    const verdicts = new Map([["1.1", { number: "1.1", state: "passing", note: "2/2 tests passed" }]]);
    await recordHealth(lib, contractIds, verdicts, { by: "storytree test run on CI", commit: "9f3734a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6" });
    const { verified } = await lib.health(contractIds.get("1.1"));
    assert.equal(verified.by, "storytree test run on CI");
    assert.equal(verified.note, "2/2 tests passed, at commit 9f3734a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6");
  });
});

test("5.6 judge reads a skipped contract's skip kind from its skip reason's first word: owner, platform:<os>, or other", () => {
  const result = (name, status, extra = {}) => ({ name, suites: [], file: "a.test.ts", status, ...extra });
  const { verdicts } = judge({
    contracts: ["1.1", "1.2", "1.3", "1.4"],
    results: [
      result("1.1 live proof", "skipped", { message: "owner: live Cloud SQL proof needs a sign-in" }),
      result("1.2 cmd.exe", "skipped", { message: "platform:win32: only Windows reads the .cmd again" }),
      result("1.3 later", "skipped", { message: "no server here" }),
      result("1.4 runs", "passed"),
    ],
    coverage: () => new Set(),
  });
  assert.deepEqual(["1.1", "1.2", "1.3", "1.4"].map((number) => verdicts.get(number).skip), ["owner", "platform:win32", "other", undefined]);
});

test("5.6 recordHealth records a skip's kind, marks a verdict the run did not reproduce as not re-run at the commit, and writes the same mark only once", async () => {
  await withLibrary(async (lib) => {
    const { contractIds } = contractsOf(await kettle(lib));
    const id = (number) => contractIds.get(number);
    const failed = await lib.recordVerified(id("1.1"), "failing", { by: "storytree test run", note: "11/13 tests passed" });
    const passed = await lib.recordVerified(id("1.3"), "passing", { by: "storytree test run" });
    await lib.recordVerified(id("1.4"), "passing", { by: "acceptance run", note: "3/3 checks passed" });
    const writer = { by: "storytree test run on CI", commit: "abc123" };
    const verdicts = new Map([
      ["1.1", { number: "1.1", state: "not-checked", skip: "owner", reason: "1 of 1 tests skipped (owner: needs a sign-in)" }],
      ["1.2", { number: "1.2", state: "not-checked", skip: "platform:win32", reason: "1 of 1 tests skipped" }],
      ["1.3", { number: "1.3", state: "not-checked", crashed: true, reason: "a.test.ts produced no results" }],
      ["1.4", { number: "1.4", state: "not-checked", reason: "no tests" }],
    ]);

    await recordHealth(lib, contractIds, verdicts, writer);

    const verified = async (number) => (await lib.health(id(number))).verified;
    const owner = await verified("1.1");
    assert.equal(owner.state, "not-checked");
    assert.equal(owner.skip, "owner");
    assert.deepEqual(owner.was, { state: "failing", at: failed.at }, "the failing it did not reproduce");
    assert.match(owner.note, /^not re-run at commit abc123: 1 of 1 tests skipped/);
    assert.deepEqual((await lib.healthHistory(id("1.1"))).map(({ state }) => state), ["failing", "not-checked"], "history keeps the old verdict");
    assert.equal((await verified("1.2")).skip, "platform:win32", "a skip is recorded even with nothing earlier");
    assert.deepEqual((await verified("1.3")).was, { state: "passing", at: passed.at }, "a verdict a crash left unreproduced");
    assert.equal((await verified("1.3")).skip, undefined);
    assert.equal((await lib.healthHistory(id("1.4"))).length, 1, "no tests to re-run it: a verdict from elsewhere (an acceptance run) stands");

    await recordHealth(lib, contractIds, verdicts, { ...writer, commit: "def456" });
    assert.equal((await lib.healthHistory(id("1.1"))).length, 2, "the same mark is not written again");
    assert.match((await verified("1.1")).note, /abc123/, "it still says since when");
  });
});

const CI = {
  GITHUB_ACTIONS: "true",
  GITHUB_SHA: "9f3734a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
  HEALTH_WIF_PROVIDER: "projects/635716509357/locations/global/workloadIdentityPools/github-actions/providers/storytree-ci-health",
  HEALTH_SERVICE_ACCOUNT: "storytree-ci-health@storytree-498613.iam.gserviceaccount.com",
  HEALTH_CLOUDSQL_INSTANCE: "storytree-498613:australia-southeast1:storytree-pg",
};

test("on CI, own health is recorded in the Cloud SQL library the CI identity names, signed in as its service account, by a test run on CI", () => {
  assert.deepEqual(recordingTarget({ env: CI, setting: { location: "local" } }), {
    record: true,
    library: { cloudSql: { instance: "storytree-498613:australia-southeast1:storytree-pg", user: "storytree-ci-health@storytree-498613.iam" } },
    writer: { by: "storytree test run on CI", commit: "9f3734a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6" },
  });
});

test("on CI with the identity not configured, nothing is recorded, and it says which repository variables are unset", () => {
  const { HEALTH_WIF_PROVIDER, HEALTH_CLOUDSQL_INSTANCE, ...partly } = CI;
  const target = recordingTarget({ env: partly, setting: { location: "local" } });
  assert.equal(target.record, false);
  assert.match(target.why, /HEALTH_WIF_PROVIDER, HEALTH_CLOUDSQL_INSTANCE/);
  assert.doesNotMatch(target.why, /HEALTH_SERVICE_ACCOUNT/);
  assert.equal(recordingTarget({ env: { ...CI, HEALTH_SERVICE_ACCOUNT: "" }, setting: { location: "local" } }).record, false, "an empty variable is unset");
});

test("run by hand, own health is recorded in the library the setting names: the Cloud SQL instance, or the app's own", () => {
  const cloud = { location: "cloudsql", instance: "storytree-498613:australia-southeast1:storytree-pg", user: "storytree-mint@storytree-498613.iam" };
  assert.deepEqual(recordingTarget({ env: {}, setting: cloud }), {
    record: true,
    library: { cloudSql: { instance: cloud.instance, user: cloud.user } },
    writer: { by: "storytree test run" },
  });
  assert.deepEqual(recordingTarget({ env: {}, setting: { location: "local" } }), { record: true, library: "app", writer: { by: "storytree test run" } });
});

const JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="packages\\library\\src\\transactions\\pg.test.ts" time="0.08" classname="test" file="C:\\repo\\packages\\library\\src\\transactions\\pg.test.ts" failure="test failed">
		<failure type="testCodeFailure" message="test failed">
[Error: test failed] { code: 'ERR_TEST_FAILURE', failureType: 'testCodeFailure', cause: 'test failed', exitCode: 1, signal: null }
		</failure>
	</testcase>
	<testcase name="1.1 openProject creates the project's database and its tables" time="1.3" classname="test" file="C:\\repo\\a.test.ts"/>
	<testcase name="2.3 [memory] a &amp;quot;quoted&amp;quot; &lt;name> &amp; more" time="0.1" classname="test" file="C:\\repo\\a.test.ts"/>
	<testcase name="8.1 live proof" time="0.001" classname="test" file="C:\\repo\\a.test.ts">
		<skipped type="skipped" message="owner-gated"/>
	</testcase>
	<testcase name="3.1 fails" time="0.001" classname="test" file="C:\\repo\\a.test.ts" failure="boom">
		<failure type="testCodeFailure" message="boom">
Error: boom &lt;&amp;> at TestContext.&lt;anonymous>
		</failure>
	</testcase>
	<testsuite name="8.1 capability 2's suite" time="0.0002" disabled="0" errors="0" tests="1" failures="0" skipped="0" hostname="box">
		<testcase name="2.1 [cloud-sql] inside" time="0.0001" classname="test" file="C:\\repo\\a.test.ts"/>
	</testsuite>
	<testcase name="4.4 todo" time="0.00006" classname="test" file="C:\\repo\\a.test.ts">
		<skipped type="todo" message="later"/>
	</testcase>
	<!-- tests 7 -->
</testsuites>
`;

/** A story file with three capabilities, their dependencies and their contracts, for syncStory to load and reload. */

/** Run `body` with a library for a fresh project on the test server, dropped afterwards, pass or fail. */
async function withLibrary(body) {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const name = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  try {
    const lib = await storytree.openProject(name);
    try {
      await body(lib);
    } finally {
      await lib.close();
    }
  } finally {
    await storytree.close();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}
