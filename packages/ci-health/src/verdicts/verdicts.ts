// Capability 2 · Contract verdicts.
import type { SkipKind } from "@storytree/library";
import { dependenciesOf, isTestFile, packagesOf, readersReady, surveyStory, type SourceFile } from "@storytree/map";
import "@storytree/map/code-survey";
import type { TestResult } from "../run-results/run-results.js";

type PlannedContract = { readonly id: string; readonly title: string; readonly provedBy?: readonly string[] };

export type PlanTree = {
  readonly stories: readonly { readonly id: string; readonly title: string; readonly plugin?: string; readonly mapped?: { readonly folders: readonly string[] }; readonly capabilities: readonly { readonly id: string; readonly title: string; readonly covers?: readonly string[]; readonly contracts: readonly PlannedContract[] }[]; readonly edges?: readonly { readonly contracts: readonly PlannedContract[] }[] }[];
};

export type StoryProofs = {
  readonly story: string;
  readonly package: string;
  readonly packages: readonly string[];
  readonly contracts: ReadonlyMap<string, string>;
  readonly titles: ReadonlyMap<string, { readonly numbers: readonly string[]; readonly package?: string }>;
  readonly helped: readonly { readonly number: string; readonly title: string }[];
  readonly pytest: ReadonlyMap<string, readonly PytestTest[]>;
  readonly proved: readonly { readonly contract: string; readonly test: string }[];
};

type PytestTest = { readonly name: string; readonly line: number; readonly from: number };

const PYTEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;

function pytestTests(text: string): PytestTest[] {
  const tests: PytestTest[] = [];
  let decorated: { from: number; indent: number } | undefined;
  text.split("\n").forEach((line, at) => {
    const indent = /^[ \t]*/.exec(line)![0].length;
    const code = line.trim();
    const defined = /^(?:async\s+)?def\s+(test\w*)/.exec(code);
    if (defined !== null) {
      tests.push({ name: defined[1]!, line: at + 1, from: decorated?.from ?? at + 1 });
      decorated = undefined;
    } else if (code.startsWith("@")) decorated ??= { from: at + 1, indent };
    else if (code !== "" && !code.startsWith("#") && decorated !== undefined && indent <= decorated.indent && !/^[)\]}]/.test(code)) decorated = undefined;
  });
  return tests;
}

export type Verdict = { state: "passing" | "failing" | "not-checked"; passed: number; failed: number; skipped: number; total: number; note: string; skip?: SkipKind; tests?: string[] };

export function proofsAt(tree: PlanTree, files: readonly SourceFile[]): StoryProofs[] {
  const importedBy = importedPytest(tree, files);
  return tree.stories.map((story) => {
    const packages = packagesOf(story);
    const own = packages[0]!;
    const owned = files.filter((file) => packages.some((name) => file.path.startsWith(`packages/${name}/`)));
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
    const proved: { contract: string; test: string }[] = [];
    for (const contract of [...story.capabilities, ...(story.edges ?? [])].flatMap((part) => part.contracts)) {
      const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
      if (number !== undefined) contracts.set(number, contract.id);
      for (const test of contract.provedBy ?? []) proved.push({ contract: contract.id, test });
    }
    return { story: story.id, package: own, packages, contracts, titles, helped, pytest, proved };
  });
}

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

function asRun(title: string): string {
  return title.replace(/\\(["'`\\])/g, "$1");
}

const COUNTING_NAME = /^(?:[a-z][a-z0-9-]*\s+)?(\d+\.\d+)/;

function countingName(result: TestResult): string | undefined {
  return [...result.suites, result.name].find((name) => COUNTING_NAME.test(name));
}

const NUMBERED_NAME = /^test_((?:[a-z][a-z0-9]*_)*?)(\d+)_(\d+)(?![0-9])/i;

function pytestHolders(proofs: readonly StoryProofs[], file: string): { story: StoryProofs; path: string; tests: readonly PytestTest[] }[] {
  return proofs.flatMap((story) => [...story.pytest].filter(([path]) => path === file || path.endsWith(`/${file}`)).map(([path, tests]) => ({ story, path, tests })));
}

function namedSkip(proofs: readonly StoryProofs[], result: TestResult): TestResult {
  if (result.file === undefined || result.name !== "" || result.line === undefined) return result;
  const holders = pytestHolders(proofs, result.file);
  if (holders.length !== 1) return result;
  const at = result.line;
  const tests = holders[0]!.tests;
  const test = tests.find(({ from, line }) => from <= at && at <= line) ?? tests.findLast(({ line }) => line < at);
  return test === undefined ? result : { ...result, name: test.name };
}

type Missed = { readonly number: string; readonly reason: string; readonly among: readonly StoryProofs[] };

export type Uncredited = { test: string; number: string; reason: string; story?: string };

function pytestCredit(proofs: readonly StoryProofs[], result: TestResult): (Missed & { readonly story?: StoryProofs }) | undefined {
  const name = result.name.split("[", 1)[0]!;
  const holders = pytestHolders(proofs, result.file!).filter(({ tests }) => tests.some((test) => test.name === name));
  const numbered = NUMBERED_NAME.exec(name);
  if (numbered === null) return undefined;
  const [, prefix, major, minor] = numbered;
  const number = `${major}.${minor}`;
  if (holders.length !== 1) return { number, reason: holders.length === 0 ? "no story's folder holds its file" : "more than one story's folder holds its file", among: proofs };
  const named = prefix!.replace(/_$/, "").toLowerCase();
  const story = named === "" ? holders[0]!.story : proofs.find(({ packages }) => packages.some((one) => one.replaceAll("-", "_") === named));
  if (story === undefined) return { number, reason: `its name names package ${named}, which is no story's`, among: [] };
  return { story, number, reason: `its story ${story.story} has no contract ${number}`, among: named === "" ? proofs : [story] };
}

function provedFor(proofs: readonly StoryProofs[], result: TestResult): string[] {
  if (result.file === undefined) {
    const names = [...result.suites, result.name];
    return proofs.flatMap(({ proved }) => proved.filter(({ test }) => names.includes(test)).map(({ contract }) => contract));
  }
  const parts = [...result.suites, result.name.split("[", 1)[0]!];
  return proofs.flatMap((story) => {
    const paths = pytestHolders([story], result.file!).map(({ path }) => path);
    return story.proved
      .filter(({ test }) => {
        const [file, ...named] = test.split("::");
        return paths.some((path) => path === file || path.endsWith(`/${file}`)) && named.length <= parts.length && named.every((part, at) => parts[at] === part);
      })
      .map(({ contract }) => contract);
  });
}

function serves(need: string, platform: string | undefined): boolean {
  if (platform === undefined) return false;
  if (need === "posix") return platform === "linux" || platform === "darwin";
  return platform === ({ windows: "win32", macos: "darwin" } as Record<string, string>)[need] || platform === need;
}

function neededPlatform(result: TestResult): string | undefined {
  return result.status === "skipped" ? /^platform:([a-z0-9]+)/i.exec(result.message ?? "")?.[1]?.toLowerCase() : undefined;
}

function creditPlatformSkips(results: readonly TestResult[]): TestResult[] {
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

export function skipKind(reasons: readonly string[]): SkipKind {
  if (reasons.some((reason) => /^owner\b/i.test(reason))) return "owner";
  const platform = reasons.map((reason) => /^platform:([a-z0-9]+)/i.exec(reason)?.[1]).find(Boolean);
  return platform === undefined ? "other" : `platform:${platform.toLowerCase()}`;
}

export function judgeRun(proofs: readonly StoryProofs[], reported: readonly TestResult[]): { verdicts: Map<string, Verdict>; unmatched: TestResult[]; uncredited: Uncredited[] } {
  const results = creditPlatformSkips(reported.map((result) => namedSkip(proofs, result)));
  const byPackage = new Map(proofs.flatMap((story) => story.packages.map((name) => [name, story] as const)));
  const tests = new Map<string, TestResult[]>(proofs.flatMap((story) => [...story.contracts.values(), ...story.proved.map(({ contract }) => contract)].map((id) => [id, []] as [string, TestResult[]])));
  const unmatched: TestResult[] = [];
  const uncredited: Uncredited[] = [];
  const miss = (test: string, { number, reason, among }: Missed) => {
    if (uncredited.some((one) => one.test === test)) return;
    const having = among.filter(({ contracts }) => contracts.has(number));
    uncredited.push({ test, number, reason, ...(having.length === 1 ? { story: having[0]!.story } : {}) });
  };
  for (const result of results) {
    if (result.file !== undefined) {
      const credit = pytestCredit(proofs, result);
      const own = credit?.story?.contracts.get(credit.number);
      const ids = [...new Set([...(own === undefined ? [] : [own]), ...provedFor(proofs, result)])];
      if (ids.length === 0) unmatched.push(result);
      if (ids.length === 0 && credit !== undefined) miss([result.file, ...result.suites, result.name].join("::"), credit);
      for (const id of ids) tests.get(id)!.push(result);
      continue;
    }
    const name = countingName(result);
    const credited = new Map<string, { story: StoryProofs; numbers: readonly string[] }>();
    for (const story of name === undefined ? [] : proofs) {
      const held = story.titles.get(name!);
      if (held === undefined) continue;
      const target = held.package === undefined ? story : byPackage.get(held.package);
      if (target !== undefined) credited.set(target.story, { story: target, numbers: held.numbers });
    }
    for (const story of credited.size > 0 || name === undefined ? [] : proofs) {
      const numbers = [...new Set(story.helped.filter(({ number, title }) => name!.startsWith(`${number} `) && name!.endsWith(` ${title}`)).map(({ number }) => number))];
      if (numbers.length > 0) credited.set(story.story, { story, numbers });
    }
    const only = credited.size === 1 ? [...credited.values()][0]! : undefined;
    const ids = [...new Set([...(only === undefined ? [] : only.numbers.flatMap((number) => only.story.contracts.get(number) ?? [])), ...provedFor(proofs, result)])];
    if (ids.length === 0) unmatched.push(result);
    if (ids.length === 0 && name !== undefined) {
      const number = COUNTING_NAME.exec(name)![1]!;
      const reason = only !== undefined ? `its story ${only.story.story} has no contract ${number}` : credited.size === 0 ? "no story's tests hold its title" : "more than one story's tests hold its title";
      miss([...result.suites, result.name].join(" › "), { number, reason, among: proofs });
    }
    for (const id of ids) tests.get(id)!.push(result);
  }
  const verdicts = new Map<string, Verdict>();
  for (const [id, own] of tests) {
    verdicts.set(id, verdictOf(own));
  }
  return { verdicts, unmatched, uncredited };
}

export function verdictOf(own: readonly { readonly status: TestResult["status"]; readonly message?: string; readonly name?: string; readonly suites?: readonly string[] }[]): Verdict {
  const passed = own.filter(({ status }) => status === "passed").length;
  const failed = own.filter(({ status }) => status === "failed").length;
  const skipped = own.filter(({ status }) => status === "skipped").length;
  const counts = { passed, failed, skipped, total: own.length };
  const tally = `${passed}/${own.length} tests passed`;
  const named = own.flatMap(({ name, suites }) => (name === undefined ? [] : [[...(suites ?? []), name].join(" › ")]));
  const tests = named.length === 0 ? {} : { tests: named };
  if (failed > 0) {
    const first = own.find(({ status, message }) => status === "failed" && message?.trim())?.message?.trim().split("\n")[0]?.trim();
    return { state: "failing", ...counts, note: first === undefined ? tally : `${tally}; first failure: ${clipped(first)}`, ...tests };
  }
  if (own.length === 0) return { state: "not-checked", ...counts, note: "no test ran" };
  if (skipped > 0) {
    const reasons = [...new Set(own.flatMap(({ status, message }) => (status === "skipped" && message ? [message] : [])))];
    return { state: "not-checked", ...counts, skip: skipKind(reasons), note: `${skipped} of ${own.length} tests skipped${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}` };
  }
  return { state: "passing", ...counts, note: tally, ...tests };
}

const MESSAGE_LIMIT = 200;

function clipped(message: string): string {
  return message.length <= MESSAGE_LIMIT ? message : `${message.slice(0, MESSAGE_LIMIT - 1)}…`;
}

function calledTitles(text: string): Set<string> {
  return new Set([...text.matchAll(/[\w$.]\(\s*(["'`])((?:\\.|(?!\1)[^\\])+)\1/g)].map(([, , title]) => asRun(title!)));
}

function testFileOf(result: TestResult, tests: readonly { readonly path: string; readonly titles: Set<string> }[]): string | undefined {
  for (const name of [result.name, ...[...result.suites].reverse()]) {
    const holders = tests.filter(({ titles }) => titles.has(name));
    if (holders.length === 1) return holders[0]!.path;
  }
  return undefined;
}

export async function unclaimedVerdicts(tree: PlanTree, files: readonly SourceFile[], unmatched: readonly TestResult[]): Promise<Map<string, Verdict>> {
  const covering = tree.stories.flatMap(({ capabilities }) => capabilities.flatMap(({ id, covers }) => (covers ?? []).map((cover) => ({ id, cover }))));
  if (covering.length === 0 || unmatched.length === 0) return new Map();
  const tests = unmatched.some(({ file }) => file === undefined)
    ? files.filter(({ path }) => isTestFile(path) && !path.endsWith(".py")).map(({ path, text }) => ({ path, titles: calledTitles(text) }))
    : [];
  const byFile = new Map<string, TestResult[]>();
  for (const result of unmatched) {
    const file = result.file ?? testFileOf(result, tests);
    if (file !== undefined) byFile.set(file, [...(byFile.get(file) ?? []), result]);
  }
  if (byFile.size === 0) return new Map();
  await readersReady(byFile.keys());
  const paths = new Set(files.map(({ path }) => path));
  const reached = new Map<string, TestResult[]>();
  for (const [file, results] of byFile) {
    const source = files.find(({ path }) => path === file);
    const touched = [file, ...(source === undefined ? [] : dependenciesOf(source, paths, []))];
    const ids = new Set(covering.filter(({ cover }) => touched.some((path) => cover === "." || path === cover || path.startsWith(`${cover}/`))).map(({ id }) => id));
    for (const id of ids) reached.set(id, [...(reached.get(id) ?? []), ...results]);
  }
  return new Map([...reached].map(([id, results]) => [id, verdictOf(results)]));
}
