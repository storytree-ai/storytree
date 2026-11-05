/**
 * Capability 2 · Contract verdicts (ADR-0902 D3): each test result tied to its story and contract, and
 * each contract judged.
 *
 * Users' contract numbers repeat across stories (every story has a 1.1) and TAP names no file, so a
 * result is tied to its story by its title: it counts for the story whose package holds a test with
 * exactly that title at the commit the run tested (the package the map draws the story's code from,
 * read with the map's own survey). A title held by two stories' tests, or by none, credits nothing. A result no
 * test holds by its exact title counts, under the same rule, through a helper call that passes its number and title
 * as its first two arguments (`contract("11.8", "a wait is cleared …")`, run as `11.8 [memory] a wait is cleared …`):
 * the result's name begins with that number and ends with that title.
 * A result counts through its outermost numbered name, so a subtest counts for its parent's contract.
 *
 * A pytest result (a Python project's) names its file and its test, never a title: pytest's log carries the node id
 * (`tests/test_total.py::TestTotals::test_cart_2_2_empty`), not the docstring the survey may title the test by. So it
 * counts through the number its test's name carries, `test_2_2_…`, for the one story whose package holds that test in a
 * file the node id's path names (from wherever pytest ran: `tests/test_total.py` names every package's), or, when the
 * name names a story's package first (`test_cart_2_2_…`, its hyphens as underscores), for that package's story. An
 * imported story's package is the folders its code was mapped from, wherever they are (`.`, a flat project's top, holds
 * its `tests/`); a file two of those folders hold is the deeper one's. A
 * number only a docstring carries credits nothing here. A skip, which pytest names only by its file and line, is the
 * test whose decorators or definition that line is in, else the test whose body it is in.
 *
 * Judging follows storytree's own health (ADR-0744): verdictOf below is the one rule, and a run read from its junit report (../test-run/test-run.mjs) is judged by it too: a contract
 * passes only if it has tests and every one passed; any failure fails it; a skipped test is no pass,
 * so a skip leaves it not checked, as does having no tests. A skip whose reason names the platform the test needs
 * (`platform:<os>`) counts passed when every job of that platform ran the same test and
 * passed it: one skipped on Windows because it needs a POSIX shell is proved by the Linux and macOS jobs. A contract
 * a skip leaves not checked carries the skip's kind (ADR-0825 D2): `owner` when any reason says `owner:`, else the
 * platform one names, else `other`.
 */
import type { SkipKind } from "@storytree/library";
import { packagesOf, surveyStory, type SourceFile } from "@storytree/map";
import type { TestResult } from "../run-results/run-results.js";

/** The plan as judging needs it: stories, their numbered capabilities and contracts ("1.2 · …"). */
export type PlanTree = {
  readonly stories: readonly { readonly id: string; readonly title: string; readonly plugin?: string; readonly mapped?: { readonly folders: readonly string[] }; readonly capabilities: readonly { readonly id: string; readonly title: string; readonly contracts: readonly { readonly id: string; readonly title: string }[] }[] }[];
};

/** A story's proofs at one commit: its contracts by number, and each numbered test title its package holds. */
export type StoryProofs = {
  readonly story: string;
  /** The package named after its title, or the plugin it is. */
  readonly package: string;
  /** Every package it owns, its own first (ADR-1066 D3). */
  readonly packages: readonly string[];
  readonly contracts: ReadonlyMap<string, string>;
  /** Title -> the contract numbers it names, and the package a prefixed title names (`cart 1.2 …`). */
  readonly titles: ReadonlyMap<string, { readonly numbers: readonly string[]; readonly package?: string }>;
  /** Each helper call a test makes with a contract number and a title (`contract("11.8", "…")`). */
  readonly helped: readonly { readonly number: string; readonly title: string }[];
  /** Each pytest file its packages hold, by its repository path: its tests, in order. */
  readonly pytest: ReadonlyMap<string, readonly PytestTest[]>;
};

/** A pytest test as its file defines it: its name, the line of its `def` and of its first decorator (1-based). */
type PytestTest = { readonly name: string; readonly line: number; readonly from: number };

/** A pytest file, by its path. */
const PYTEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;

/** The tests a pytest file's text defines: every `test*` function, at the top or in a class, each from its decorators. */
function pytestTests(text: string): PytestTest[] {
  const tests: PytestTest[] = [];
  // The first line of the decorators above the next definition, and how far they are indented.
  let decorated: { from: number; indent: number } | undefined;
  text.split("\n").forEach((line, at) => {
    const indent = /^[ \t]*/.exec(line)![0].length;
    const code = line.trim();
    const defined = /^(?:async\s+)?def\s+(test\w*)/.exec(code);
    if (defined !== null) {
      tests.push({ name: defined[1]!, line: at + 1, from: decorated?.from ?? at + 1 });
      decorated = undefined;
    } else if (code.startsWith("@")) decorated ??= { from: at + 1, indent };
    // Code back at the decorators' indent that is not a test's definition (a fixture's, a class's) ends them.
    else if (code !== "" && !code.startsWith("#") && decorated !== undefined && indent <= decorated.indent && !/^[)\]}]/.test(code)) decorated = undefined;
  });
  return tests;
}

export type Verdict = { state: "passing" | "failing" | "not-checked"; passed: number; failed: number; skipped: number; total: number; note: string; skip?: SkipKind };

/**
 * Each story's proofs, from the files at the run's commit (repository paths): the tests of every package it owns, wherever they sit in
 * one, under `src/` or in a test folder beside it (`packages/<package>/test/…`), as users' projects lay them out.
 */
export function proofsAt(tree: PlanTree, files: readonly SourceFile[]): StoryProofs[] {
  const importedBy = importedPytest(tree, files);
  return tree.stories.map((story) => {
    const packages = packagesOf(story);
    const own = packages[0]!;
    const owned = files.filter((file) => packages.some((name) => file.path.startsWith(`packages/${name}/`)));
    // The survey reads only JavaScript and TypeScript here; pytest files are read by their tests' names below.
    const sources = owned.filter((file) => !file.path.endsWith(".py"));
    const pytest = new Map([...owned, ...files.filter((file) => importedBy.get(file.path) === story.id)].filter((file) => PYTEST_FILE.test(file.path)).map((file) => [file.path, pytestTests(file.text)] as const));
    const titles = new Map<string, { numbers: string[]; package?: string }>();
    const helped: { number: string; title: string }[] = [];
    if (sources.length > 0) {
      for (const test of surveyStory(sources, story.capabilities, {}, packages).tests ?? []) {
        const text = sources.find(({ path }) => path === test.path)?.text ?? "";
        for (const [, , number, quote, title] of text.matchAll(/[\w$.]\(\s*(["'`])(\d+\.\d+)\1\s*,\s*(["'`])((?:\\.|(?!\3)[^\\])+)\3/g)) {
          if (quote !== "`" || !title!.includes("${")) helped.push({ number: number!, title: asRun(title!) });
        }
        for (const { number, title: written, package: named } of test.titles) {
          const title = asRun(written);
          const held = titles.get(title) ?? { numbers: [], ...(named === undefined ? {} : { package: named }) };
          if (!held.numbers.includes(number)) held.numbers.push(number);
          titles.set(title, held);
        }
      }
    }
    const contracts = new Map<string, string>();
    for (const capability of story.capabilities) {
      for (const contract of capability.contracts) {
        const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
        if (number !== undefined) contracts.set(number, contract.id);
      }
    }
    return { story: story.id, package: own, packages, contracts, titles, helped, pytest };
  });
}

/**
 * The imported story each pytest file not in a built story's package is, by its path: the mapped story (ADR-0993 D2) whose
 * folder holding it is deepest (`.` is the project's top, so a flat project's `tests/` is its root story's). Two stories
 * mapped from one folder leave its files no story's.
 */
function importedPytest(tree: PlanTree, files: readonly SourceFile[]): Map<string, string> {
  const built = tree.stories.filter(({ mapped }) => mapped === undefined).flatMap((story) => packagesOf(story));
  const folders = tree.stories.flatMap(({ id, mapped }) => (mapped?.folders ?? []).map((folder) => ({ id, folder: folder.replace(/^\.\/?|\/$/g, "") })));
  const owners = new Map<string, string>();
  for (const { path } of files) {
    if (!PYTEST_FILE.test(path) || built.some((name) => path.startsWith(`packages/${name}/`))) continue;
    const holding = folders.filter(({ folder }) => folder === "" || path.startsWith(`${folder}/`));
    const deepest = Math.max(...holding.map(({ folder }) => folder.length));
    const at = holding.filter(({ folder }) => folder.length === deepest);
    if (at.length > 0 && at.every(({ id }) => id === at[0]!.id)) owners.set(path, at[0]!.id);
  }
  return owners;
}

/** A title as the test runner prints it: the survey keeps its source text, escapes and all (`admin\\'s`). */
function asRun(title: string): string {
  return title.replace(/\\(["'`\\])/g, "$1");
}

/** The name a result counts through: its outermost name that starts with a contract number. */
function countingName(result: TestResult): string | undefined {
  return [...result.suites, result.name].find((name) => /^(?:[a-z][a-z0-9-]*\s+)?\d+\.\d+/.test(name));
}

/** A pytest test's name: `test_`, then perhaps a package (words of letters and digits), then the number's two parts. */
const NUMBERED_NAME = /^test_((?:[a-z][a-z0-9]*_)*?)(\d+)_(\d+)(?![0-9])/i;

/** The pytest files the node id's path names in each story: its repository path, or one ending in it. */
function pytestHolders(proofs: readonly StoryProofs[], file: string): { story: StoryProofs; tests: readonly PytestTest[] }[] {
  return proofs.flatMap((story) => [...story.pytest].filter(([path]) => path === file || path.endsWith(`/${file}`)).map(([, tests]) => ({ story, tests })));
}

/** A pytest skip with its test's name, when the one file its path names has a test at its line; any other result as it is. */
function namedSkip(proofs: readonly StoryProofs[], result: TestResult): TestResult {
  if (result.file === undefined || result.name !== "" || result.line === undefined) return result;
  const holders = pytestHolders(proofs, result.file);
  if (holders.length !== 1) return result;
  const at = result.line;
  const tests = holders[0]!.tests;
  const test = tests.find(({ from, line }) => from <= at && at <= line) ?? tests.findLast(({ line }) => line < at);
  return test === undefined ? result : { ...result, name: test.name };
}

/** The story and contract numbers a pytest result credits, by the rules above, or undefined. */
function pytestCredit(proofs: readonly StoryProofs[], result: TestResult): { story: StoryProofs; numbers: readonly string[] } | undefined {
  const name = result.name.split("[", 1)[0]!;
  const holders = pytestHolders(proofs, result.file!).filter(({ tests }) => tests.some((test) => test.name === name));
  const numbered = NUMBERED_NAME.exec(name);
  if (holders.length !== 1 || numbered === null) return undefined;
  const [, prefix, major, minor] = numbered;
  const named = prefix!.replace(/_$/, "").toLowerCase();
  const story = named === "" ? holders[0]!.story : proofs.find(({ packages }) => packages.some((one) => one.replaceAll("-", "_") === named));
  return story === undefined ? undefined : { story, numbers: [`${major}.${minor}`] };
}

/** Whether a job on `platform` is one a test needing `need` (`posix`, `win32`, `darwin`, `linux`, `macos`) runs on. */
function serves(need: string, platform: string | undefined): boolean {
  if (platform === undefined) return false;
  if (need === "posix") return platform === "linux" || platform === "darwin";
  return platform === ({ windows: "win32", macos: "darwin" } as Record<string, string>)[need] || platform === need;
}

/** The platform a skip's reason says its test needs (`platform:posix: …` -> `posix`), or undefined. */
function neededPlatform(result: TestResult): string | undefined {
  return result.status === "skipped" ? /^platform:([a-z0-9]+)/i.exec(result.message ?? "")?.[1]?.toLowerCase() : undefined;
}

/** Each result, with a platform skip counted passed where every job of the platform it needs ran it and passed. */
function creditPlatformSkips(results: readonly TestResult[]): TestResult[] {
  // A pytest test by its file and name: a skip's line gives no class.
  const key = (result: TestResult) => JSON.stringify(result.file === undefined ? [result.suites, result.name] : [result.file, result.name]);
  const byTest = new Map<string, TestResult[]>();
  for (const result of results) byTest.set(key(result), [...(byTest.get(key(result)) ?? []), result]);
  return results.map((result) => {
    const need = neededPlatform(result);
    if (need === undefined || serves(need, result.platform)) return result;
    const there = byTest.get(key(result))!.filter(({ platform }) => serves(need, platform));
    return there.length > 0 && there.every(({ status }) => status === "passed") ? { ...result, status: "passed" } : result;
  });
}

/**
 * The kind of a contract's skip (ADR-0825 D2), from its skip reasons' first word: `owner` when any says `owner:` (only
 * the owner can give what it needs), else `platform:<os>` when one names the platform it runs on, else `other`.
 */
export function skipKind(reasons: readonly string[]): SkipKind {
  if (reasons.some((reason) => /^owner\b/i.test(reason))) return "owner";
  const platform = reasons.map((reason) => /^platform:([a-z0-9]+)/i.exec(reason)?.[1]).find(Boolean);
  return platform === undefined ? "other" : `platform:${platform.toLowerCase()}`;
}

/** Each contract's verdict from a run's results, and the results that credit no contract. */
export function judgeRun(proofs: readonly StoryProofs[], reported: readonly TestResult[]): { verdicts: Map<string, Verdict>; unmatched: TestResult[] } {
  const results = creditPlatformSkips(reported.map((result) => namedSkip(proofs, result)));
  const byPackage = new Map(proofs.flatMap((story) => story.packages.map((name) => [name, story] as const)));
  const tests = new Map<string, TestResult[]>(proofs.flatMap((story) => [...story.contracts.values()].map((id) => [id, []] as [string, TestResult[]])));
  const unmatched: TestResult[] = [];
  for (const result of results) {
    if (result.file !== undefined) {
      const credit = pytestCredit(proofs, result);
      const ids = credit === undefined ? [] : credit.numbers.flatMap((number) => credit.story.contracts.get(number) ?? []);
      if (ids.length === 0) unmatched.push(result);
      for (const id of ids) tests.get(id)!.push(result);
      continue;
    }
    const name = countingName(result);
    // Every story credited by a test holding this exact title: the holder, or the package a prefix names.
    const credited = new Map<string, { story: StoryProofs; numbers: readonly string[] }>();
    for (const story of name === undefined ? [] : proofs) {
      const held = story.titles.get(name!);
      if (held === undefined) continue;
      const target = held.package === undefined ? story : byPackage.get(held.package);
      if (target !== undefined) credited.set(target.story, { story: target, numbers: held.numbers });
    }
    // Failing that, every story with a helper call whose number begins the name and whose title ends it.
    for (const story of credited.size > 0 || name === undefined ? [] : proofs) {
      const numbers = [...new Set(story.helped.filter(({ number, title }) => name!.startsWith(`${number} `) && name!.endsWith(` ${title}`)).map(({ number }) => number))];
      if (numbers.length > 0) credited.set(story.story, { story, numbers });
    }
    const only = credited.size === 1 ? [...credited.values()][0]! : undefined;
    const ids = only === undefined ? [] : only.numbers.flatMap((number) => only.story.contracts.get(number) ?? []);
    if (ids.length === 0) unmatched.push(result);
    for (const id of ids) tests.get(id)!.push(result);
  }
  const verdicts = new Map<string, Verdict>();
  for (const [id, own] of tests) {
    verdicts.set(id, verdictOf(own));
  }
  return { verdicts, unmatched };
}

/**
 * A contract's verdict from its tests' results, the one rule every run is judged by (a CI log's or a junit report's): it
 * passes only if it has tests and every one passed; any failure fails it; a skipped test is no pass, so a skip leaves it
 * not checked, with its kind, as does having no tests. Passing and failing carry the tally as the note, not checked the
 * skips and their reasons; a failing one adds the first line of the first message its failed tests carry.
 */
export function verdictOf(own: readonly { readonly status: TestResult["status"]; readonly message?: string }[]): Verdict {
  const passed = own.filter(({ status }) => status === "passed").length;
  const failed = own.filter(({ status }) => status === "failed").length;
  const skipped = own.filter(({ status }) => status === "skipped").length;
  const counts = { passed, failed, skipped, total: own.length };
  const tally = `${passed}/${own.length} tests passed`;
  if (failed > 0) {
    // The first failure's message, so a failing reading says why without its run's log (friction_b8ae83aa48e5).
    const first = own.find(({ status, message }) => status === "failed" && message?.trim())?.message?.trim().split("\n")[0]?.trim();
    return { state: "failing", ...counts, note: first === undefined ? tally : `${tally}; first failure: ${clipped(first)}` };
  }
  if (own.length === 0) return { state: "not-checked", ...counts, note: "no test ran" };
  if (skipped > 0) {
    const reasons = [...new Set(own.flatMap(({ status, message }) => (status === "skipped" && message ? [message] : [])))];
    return { state: "not-checked", ...counts, skip: skipKind(reasons), note: `${skipped} of ${own.length} tests skipped${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}` };
  }
  return { state: "passing", ...counts, note: tally };
}

/** The most of a failure's message a note quotes. */
const MESSAGE_LIMIT = 200;

/** `message` cut to MESSAGE_LIMIT characters, ending in an ellipsis when cut. */
function clipped(message: string): string {
  return message.length <= MESSAGE_LIMIT ? message : `${message.slice(0, MESSAGE_LIMIT - 1)}…`;
}
