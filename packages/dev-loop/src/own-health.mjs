// The rules `pnpm check:own-health` (packages/dev-loop/src/check-own-health.mjs) runs: how a run of a story's
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
// Not checked is never written; the column's absence of an entry already reads not-checked.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Who writes the verified health: a run of the story's tests, seen by storytree for itself. */
export const VERIFIED_BY = "storytree test run";

/** The same, run by CI on each change to main (ADR-0744 D3), with its commit in each note. */
export const VERIFIED_BY_CI = "storytree test run on CI";

// --- a test run -------------------------------------------------------------------------------

/**
 * @typedef {{ name: string, suites: string[], file: string, status: "passed" | "failed" | "skipped", message?: string }} TestResult
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
 * path, transitively, within `root`: the leading contract list of each string. It is how the contracts a
 * crashed file would have tested are known when the file reported nothing. It may find more than
 * the file tests, never fewer, so a crash can only ever leave too much not checked.
 * @param {string} file
 * @param {{ root: string }} options
 * @returns {Set<string>}
 */
export function contractsCoveredBy(file, { root }) {
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
    for (const [, title] of text.matchAll(/["'`](\d+\.\d+[^"'`\r\n]*)/g)) {
      for (const number of leadingContracts(title)) numbers.add(number);
    }
    for (const [, specifier] of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = moduleFile(path.resolve(path.dirname(current), specifier));
      if (target !== undefined && !path.relative(root, target).startsWith("..")) queue.push(target);
    }
  }
  return numbers;
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
 * @typedef {{ number: string, state: "passing" | "failing" | "not-checked", passed: number, failed: number, skipped: number, total: number, note?: string, reason?: string }} Verdict
 */

/**
 * Judge each of `contracts` (their numbers) from a test run's results. A test counts for the
 * contracts its outermost numbered name gives ("8.1 …" around "2.1 [cloud-sql] …" is 8.1's).
 * `coverage(file)` gives the contract numbers a test file holds, for a file that produced no
 * results. Returns each contract's verdict, the results that name no contract of the story, and
 * the files that produced no results with the contracts they leave not checked.
 * @param {{ contracts: string[], results: TestResult[], coverage: (file: string) => Set<string>, show?: (file: string) => string }} input
 */
export function judge({ contracts, results, coverage, show = (file) => file }) {
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
    const numbers = contractsOfResult(result).filter((number) => known.has(number));
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
    const tally = `${counts.passed}/${counts.total} tests passed`;
    const skipReasons = [...new Set(own.filter(({ status }) => status === "skipped").map(({ message }) => message).filter(Boolean))];
    /** @type {Verdict} */
    let verdict;
    if (counts.failed > 0) verdict = { number, state: "failing", ...counts, note: tally };
    else if (crashedUnder.has(number)) {
      verdict = { number, state: "not-checked", ...counts, reason: `${show(crashedUnder.get(number))} produced no results (its process died before running any test)` };
    } else if (counts.total === 0) verdict = { number, state: "not-checked", ...counts, reason: "no tests" };
    else if (counts.skipped > 0) {
      const why = skipReasons.length > 0 ? ` (${skipReasons.join("; ")})` : "";
      verdict = { number, state: "not-checked", ...counts, reason: `${counts.skipped} of ${counts.total} tests skipped${why}` };
    } else verdict = { number, state: "passing", ...counts, note: tally };
    verdicts.set(number, verdict);
  }
  return { verdicts, unmapped, crashedFiles };
}

/** The result Node reports for a test file itself, named after the file, as it does for one that died. */
function isFileResult(result) {
  const name = result.name.replaceAll("\\", "/").toLowerCase();
  const file = result.file.replaceAll("\\", "/").toLowerCase();
  return result.suites.length === 0 && /\.test\.[cm]?[jt]sx?$/.test(name) && file.endsWith(name);
}

/** The contracts a test counts for: the list its outermost numbered name starts with. */
function contractsOfResult(result) {
  for (const name of [...result.suites, result.name]) {
    const numbers = leadingContracts(name);
    if (numbers.length > 0) return numbers;
  }
  return [];
}

/**
 * Only a leading list names contracts: N.M entries joined by comma, slash or "and", with
 * ascending en-dash ranges within one capability. Whitespace or the title's end must follow
 * the last entry. Once prose starts, later numbers give no credit. Overlaps count only once.
 */
function leadingContracts(title) {
  const prefix = /^(\d+\.\d+(?:–\d+\.\d+)?(?:(?:\s*[,/]\s*|\s+and\s+)\d+\.\d+(?:–\d+\.\d+)?)*)(?=\s|$)/.exec(title)?.[1];
  if (prefix === undefined) return [];
  const numbers = new Set();
  for (const [, first, last] of prefix.matchAll(/(\d+\.\d+)(?:–(\d+\.\d+))?/g)) {
    numbers.add(first);
    if (last === undefined) continue;
    const [capability, start] = first.split(".");
    const [endCapability, end] = last.split(".");
    if (capability !== endCapability || Number(end) < Number(start)) return [];
    for (let n = Number(start) + 1; n <= Number(end); n++) numbers.add(`${capability}.${n}`);
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
 * The package whose tests prove a story: the one named after its title ("The agent link" ->
 * `agent-link`), but for the stories whose package was named otherwise. Its tests are in
 * packages/<name>/src, and a story with no such package has none yet.
 * @param {string} title
 */
export function packageOf(title) {
  const name = title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return PACKAGE_NAMED_OTHERWISE[name] ?? name;
}

/** Stories whose package is not named after their title. */
const PACKAGE_NAMED_OTHERWISE = { "command-line": "cli" };

// --- writing to the library -------------------------------------------------------------------

function optional(field, value) {
  return value === undefined || value === "" ? {} : { [field]: value };
}

/**
 * Write each verdict to its contract's VERIFIED column: passing or failing, by `writer` (a test
 * run), with its tally as the note, and the commit it ran on when the writer names one. A
 * not-checked verdict writes nothing. The reported column is never touched: that is what an agent
 * says, and no agent has spoken here.
 * @param {import("@storytree/library").Library} library
 * @param {Map<string, string>} contractIds contract number -> id
 * @param {Map<string, Verdict>} verdicts
 * @param {Writer} [writer]
 */
export async function recordHealth(library, contractIds, verdicts, writer = { by: VERIFIED_BY }) {
  const written = { passing: 0, failing: 0, notChecked: 0 };
  for (const [number, verdict] of verdicts) {
    if (verdict.state === "not-checked") {
      written.notChecked++;
      continue;
    }
    const id = contractIds.get(number);
    if (id === undefined) throw new Error(`there is no contract ${number} in the library to record its health on`);
    const note = writer.commit === undefined ? verdict.note : `${verdict.note}, at commit ${writer.commit}`;
    await library.recordVerified(id, verdict.state, { by: writer.by, ...optional("note", note) });
    written[verdict.state]++;
  }
  return written;
}


// --- where to record ------------------------------------------------------------------------

/** @typedef {{ by: string, commit?: string }} Writer */

/**
 * The repository variables that name CI's Google identity (infra/ci-health): the workload identity
 * provider it signs in through, the service account it acts as, and the Cloud SQL instance.
 */
export const CI_IDENTITY = ["HEALTH_WIF_PROVIDER", "HEALTH_SERVICE_ACCOUNT", "HEALTH_CLOUDSQL_INSTANCE"];

/**
 * Where a run records verified health, and as whom. On CI (GITHUB_ACTIONS), the Cloud SQL library
 * the CI identity names, signed in as its service account, by a test run on CI at GITHUB_SHA; and
 * when any of that identity's repository variables is unset, nowhere, saying which. Run by hand,
 * the library the storytree setting names: the Cloud SQL instance, or the desktop app's own
 * (`"app"`).
 * @param {{ env: Record<string, string | undefined>, setting: { location: "local" } | { location: "cloudsql", instance: string, user: string } }} input
 * @returns {{ record: false, why: string } | { record: true, library: "app" | { cloudSql: { instance: string, user: string } }, writer: Writer }}
 */
export function recordingTarget({ env, setting }) {
  if (env.GITHUB_ACTIONS === "true") {
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
      writer: { by: VERIFIED_BY_CI, ...optional("commit", env.GITHUB_SHA) },
    };
  }
  if (setting.location === "cloudsql") {
    return { record: true, library: { cloudSql: { instance: setting.instance, user: setting.user } }, writer: { by: VERIFIED_BY } };
  }
  return { record: true, library: "app", writer: { by: VERIFIED_BY } };
}
