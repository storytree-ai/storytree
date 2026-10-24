/**
 * Capability 7 · Mutation report: contracts 7.1 to 7.4. 7.1 reads breaks from source text; 7.2 runs a real report on a
 * small package of node tests in a temp folder; 7.3 and 7.4 run it through the brief and take tools on the real Postgres
 * `pnpm test` provides, against a git checkout whose branch adds an untested branch.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import { aridList, briefWithReport, changeBreaks, fileBreaks, MUTATION_SURVIVOR, mutationReport, openLedger, openReviews, qualityTools, spread, type ReviewReturn } from "../index.js";

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

test("7.1 · a change with more room than about 15 breaks gets 15, spread evenly across it, and its tests get none", () => {
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
  }
});
