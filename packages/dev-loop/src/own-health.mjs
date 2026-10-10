// Capability 5 · Library tools. The rules `pnpm check:own-health` (packages/dev-loop/src/check-own-health.mjs) runs: how a run of a story's
// tests becomes each of its contracts' VERIFIED health in 0.3's own library (ADR-0641 D2 step 4,
// choice H1). The library is the one copy of 0.3's own stories, so a story's contracts and their
// numbers are read from it, and its tests are its own package's: the package named after the
// story's title (packageOf). Everything here but recordHealth, which writes through the library's
// public API, is pure.
//
// Honesty rules for the verified column: a contract passes only if it has tests and every one of
// them passed. Any failure fails it. A skipped test is not a pass, so a contract with one is not
// passing, and one whose tests were all skipped, or that has none, is not checked. A test file
// that produced no results (its process died before running any test) proves nothing either way:
// the contracts it holds are left not checked, never failed on the strength of a crash.
// Not checked is written only when a contract's tests were skipped or crashed (ADR-0825 D2): with
// the kind of the skip, and any earlier verdict the run did not reproduce, marked "not re-run". Otherwise the column's absence of
// an entry already reads not-checked.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Who writes the verified health: a run of the story's tests, seen by storytree for itself. */
export const VERIFIED_BY = "storytree test run";

/** The same, run by CI on each change to main (ADR-0744 D3), with its commit in each note. */
export const VERIFIED_BY_CI = "storytree test run on CI";

// --- a test run -------------------------------------------------------------------------------

/**
 * @typedef {{ name: string, suites: string[], file: string, status: "passed" | "failed" | "skipped", message?: string, ciRun?: string, unrun?: true }} TestResult
 */

/**
 * Read the output of Node's junit reporter (`node --test --test-reporter=junit`): one result per
 * testcase, with the names of the suites it sits in (outermost first), its file, and whether it
 * passed, failed or was skipped (a todo counts as skipped). A test file whose process died before
 * reporting any test appears as a failed testcase named after the file.
 * @param {string} xml
 * @returns {TestResult[]}
 */
export function parseJunit(xml) {
  /** @type {TestResult[]} */
  const results = [];
  /** @type {string[]} */
  const suites = [];
  /** @type {TestResult | undefined} */
  let open;
  // A tag, with its attributes matched value by value: a value may hold a raw ">".
  const tags = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  for (const [, closing, tag, attributeText, selfClosing] of xml.matchAll(tags)) {
    const attributes = attributesOf(attributeText);
    if (tag === "testsuite") {
      if (closing) suites.pop();
      else if (!selfClosing) suites.push(attributes.name ?? "");
    } else if (tag === "testcase") {
      if (closing) {
        if (open !== undefined) results.push(open);
        open = undefined;
      } else {
        /** @type {TestResult} */
        const result = { name: attributes.name ?? "", suites: [...suites], file: attributes.file ?? "", status: "passed" };
        if (selfClosing) results.push(result);
        else open = result;
      }
    } else if (!closing && open !== undefined && (tag === "failure" || tag === "error")) {
      open.status = "failed";
      if (attributes.message !== undefined) open.message = attributes.message;
    } else if (!closing && open !== undefined && tag === "skipped" && open.status !== "failed") {
      open.status = "skipped";
      if (attributes.message !== undefined) open.message = attributes.message;
    }
  }
  return results;
}

/** The CI systems whose evidence credits a `platform:<os>` skip, by Node's platform name. */
export const CI_PLATFORMS = { win32: "Windows", darwin: "macOS" };

/** Read only the downloaded `platform` run/attempt for the exact recording commit; bad or absent evidence proves nothing. */
export function readCiEvidence(directory, { commit, run, platform }) {
  if (!directory || !commit || !run || !Object.hasOwn(CI_PLATFORMS, platform)) return undefined;
  try {
    const reports = readdirSync(directory).map((entry) => JSON.parse(readFileSync(path.join(directory, entry, "result.json"), "utf8")));
    if (reports.length === 0 || reports.some((report) => report.run !== run || !validEvidence(report, commit, platform))) return undefined;
    return { platform, commit, run, code: 0, results: reports.flatMap((report) => report.results) };
  } catch {
    return undefined;
  }
}

function validEvidence(evidence, commit, platform = evidence?.platform) {
  return /^[a-f0-9]{40}$/.test(commit ?? "") && evidence?.commit === commit && Object.hasOwn(CI_PLATFORMS, platform) && evidence.platform === platform && evidence.code === 0 &&
    /^https:\/\/[^/]+\/[^/]+\/[^/]+\/actions\/runs\/\d+\/attempts\/\d+$/.test(evidence.run ?? "") &&
    Array.isArray(evidence.results) && evidence.results.every((test) =>
      typeof test.name === "string" && Array.isArray(test.suites) && test.suites.every((suite) => typeof suite === "string") &&
      typeof test.file === "string" && test.file !== "" && !test.file.startsWith("/") && !/[\\:]/.test(test.file) && !test.file.split("/").includes("..") &&
      ["passed", "failed", "skipped"].includes(test.status));
}

/**
 * Replace only a local `platform:<os>` skip whose complete test identity passed in that system's matching run. A skip
 * whose file that run never ran (its scope, ADR-0649 D4, did not reach the package) is marked `unrun`: the run could not
 * re-run it, so it proves nothing either way.
 */
export function creditPlatforms(results, evidence, { root, commit }) {
  const key = (test, file = test.file) => JSON.stringify([file, test.suites, test.name]);
  const byPlatform = new Map();
  for (const run of evidence) {
    if (run === undefined || !validEvidence(run, commit)) continue;
    const byTest = new Map();
    for (const test of run.results) {
      const id = key(test);
      byTest.set(id, [...(byTest.get(id) ?? []), test]);
    }
    byPlatform.set(run.platform, { run: run.run, byTest, files: new Set(run.results.map((test) => test.file)) });
  }
  return results.map((test) => {
    const platform = test.status === "skipped" ? /^platform:([a-z0-9]+)(?:[-\s:]|$)/.exec(test.message ?? "")?.[1] : undefined;
    const proof = platform === undefined ? undefined : byPlatform.get(platform);
    if (proof === undefined) return test;
    const file = path.relative(root, path.resolve(root, test.file)).replaceAll("\\", "/");
    if (!proof.files.has(file)) return { ...test, unrun: true };
    const matches = proof.byTest.get(key(test, file));
    return matches?.length && matches.every((match) => match.status === "passed") ? { ...test, status: "passed", ciRun: `${CI_PLATFORMS[platform]}: ${proof.run}` } : test;
  });
}

/** Whether `skip` is a CI platform's whose evidence this run did not see, so it could not re-run that platform's tests. */
export function unseenPlatform(skip, platformsSeen) {
  const platform = /^platform:(.+)$/.exec(skip ?? "")?.[1];
  return platformsSeen !== undefined && platform !== undefined && Object.hasOwn(CI_PLATFORMS, platform) && !platformsSeen.has(platform);
}

/** A tag's attributes, decoded. */
function attributesOf(text) {
  /** @type {Record<string, string>} */
  const attributes = {};
  for (const [, name, value] of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attributes[name] = decode(value);
  return attributes;
}

/**
 * An attribute value's text. Node's reporter escapes a quote as `&quot;` and then escapes that
 * `&` again, so after the one XML decoding a quote still reads `&quot;`.
 */
function decode(value) {
  const entities = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  return value
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity) =>
      entity.startsWith("#x") ? String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      : entity.startsWith("#") ? String.fromCodePoint(Number(entity.slice(1)))
      : entities[entity],
    )
    .replaceAll("&quot;", '"');
}

/**
 * The contract numbers a test file names, in itself and in every module it imports by a relative
 * path, transitively, within `root`: the leading contract list of each test title (`titlesIn`), or,
 * given a story's `prefix`, of each title that starts with it (a title like cli 1.3: …). It is how the contracts
 * a crashed file would have tested are known when the file reported nothing, and which of a
 * dependant's test files name a story's contracts. It may find more than the file tests, never
 * fewer, so a crash can only ever leave too much not checked.
 * @param {string} file
 * @param {{ root: string, prefix?: string }} options
 * @returns {Set<string>}
 */
export function contractsCoveredBy(file, { root, prefix }) {
  const numbers = new Set();
  const seen = new Set();
  const queue = [path.resolve(file)];
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    let text;
    try {
      text = readFileSync(current, "utf8");
    } catch {
      continue;
    }
    for (const title of titlesIn(text, prefix)) {
      for (const number of leadingContracts(title)) numbers.add(number);
    }
    for (const [, specifier] of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = moduleFile(path.resolve(path.dirname(current), specifier));
      if (target !== undefined && !path.relative(root, target).startsWith("..")) queue.push(target);
    }
  }
  return numbers;
}

/**
 * The test titles a source names: each string that is a call's first argument (`test("1.2 …")`,
 * or a helper's, `contract("2.1", …)`), and each constant's string passed as one (`test(TITLE)`,
 * or at the start of a template, `test(`${TITLE} (local)`)`). Given a story's `prefix`, only
 * the titles that start with it count, read from after it (a title cli 1.3: … reads as 1.3: …).
 * A comment or any other string is no title, so it covers nothing.
 * @param {string} text
 * @param {string} [prefix]
 */
function titlesIn(text, prefix) {
  const lead = prefix === undefined ? "" : `${prefix.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")}\\s+`;
  const titles = [...text.matchAll(new RegExp(`[\\w$.]\\s*\\(\\s*["'\`]${lead}(\\d+\\.\\d+[^"'\`\\r\\n]*)`, "g"))].map(([, title]) => title);
  for (const [, name] of text.matchAll(/[\w$.]\s*\(\s*(?:`\$\{\s*)?([A-Za-z_$][\w$]*)\s*[,)}]/g)) {
    const constant = text.match(new RegExp(`\\bconst\\s+${name.replaceAll("$", "\\$")}\\s*=\\s*["'\`]${lead}(\\d+\\.\\d+[^"'\`\\r\\n]*)`));
    if (constant !== null) titles.push(constant[1]);
  }
  return titles;
}

/**
 * The test files of the packages other than a story's own (`packages/<own>/src`) whose titles name
 * its contracts with its package's name first (a title like cli 1.3: …): a dependant's tests that prove the
 * story's contracts through the dependant's front door. Paths relative to `root`, with forward slashes.
 * @param {string} own the story's package
 * @param {{ root: string }} options
 * @returns {string[]}
 */
export function dependantTestsNaming(own, { root }) {
  const packages = path.join(root, "packages");
  let names;
  try {
    names = readdirSync(packages);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names.filter((name) => name !== own).sort()) {
    const source = path.join(packages, name, "src");
    let entries;
    try {
      entries = readdirSync(source, { recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries.map(String).filter((entry) => /\.test\.m?[jt]s$/.test(entry) && !entry.split(/[\\/]/).includes("node_modules")).sort()) {
      const file = path.join(source, entry);
      if (contractsCoveredBy(file, { root: source, prefix: own }).size > 0) files.push(path.relative(root, file).replaceAll("\\", "/"));
    }
  }
  return files;
}

/** The source file an import names: as written, or its TypeScript twin (`x.js` -> `x.ts`). */
function moduleFile(target) {
  const candidates = [target, target.replace(/\.js$/, ".ts"), target.replace(/\.mjs$/, ".mts"), `${target}.ts`];
  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * @typedef {{ number: string, state: "passing" | "failing" | "not-checked", passed: number, failed: number, skipped: number, total: number, note?: string, reason?: string, skip?: "owner" | "other" | `platform:${string}`, crashed?: true, unrun?: true }} Verdict
 */

/**
 * Judge each of `contracts` (their numbers) from a test run's results. A test counts for the
 * contracts its outermost numbered name gives ("8.1 …" around "2.1 [cloud-sql] …" is 8.1's), read
 * after the story's `prefix` when it starts with it (a title like cli 1.3: …). A test in a dependant's file
 * (`dependant(file)`) counts only through that prefix, and is otherwise none of the story's business.
 * `coverage(file)` gives the contract numbers a test file holds, for a file that produced no
 * results. Returns each contract's verdict, the results that name no contract of the story, and
 * the files that produced no results with the contracts they leave not checked.
 * @param {{ contracts: string[], results: TestResult[], coverage: (file: string) => Set<string>, show?: (file: string) => string, prefix?: string, dependant?: (file: string) => boolean }} input
 */
export function judge({ contracts, results, coverage, show = (file) => file, prefix, dependant = () => false }) {
  const known = new Set(contracts);
  /** @type {Map<string, TestResult[]>} */
  const tests = new Map(contracts.map((number) => [number, []]));
  /** @type {TestResult[]} */
  const unmapped = [];
  /** @type {{ file: string, contracts: string[] }[]} */
  const crashedFiles = [];
  /** @type {Map<string, string>} */
  const crashedUnder = new Map();

  for (const result of results) {
    if (isFileResult(result)) {
      if (result.status !== "failed") continue;
      const held = [...coverage(result.file)].filter((number) => known.has(number)).sort(byNumber);
      crashedFiles.push({ file: result.file, contracts: held });
      for (const number of held) if (!crashedUnder.has(number)) crashedUnder.set(number, result.file);
      continue;
    }
    const prefixedOnly = dependant(result.file);
    const numbers = contractsOfResult(result, prefix, prefixedOnly).filter((number) => known.has(number));
    if (numbers.length === 0 && prefixedOnly) continue;
    if (numbers.length === 0) unmapped.push(result);
    else for (const number of numbers) tests.get(number).push(result);
  }

  /** @type {Map<string, Verdict>} */
  const verdicts = new Map();
  for (const number of contracts) {
    const own = tests.get(number);
    const counts = {
      passed: own.filter(({ status }) => status === "passed").length,
      failed: own.filter(({ status }) => status === "failed").length,
      skipped: own.filter(({ status }) => status === "skipped").length,
      total: own.length,
    };
    const ciRuns = [...new Set(own.map((test) => test.ciRun).filter(Boolean))];
    const tally = `${counts.passed}/${counts.total} tests passed${ciRuns.map((run) => `; ${run}`).join("")}`;
    const skipReasons = [...new Set(own.filter(({ status }) => status === "skipped").map(({ message }) => message).filter(Boolean))];
    /** @type {Verdict} */
    let verdict;
    if (counts.failed > 0) verdict = { number, state: "failing", ...counts, note: tally };
    else if (crashedUnder.has(number)) {
      verdict = { number, state: "not-checked", ...counts, crashed: true, reason: `${show(crashedUnder.get(number))} produced no results (its process died before running any test)` };
    } else if (counts.total === 0) verdict = { number, state: "not-checked", ...counts, reason: "no tests" };
    else if (counts.skipped > 0) {
      const why = skipReasons.length > 0 ? ` (${skipReasons.join("; ")})` : "";
      const unrun = own.every(({ status, unrun }) => status !== "skipped" || unrun === true);
      verdict = { number, state: "not-checked", ...counts, skip: skipKind(skipReasons), reason: `${counts.skipped} of ${counts.total} tests skipped${why}`, ...(unrun ? { unrun } : {}) };
    } else verdict = { number, state: "passing", ...counts, note: tally };
    verdicts.set(number, verdict);
  }
  return { verdicts, unmapped, crashedFiles };
}

/**
 * The kind of a contract's skip (ADR-0825 D2), from its skip reasons' first word: `owner` when any
 * says `owner:` (only the owner can give what it needs), else `platform:<os>` when one names the
 * platform it runs on, else `other`.
 * @param {string[]} reasons
 * @returns {"owner" | "other" | `platform:${string}`}
 */
function skipKind(reasons) {
  if (reasons.some((reason) => /^owner\b/i.test(reason))) return "owner";
  const platform = reasons.map((reason) => /^platform:([a-z0-9]+)/i.exec(reason)?.[1]).find(Boolean);
  return platform === undefined ? "other" : `platform:${platform.toLowerCase()}`;
}

/** The result Node reports for a test file itself, named after the file, as it does for one that died. */
function isFileResult(result) {
  const name = result.name.replaceAll("\\", "/").toLowerCase();
  const file = result.file.replaceAll("\\", "/").toLowerCase();
  return result.suites.length === 0 && /\.test\.[cm]?[jt]sx?$/.test(name) && file.endsWith(name);
}

/**
 * The contracts a test counts for: the list its outermost numbered name starts with, after the
 * story's `prefix` if the name starts with that; with `prefixedOnly`, only a name with the prefix.
 */
function contractsOfResult(result, prefix, prefixedOnly) {
  for (const name of [...result.suites, result.name]) {
    const after = prefix === undefined || !name.startsWith(prefix) ? undefined : /^\s+(.*)$/s.exec(name.slice(prefix.length))?.[1];
    const numbers = leadingContracts(after ?? (prefixedOnly ? "" : name));
    if (numbers.length > 0) return numbers;
  }
  return [];
}

/**
 * Only a leading list names contracts: N.M entries joined by comma, slash or "and", with
 * ascending en-dash ranges within one capability. Whitespace or the title's end must follow
 * the last entry, or a colon and then one ("3.6: …"). Once prose starts, later numbers give no
 * credit. Overlaps count only once. A list wider than LEADING_LIST_LIMIT numbers, counting
 * overlaps, or with an end past a safe integer is no real list (a fixture's "3.1–3.9007199254740991"),
 * so it credits nothing, checked before any expanding.
 */
// As map's survey bounds a title's proofs (8.10): the widest real range spans a handful.
const LEADING_LIST_LIMIT = 256;

function leadingContracts(title) {
  const prefix = /^(\d+\.\d+(?:–\d+\.\d+)?(?:(?:\s*[,/]\s*|\s+and\s+)\d+\.\d+(?:–\d+\.\d+)?)*):?(?=\s|$)/.exec(title)?.[1];
  if (prefix === undefined) return [];
  const ranges = [];
  let width = 0;
  for (const [, first, last] of prefix.matchAll(/(\d+\.\d+)(?:–(\d+\.\d+))?/g)) {
    const [capability, start] = first.split(".").map(Number);
    const [endCapability, end] = (last ?? first).split(".").map(Number);
    if (capability !== endCapability || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return [];
    width += end - start + 1;
    if (width > LEADING_LIST_LIMIT) return [];
    ranges.push({ first, capability, start, end });
  }
  const numbers = new Set();
  for (const { first, capability, start, end } of ranges) {
    numbers.add(first);
    for (let n = start + 1; n <= end; n++) numbers.add(`${capability}.${n}`);
  }
  return [...numbers];
}

function byNumber(a, b) {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || a2 - b2;
}

// --- the story, from the library ------------------------------------------------------------

/**
 * A story's contracts as the library holds them: their numbers, in the tree's order, and each
 * number's contract id. A contract's number is the one its title starts with (`1.4 · …`).
 * @param {import("@storytree/library").AnnotatedStory} story a story of `projectTree()`
 * @returns {{ numbers: string[], contractIds: Map<string, string> }}
 */
export function contractsOf(story) {
  const contractIds = new Map();
  for (const capability of story.capabilities) {
    for (const contract of capability.contracts) {
      const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
      if (number !== undefined) contractIds.set(number, contract.id);
    }
  }
  return { numbers: [...contractIds.keys()], contractIds };
}

/**
 * The package whose tests prove a story: the one named after its title ("Session management" ->
 * `session-management`), but for the stories whose package was named otherwise. Its tests are in
 * packages/<name>/src, and a story with no such package has none yet.
 * @param {string} title
 */
export function packageOf(title) {
  const name = title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return PACKAGE_NAMED_OTHERWISE[name] ?? name;
}

/**
 * The repo-relative folders holding a story's own tests, by its package: packages/<name>/src, and
 * for the app story also the desktop app's, the other half of its frame (ADR-0649).
 * @param {string} name
 */
export function sourcesOf(name) {
  return name === "app" ? ["packages/app/src", "apps/desktop/src"] : [`packages/${name}/src`];
}

/** Stories whose package is not named after their title. */
const PACKAGE_NAMED_OTHERWISE = {
  "command-line": "cli",
  world: "forest-world",
  "local-database": "local-postgres",
  "process-ledger": "processes",
};

// --- writing to the library -------------------------------------------------------------------

function optional(field, value) {
  return value === undefined || value === "" ? {} : { [field]: value };
}

/**
 * Write each verdict to its contract's VERIFIED column: passing or failing, by `writer` (a test
 * run), with its tally as the note, and the commit it ran on when the writer names one. A
 * not-checked verdict is written only when its tests were skipped or crashed (ADR-0825 D2): with
 * the kind of its skip, and any earlier passing or failing it did not reproduce, which it carries as
 * "not re-run at <commit>" (history keeps the old verdict). With no tests there is nothing to re-run,
 * and a verdict from elsewhere stands. One whose column already says the same is not written
 * again, so its note keeps the commit it was first not re-run at. A run that saw no CI evidence for
 * a platform (one missing from `platformsSeen`) cannot re-run a test that only runs there either,
 * so a passing verdict from elsewhere stands against its `platform:<os>` skip; so does one whose skipped tests that
 * platform's run never reached (`unrun`, its scope left their package out). The reported
 * column is never touched: that is what an agent says, and no agent has spoken here.
 * @param {import("@storytree/library").Library} library
 * @param {Map<string, string>} contractIds contract number -> id
 * @param {Map<string, Verdict>} verdicts
 * @param {Writer} [writer]
 * @param {{ platformsSeen?: Set<string> }} [options] the platforms whose CI evidence the run read; all, when absent
 */
export async function recordHealth(library, contractIds, verdicts, writer = { by: VERIFIED_BY }, { platformsSeen } = {}) {
  const written = { passing: 0, failing: 0, notChecked: 0, marked: 0 };
  for (const [number, verdict] of verdicts) {
    const id = contractIds.get(number);
    if (verdict.state === "not-checked") {
      written.notChecked++;
      if (id !== undefined && (await markNotChecked(library, id, verdict, writer, platformsSeen))) written.marked++;
      continue;
    }
    if (id === undefined) throw new Error(`there is no contract ${number} in the library to record its health on`);
    const note = writer.commit === undefined ? verdict.note : `${verdict.note}, at commit ${writer.commit}`;
    await library.recordVerified(id, verdict.state, { by: writer.by, ...optional("note", note) });
    written[verdict.state]++;
  }
  return written;
}


/**
 * Before a run of `story`'s tests, mark pending each of its contracts the run can newly record: one a numbered test
 * at this checkout names (its own package's, or a dependant's titled with its package, as checkStory runs them) whose
 * verified column is failing or not checked without a skip. The health worklist then holds back a capability those
 * carry until the run records them (friction_87a4d32684e3). A passing or skipped one is left as it is: the run would
 * only say so again. The numbers marked, in the story's order.
 * @param {import("@storytree/library").Library} library
 * @param {import("@storytree/library").AnnotatedStory} story a story of `projectTree()`
 * @param {Writer} writer
 * @param {{ root: string }} options
 * @returns {Promise<string[]>}
 */
export async function markPending(library, story, writer, { root }) {
  const name = packageOf(story.title);
  const named = new Set();
  for (const dir of sourcesOf(name)) {
    const source = path.join(root, dir);
    let entries;
    try {
      entries = readdirSync(source, { recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries.map(String).filter((entry) => /\.test\.m?[jt]s$/.test(entry) && !entry.split(/[\\/]/).includes("node_modules"))) {
      for (const number of contractsCoveredBy(path.join(source, entry), { root: source })) named.add(number);
    }
  }
  for (const file of dependantTestsNaming(name, { root })) {
    for (const number of contractsCoveredBy(path.join(root, file), { root: path.join(root, "packages"), prefix: name })) named.add(number);
  }
  const marked = [];
  const note = `a test run${writer.commit === undefined ? "" : ` at commit ${writer.commit}`} is recording it`;
  for (const capability of story.capabilities) {
    for (const contract of capability.contracts) {
      const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
      const { state, skip } = contract.health.verified;
      if (number === undefined || !named.has(number) || state === "passing" || (state === "not-checked" && skip !== undefined)) continue;
      await library.markVerifiedPending(contract.id, { by: writer.by, note });
      marked.push(number);
    }
  }
  return marked;
}

/**
 * Mark contract `id` not checked when its tests were skipped or crashed: with its skip's kind, and
 * the earlier verdict it did not reproduce (carried over from a mark already standing). True if it
 * wrote.
 */
async function markNotChecked(library, id, verdict, writer, platformsSeen) {
  // Only a run that had tests for it, skipped or crashed, failed to reproduce a verdict: with none,
  // a verdict from elsewhere (an acceptance run, ADR-0825 D5) stands.
  if (verdict.skip === undefined && verdict.crashed !== true) return false;
  const earlier = (await library.health(id)).verified;
  if ((verdict.unrun === true || unseenPlatform(verdict.skip, platformsSeen)) && earlier.state === "passing") return false;
  const was = earlier.state === "not-checked" ? earlier.was : { state: earlier.state, at: earlier.at };
  const same = earlier.state === "not-checked" && earlier.skip === verdict.skip && earlier.was?.state === was?.state && earlier.was?.at === was?.at;
  if (same) return false;
  const at = writer.commit === undefined ? "" : ` at commit ${writer.commit}`;
  const note = was === undefined ? `${verdict.reason}${at === "" ? "" : `,${at}`}` : `not re-run${at}: ${verdict.reason}`;
  await library.recordVerified(id, "not-checked", { by: writer.by, note, ...optional("skip", verdict.skip), ...(was === undefined ? {} : { was }) });
  return true;
}

// --- where to record ------------------------------------------------------------------------

/** @typedef {{ by: string, commit?: string }} Writer */

/**
 * The repository variables that name CI's Google identity (infra/ci-health): the workload identity
 * provider it signs in through, the service account it acts as, and the Cloud SQL instance.
 */
export const CI_IDENTITY = ["HEALTH_WIF_PROVIDER", "HEALTH_SERVICE_ACCOUNT", "HEALTH_CLOUDSQL_INSTANCE"];

/**
 * Where a run records verified health, and as whom. On CI (GITHUB_ACTIONS), by a test run on CI at
 * GITHUB_SHA: in the library at HEALTH_PG_ADDRESS when that is set (the Mint box over Tailscale,
 * ADR-0928 D4; its password is PGPASSWORD), and otherwise in the Cloud SQL library the CI identity
 * names, signed in as its service account; when any of that identity's repository variables is
 * unset, nowhere, saying which. Run by hand, the library the storytree setting names: the Cloud SQL
 * instance, a Postgres address, or the desktop app's own (`"app"`).
 * @param {{ env: Record<string, string | undefined>, setting: { location: "local" } | { location: "cloudsql", instance: string, user: string } | { location: "postgres", address: string } }} input
 * @returns {{ record: false, why: string } | { record: true, library: "app" | { cloudSql: { instance: string, user: string } } | { address: string }, writer: Writer }}
 */
export function recordingTarget({ env, setting }) {
  if (env.GITHUB_ACTIONS === "true") {
    const writer = { by: VERIFIED_BY_CI, ...optional("commit", env.GITHUB_SHA) };
    if ((env.HEALTH_PG_ADDRESS ?? "") !== "") return { record: true, library: { address: env.HEALTH_PG_ADDRESS }, writer };
    const unset = CI_IDENTITY.filter((name) => (env[name] ?? "") === "");
    if (unset.length > 0) {
      return {
        record: false,
        why:
          `CI has no Google identity to record health with: the repository variable${unset.length === 1 ? "" : "s"} ` +
          `${unset.join(", ")} ${unset.length === 1 ? "is" : "are"} unset (infra/ci-health/README.md says how to set them). Nothing was recorded.`,
      };
    }
    // Cloud SQL names a service account's database user by its email without .gserviceaccount.com.
    const user = env.HEALTH_SERVICE_ACCOUNT.replace(/\.gserviceaccount\.com$/, "");
    return {
      record: true,
      library: { cloudSql: { instance: env.HEALTH_CLOUDSQL_INSTANCE, user } },
      writer,
    };
  }
  if (setting.location === "postgres") return { record: true, library: { address: setting.address }, writer: { by: VERIFIED_BY } };
  if (setting.location === "cloudsql") {
    return { record: true, library: { cloudSql: { instance: setting.instance, user: setting.user } }, writer: { by: VERIFIED_BY } };
  }
  return { record: true, library: "app", writer: { by: VERIFIED_BY } };
}
