// The rules `pnpm check:own-health` (scripts/check-own-health.mjs) runs: how a run of a story's
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
 * path, transitively, within `root`: each "N.M" at the start of a string. It is how the contracts a
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
    for (const [, number] of text.matchAll(/["'`](\d+\.\d+)(?=[\s"'`])/g)) numbers.add(number);
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
 * contract its outermost numbered name gives ("8.1 …" around "2.1 [cloud-sql] …" is 8.1's).
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
    const number = contractOf(result);
    if (number === undefined || !known.has(number)) unmapped.push(result);
    else tests.get(number).push(result);
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

/** The contract a test counts for: the number its outermost numbered name starts with. */
function contractOf(result) {
  for (const name of [...result.suites, result.name]) {
    const match = /^(\d+\.\d+)(?:\s|$)/.exec(name);
    if (match !== null) return match[1];
  }
  return undefined;
}

function byNumber(a, b) {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || a2 - b2;
}

// --- the story, from the library ------------------------------------------------------------

/** Not built yet. */
export function contractsOf(_story) {
  throw new Error("contractsOf is not built yet");
}

/** Not built yet. */
export function packageOf(_title) {
  throw new Error("packageOf is not built yet");
}

// --- writing to the library -------------------------------------------------------------------

function optional(field, value) {
  return value === undefined || value === "" ? {} : { [field]: value };
}

/**
 * Write each verdict to its contract's VERIFIED column: passing or failing, by the test run, with
 * its tally as the note. A not-checked verdict writes nothing. The reported column is never
 * touched: that is what an agent says, and no agent has spoken here.
 * @param {import("@storytree/library").Library} library
 * @param {Map<string, string>} contractIds contract number -> id
 * @param {Map<string, Verdict>} verdicts
 */
export async function recordHealth(library, contractIds, verdicts) {
  const written = { passing: 0, failing: 0, notChecked: 0 };
  for (const [number, verdict] of verdicts) {
    if (verdict.state === "not-checked") {
      written.notChecked++;
      continue;
    }
    const id = contractIds.get(number);
    if (id === undefined) throw new Error(`there is no contract ${number} in the library to record its health on`);
    await library.recordVerified(id, verdict.state, { by: VERIFIED_BY, ...optional("note", verdict.note) });
    written[verdict.state]++;
  }
  return written;
}
