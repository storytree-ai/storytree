/**
 * Capability 2 · Contract verdicts (ADR-0902 D3): each test result tied to its story and contract, and
 * each contract judged.
 *
 * Users' contract numbers repeat across stories (every story has a 1.1) and TAP names no file, so a
 * result is tied to its story by its title: it counts for the story whose package holds a test with
 * exactly that title at the commit the run tested (the package the map draws the story's code from,
 * read with the map's own survey). A title held by two stories' tests, or by none, credits nothing.
 * A result counts through its outermost numbered name, so a subtest counts for its parent's contract.
 *
 * Judging follows storytree's own health (ADR-0744, packages/dev-loop/src/own-health.mjs): a contract
 * passes only if it has tests and every one passed; any failure fails it; a skipped test is no pass,
 * so a skip leaves it not checked, as does having no tests.
 */
import { packageOf, surveyStory, type SourceFile } from "@storytree/map";
import type { TestResult } from "../run-results/run-results.js";

/** The plan as judging needs it: stories, their numbered capabilities and contracts ("1.2 · …"). */
export type PlanTree = {
  readonly stories: readonly { readonly id: string; readonly title: string; readonly capabilities: readonly { readonly id: string; readonly title: string; readonly contracts: readonly { readonly id: string; readonly title: string }[] }[] }[];
};

/** A story's proofs at one commit: its contracts by number, and each numbered test title its package holds. */
export type StoryProofs = {
  readonly story: string;
  readonly package: string;
  readonly contracts: ReadonlyMap<string, string>;
  /** Title -> the contract numbers it names, and the package a prefixed title names (`cart 1.2 …`). */
  readonly titles: ReadonlyMap<string, { readonly numbers: readonly string[]; readonly package?: string }>;
};

export type Verdict = { state: "passing" | "failing" | "not-checked"; passed: number; failed: number; skipped: number; total: number; note: string };

/**
 * Each story's proofs, from the files at the run's commit (repository paths): its package's tests wherever they sit in
 * it, under `src/` or in a test folder beside it (`packages/<package>/test/…`), as users' projects lay them out.
 */
export function proofsAt(tree: PlanTree, files: readonly SourceFile[]): StoryProofs[] {
  return tree.stories.map((story) => {
    const own = packageOf(story.title);
    const sources = files.filter((file) => file.path.startsWith(`packages/${own}/`));
    const titles = new Map<string, { numbers: string[]; package?: string }>();
    if (sources.length > 0) {
      for (const test of surveyStory(sources, story.capabilities, {}, own).tests ?? []) {
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
    return { story: story.id, package: own, contracts, titles };
  });
}

/** A title as the test runner prints it: the survey keeps its source text, escapes and all (`admin\\'s`). */
function asRun(title: string): string {
  return title.replace(/\\(["'`\\])/g, "$1");
}

/** The name a result counts through: its outermost name that starts with a contract number. */
function countingName(result: TestResult): string | undefined {
  return [...result.suites, result.name].find((name) => /^(?:[a-z][a-z0-9-]*\s+)?\d+\.\d+/.test(name));
}

/** Each contract's verdict from a run's results, and the results that credit no contract. */
export function judgeRun(proofs: readonly StoryProofs[], results: readonly TestResult[]): { verdicts: Map<string, Verdict>; unmatched: TestResult[] } {
  const byPackage = new Map(proofs.map((story) => [story.package, story]));
  const tests = new Map<string, TestResult[]>(proofs.flatMap((story) => [...story.contracts.values()].map((id) => [id, []] as [string, TestResult[]])));
  const unmatched: TestResult[] = [];
  for (const result of results) {
    const name = countingName(result);
    // Every story credited by a test holding this exact title: the holder, or the package a prefix names.
    const credited = new Map<string, { story: StoryProofs; numbers: readonly string[] }>();
    for (const story of name === undefined ? [] : proofs) {
      const held = story.titles.get(name!);
      if (held === undefined) continue;
      const target = held.package === undefined ? story : byPackage.get(held.package);
      if (target !== undefined) credited.set(target.story, { story: target, numbers: held.numbers });
    }
    const only = credited.size === 1 ? [...credited.values()][0]! : undefined;
    const ids = only === undefined ? [] : only.numbers.flatMap((number) => only.story.contracts.get(number) ?? []);
    if (ids.length === 0) unmatched.push(result);
    for (const id of ids) tests.get(id)!.push(result);
  }
  const verdicts = new Map<string, Verdict>();
  for (const [id, own] of tests) {
    const passed = own.filter(({ status }) => status === "passed").length;
    const failed = own.filter(({ status }) => status === "failed").length;
    const skipped = own.filter(({ status }) => status === "skipped").length;
    const counts = { passed, failed, skipped, total: own.length };
    const tally = `${passed}/${own.length} tests passed`;
    if (failed > 0) verdicts.set(id, { state: "failing", ...counts, note: tally });
    else if (own.length === 0) verdicts.set(id, { state: "not-checked", ...counts, note: "no test ran" });
    else if (skipped > 0) {
      const reasons = [...new Set(own.flatMap(({ status, message }) => (status === "skipped" && message ? [message] : [])))];
      verdicts.set(id, { state: "not-checked", ...counts, note: `${skipped} of ${own.length} tests skipped${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}` });
    } else verdicts.set(id, { state: "passing", ...counts, note: tally });
  }
  return { verdicts, unmatched };
}
