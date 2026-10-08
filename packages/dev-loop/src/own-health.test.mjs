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

import { connect } from "@storytree/library";
import pg from "pg";

import { checkStory } from "./check-own-health.mjs";
import { contractsCoveredBy, contractsOf, judge, packageOf, parseJunit, readCiEvidence, recordHealth, recordingTarget } from "./own-health.mjs";

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

test("contractsCoveredBy finds the contract numbers a test file names, in itself and in the modules it imports", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "own-health-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const src = path.join(directory, "src");
  mkdirSync(path.join(src, "transactions"), { recursive: true });
  const plant = (file, lines) => writeFileSync(path.join(src, file), lines.join("\n"));
  plant("transactions/pg.test.ts", ['import { suite } from "./behaviour-suite.js";', 'import { helper } from "../helper.js";', "suite();"]);
  plant("transactions/behaviour-suite.ts", ['import { more } from "./more";', 'export function suite() { test("2.1 · commits", () => {}); test("2.3 · rolls back", () => {}); }']);
  plant("transactions/more.ts", ['import { suite } from "./behaviour-suite.js";', 'test("2.2 · nests", () => {});']);
  plant("helper.ts", ['test("4.1 · helps", () => {});']);
  plant("named.test.ts", ['import "./transactions/more.js";', 'test("1.1 · opens", () => {});', 'test("1.13, 1.2 · closes", () => {});']);
  writeFileSync(path.join(directory, "outside.ts"), 'test("9.9 · beyond the root", () => {});');
  plant("reaches-out.test.ts", ['import "../outside.js";', 'test("3.1 · inside", () => {});']);
  const covered = (file) => [...contractsCoveredBy(path.join(src, file), { root: src })].sort();
  // pg.test.ts names no contract itself: it covers what the modules it imports name, transitively and through a cycle.
  assert.deepEqual(covered("transactions/pg.test.ts"), ["2.1", "2.2", "2.3", "4.1"]);
  assert.deepEqual(covered("named.test.ts"), ["1.1", "1.13", "1.2", "2.1", "2.2", "2.3"], "its own titles and an import's");
  assert.deepEqual(covered("reaches-out.test.ts"), ["3.1"], "a module outside the root covers nothing");
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

test("5.4 checking a story also runs a dependant's test titled with the story's package and a contract, like cli 1.3, crediting only those titles", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "own-health-dependant-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "packages/cli/src"), { recursive: true });
  mkdirSync(path.join(root, "packages/agent-link/src/tools"), { recursive: true });
  mkdirSync(path.join(root, "packages/library/src"), { recursive: true });
  const own = path.join(root, "packages/cli/src/kettle.test.mjs");
  const dependant = path.join(root, "packages/agent-link/src/tools/door.test.ts");
  writeFileSync(own, 'test("1.1 it does a", () => {});\n');
  const prefixed = ["cli", "1.3: the tool does what the command does"].join(" ");
  writeFileSync(dependant, `test(${JSON.stringify(prefixed)}, () => {});\ntest("1.4 the agent link's own 1.4", () => {});\n`);
  writeFileSync(path.join(root, "packages/library/src/other.test.ts"), 'test("1.3 the library\'s own 1.3", () => {});\n');
  await withLibrary(async (lib) => {
    const story = await kettle(lib);
    const { contractIds } = contractsOf(story);
    const ran = [];
    const run = async (globs) => {
      ran.push(...globs);
      return {
        code: 1,
        results: [
          { name: "1.1 it does a", suites: [], file: own, status: "passed" },
          { name: prefixed, suites: [], file: dependant, status: "passed" },
          { name: "1.4 the agent link's own 1.4", suites: [], file: dependant, status: "failed" },
        ],
      };
    };
    assert.equal(await checkStory(lib, story, { by: "storytree test run" }, { root, runTests: run, log: () => {}, error: () => {} }), true);
    assert.deepEqual(ran, ["packages/cli/src/**/*.test.ts", "packages/cli/src/**/*.test.mjs", "packages/agent-link/src/tools/door.test.ts"]);
    assert.equal((await lib.health(contractIds.get("1.3"))).verified.state, "passing", "the dependant's prefixed title proves 1.3");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.4")), [], "a dependant's own unprefixed 1.4 is not the story's");
  });
});

test("5.4 checking the app story also runs the desktop app's tests as its own, crediting their numbered titles", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "own-health-frame-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "packages/app/src"), { recursive: true });
  mkdirSync(path.join(root, "apps/desktop/src/main"), { recursive: true });
  const own = path.join(root, "packages/app/src/projects.test.ts");
  const frame = path.join(root, "apps/desktop/src/main/start-check.test.ts");
  writeFileSync(own, 'test("1.1 it lists the projects", () => {});\n');
  writeFileSync(frame, 'test("1.2 a start that fails ends the app", () => {});\n');
  await withLibrary(async (lib) => {
    const added = await lib.addStory({ title: "The app" });
    const capability = await lib.addCapability({ story: added.id, title: "1 · Lifecycle" });
    for (const number of [1, 2]) await lib.addContract({ capability: capability.id, title: `1.${number} · It does ${number}` });
    const story = (await lib.projectTree()).stories[0];
    const { contractIds } = contractsOf(story);
    const ran = [];
    const run = async (globs) => {
      ran.push(...globs);
      return {
        code: 0,
        results: [
          { name: "1.1 it lists the projects", suites: [], file: own, status: "passed" },
          { name: "1.2 a start that fails ends the app", suites: [], file: frame, status: "passed" },
        ],
      };
    };
    assert.equal(await checkStory(lib, story, { by: "storytree test run" }, { root, runTests: run, log: () => {}, error: () => {} }), true);
    assert.deepEqual(ran, ["packages/app/src/**/*.test.ts", "packages/app/src/**/*.test.mjs", "apps/desktop/src/**/*.test.ts", "apps/desktop/src/**/*.test.mjs"]);
    assert.equal((await lib.health(contractIds.get("1.2"))).verified.state, "passing", "the desktop app's unprefixed 1.2 is the app story's");
  });
});

test("5.4 Windows CI at the same commit verifies Get storytree 1.9 and Front door 1.12, naming its run; unavailable or unrelated evidence gives no credit, and a run that saw no Windows leaves that pass standing", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "own-health-windows-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const commit = "a".repeat(40);
  const windowsRun = "https://github.com/storytree-ai/storytree/actions/runs/123/attempts/1";
  const quiet = { log: () => {}, error: () => {} };
  for (const [title, pkg, number, file] of [
    ["The app setup", "app-setup", "1.9", "deliver/delivery.test.ts"],
    ["The command line", "cli", "1.12", "launched.test.ts"],
  ]) {
    mkdirSync(path.join(root, "packages", pkg, "src"), { recursive: true });
    await withLibrary(async (lib) => {
      const story = await lib.addStory({ title });
      const capability = await lib.addCapability({ story: story.id, title: "1 · Install and run" });
      const contract = await lib.addContract({ capability: capability.id, title: `${number} · Windows command preserves words` });
      const planned = (await lib.projectTree()).stories[0];
      const test = { name: `${number} Windows command preserves words`, suites: [], file: `packages/${pkg}/src/${file}` };
      const skipped = { ...test, file: path.join(root, test.file), status: "skipped", message: "platform:win32: needs the Windows command" };
      const evidence = { platform: "win32", commit, run: windowsRun, unit: pkg, code: 0, results: [{ ...test, status: "passed" }] };
      const directory = path.join(root, "evidence");
      const record = async (windows, results = [skipped]) => {
        rmSync(directory, { recursive: true, force: true });
        if (windows !== undefined) {
          mkdirSync(path.join(directory, "unit-1"), { recursive: true });
          writeFileSync(path.join(directory, "unit-1", "result.json"), JSON.stringify(windows));
        }
        await checkStory(lib, planned, { by: "storytree test run on CI", commit }, {
          root, ...quiet, evidence: [readCiEvidence(directory, { commit, run: windowsRun, platform: "win32" })], runTests: async () => ({ code: 0, results }),
        });
        return (await lib.health(contract.id)).verified;
      };
      for (const windows of [undefined, { ...evidence, commit: "b".repeat(40) }, { ...evidence, platform: "linux" },
        { ...evidence, run: windowsRun.replace("attempts/1", "attempts/2") }, { ...evidence, code: 1 }, { ...evidence, code: undefined },
        { ...evidence, results: [] }, { ...evidence, results: [{ ...test, status: "failed" }] },
        { ...evidence, results: [{ ...test, status: "skipped" }] },
        { ...evidence, results: [{ ...test, file: "packages/other/src/launched.test.ts", status: "passed" }] },
        { ...evidence, results: [{ ...test, suites: ["different suite"], status: "passed" }] },
        { ...evidence, results: [{ ...test, name: "different test", status: "passed" }] },
        { ...evidence, results: [{ ...test, status: "passed" }, { ...test, status: "failed" }] },
      ]) assert.equal((await record(windows)).state, "not-checked");
      assert.equal((await record(evidence, [{ ...skipped, message: "owner: needs a real install" }])).state, "not-checked");
      assert.equal((await record(evidence, [skipped, { ...skipped, name: `${number} another Windows proof` }])).state, "not-checked", "every skipped test needs its own proof");
      assert.equal((await record(evidence, [skipped, { ...skipped, name: `${number} local failure`, status: "failed" }])).state, "failing", "Windows cannot erase a local failure");
      const verified = await record(evidence);
      assert.equal(verified.state, "passing");
      assert.equal(verified.skip, undefined);
      assert.match(verified.note, /1\/1 tests passed/);
      assert.ok(verified.note.includes(commit));
      assert.ok(verified.note.includes(windowsRun), "names the actual Windows run");
      assert.equal((await record(undefined)).state, "passing", "a run without Windows evidence cannot re-run it, so the Windows pass stands");
      assert.equal((await record({ ...evidence, results: [{ ...test, status: "failed" }] })).state, "not-checked", "Windows evidence that does not prove it takes the pass away");
      mkdirSync(path.join(directory, "unit-2"));
      writeFileSync(path.join(directory, "unit-2", "result.json"), JSON.stringify({ ...evidence, unit: "other", results: [{ ...test, file: "packages/other/src/test.ts", status: "passed" }] }));
      assert.equal(readCiEvidence(directory, { commit, run: windowsRun, platform: "win32" }).results.length, 2, "reads every unit, not only the last");
      writeFileSync(path.join(directory, "unit-2", "result.json"), "{incomplete");
      assert.equal(readCiEvidence(directory, { commit, run: windowsRun, platform: "win32" }), undefined, "incomplete evidence grants no credit");
    });
  }
});

test("5.4 macOS CI at the same commit verifies Get storytree 1.11's Apple Silicon test, naming its run; Windows evidence cannot credit it, macOS evidence cannot credit a Windows skip, and a run that saw no macOS leaves that pass standing", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "own-health-macos-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const commit = "c".repeat(40);
  const ciRun = "https://github.com/storytree-ai/storytree/actions/runs/456/attempts/1";
  const quiet = { log: () => {}, error: () => {} };
  mkdirSync(path.join(root, "packages", "app-setup", "src"), { recursive: true });
  await withLibrary(async (lib) => {
    const story = await lib.addStory({ title: "The app setup" });
    const capability = await lib.addCapability({ story: story.id, title: "1 · Get storytree" });
    const contract = await lib.addContract({ capability: capability.id, title: "1.11 · Apple Silicon payload" });
    const planned = (await lib.projectTree()).stories[0];
    const test = { name: "1.11: the pinned darwin-arm64 runtime runs on an Apple Silicon Mac", suites: [], file: "packages/app-setup/src/deliver/runtime.test.ts" };
    const skipped = { ...test, file: path.join(root, test.file), status: "skipped", message: "platform:darwin-arm64: only an Apple Silicon Mac can run Node's darwin-arm64 build" };
    const passedHere = { ...test, name: "1.11: a Mac runtime is staged from Node's pinned darwin-arm64 archive", file: path.join(root, test.file), status: "passed" };
    const mac = { platform: "darwin", commit, run: ciRun, unit: "app-setup", code: 0, results: [{ ...test, status: "passed" }] };
    const directories = { darwin: path.join(root, "macos-evidence"), win32: path.join(root, "windows-evidence") };
    const record = async (reports, results = [skipped, passedHere]) => {
      for (const directory of Object.values(directories)) rmSync(directory, { recursive: true, force: true });
      for (const report of reports) {
        mkdirSync(path.join(directories[report.platform] ?? directories.darwin, "unit-1"), { recursive: true });
        writeFileSync(path.join(directories[report.platform] ?? directories.darwin, "unit-1", "result.json"), JSON.stringify(report));
      }
      const evidence = Object.entries(directories).map(([platform, directory]) => readCiEvidence(directory, { commit, run: ciRun, platform }));
      await checkStory(lib, planned, { by: "storytree test run on CI", commit }, { root, ...quiet, evidence, runTests: async () => ({ code: 0, results }) });
      return (await lib.health(contract.id)).verified;
    };
    for (const reports of [[], [{ ...mac, platform: "win32" }], [{ ...mac, platform: "linux" }], [{ ...mac, results: [{ ...test, status: "skipped" }] }], [{ ...mac, commit: "d".repeat(40) }]]) {
      const verified = await record(reports);
      assert.equal(verified.state, "not-checked", JSON.stringify(reports));
      assert.equal(verified.skip, "platform:darwin");
    }
    assert.equal((await record([mac], [{ ...skipped, message: "platform:win32: needs Windows" }])).state, "not-checked", "macOS evidence cannot credit a Windows skip");
    const verified = await record([mac]);
    assert.equal(verified.state, "passing");
    assert.match(verified.note, /2\/2 tests passed; macOS: /);
    assert.ok(verified.note.includes(ciRun), "names the actual macOS run");
    assert.equal((await record([])).state, "passing", "a run without macOS evidence cannot re-run it, so the macOS pass stands");
    assert.equal((await record([{ ...mac, platform: "win32", results: [{ ...test, status: "passed" }] }])).state, "passing", "Windows evidence alone does not take a macOS pass away");
    assert.equal((await record([{ ...mac, results: [{ ...test, status: "failed" }] }])).state, "not-checked", "macOS evidence that does not prove it takes the pass away");
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

test("on CI with HEALTH_PG_ADDRESS set, own health is recorded in the library at that address, by a test run on CI, whatever the Cloud SQL identity says", () => {
  const address = "postgres://storytree-ci-health%40storytree-498613.iam@100.97.8.31:5432/postgres";
  const expected = { record: true, library: { address }, writer: { by: "storytree test run on CI", commit: CI.GITHUB_SHA } };
  assert.deepEqual(recordingTarget({ env: { ...CI, HEALTH_PG_ADDRESS: address }, setting: { location: "local" } }), expected);
  assert.deepEqual(recordingTarget({ env: { GITHUB_ACTIONS: "true", GITHUB_SHA: CI.GITHUB_SHA, HEALTH_PG_ADDRESS: address }, setting: { location: "local" } }), expected, "no Google identity is needed");
  assert.deepEqual(recordingTarget({ env: { ...CI, HEALTH_PG_ADDRESS: "" }, setting: { location: "local" } }).library, { cloudSql: { instance: CI.HEALTH_CLOUDSQL_INSTANCE, user: "storytree-ci-health@storytree-498613.iam" } }, "an empty address keeps Cloud SQL");
});

test("run by hand, own health is recorded in the library the setting names: the Cloud SQL instance, a Postgres address, or the app's own", () => {
  const cloud = { location: "cloudsql", instance: "storytree-498613:australia-southeast1:storytree-pg", user: "storytree-mint@storytree-498613.iam" };
  assert.deepEqual(recordingTarget({ env: {}, setting: cloud }), {
    record: true,
    library: { cloudSql: { instance: cloud.instance, user: cloud.user } },
    writer: { by: "storytree test run" },
  });
  assert.deepEqual(recordingTarget({ env: {}, setting: { location: "local" } }), { record: true, library: "app", writer: { by: "storytree test run" } });
  const address = "postgres://mickh@mickh-a520i-ac:5432/postgres";
  assert.deepEqual(recordingTarget({ env: {}, setting: { location: "postgres", address } }), { record: true, library: { address }, writer: { by: "storytree test run" } });
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
