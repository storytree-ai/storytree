// Capability 5 · Library tools. The rules `pnpm record:acceptance` (packages/dev-loop/src/record-acceptance.mjs) runs: how an acceptance
// run becomes each contract's VERIFIED health (ADR-0825 D5). A model drives the product as a user
// would; its harness then checks what happened for itself (an exit code, a file, a record in the
// library, a picture) and writes each check down as observed passing, failing or not observed. The
// verdict is minted here from those checks alone: the model's account of what it did is never an
// input, and there is no model-as-judge.
//
// The honesty rules are own-health's (ADR-0744): a contract passes only if the harness ran checks
// for it and every one passed. Any failure fails it. A check not observed is not a pass, so a
// contract with one is not checked, and so is a contract with no checks. Not checked is never written.

import { recordHealth } from "./own-health.mjs";

/** Who writes the verified health: an acceptance run's harness, from what it observed. */
export const ACCEPTED_BY = "acceptance run";

/** What the harness may have seen of one check. */
const OBSERVED = ["pass", "fail", "not-observed"];

/**
 * @typedef {{ contract: string, name: string, observed: "pass" | "fail" | "not-observed", detail?: string }} Check
 * @typedef {{ story: string, commit: string, evidence: string, note?: string, checks: Check[] }} Observations
 */

/**
 * Read an acceptance run's observations file: the story it accepts, the commit the product was
 * built from, the evidence path, and each check the harness observed. Anything the harness could not
 * have minted is refused, naming what is wrong: a check observed as something other than pass, fail
 * or not-observed, or a run with no commit or evidence path to write beside its verdicts.
 * @param {string} text
 * @returns {Observations}
 */
export function readObservations(text) {
  const run = JSON.parse(text);
  for (const field of ["story", "commit", "evidence"]) {
    if (typeof run[field] !== "string" || run[field].trim() === "") throw new Error(`the observations have no ${field}: an acceptance verdict is written with its story, commit and evidence path`);
  }
  if (!Array.isArray(run.checks)) throw new Error("the observations have no checks");
  for (const check of run.checks) {
    if (typeof check.contract !== "string" || typeof check.name !== "string") throw new Error(`a check has no contract number or name: ${JSON.stringify(check)}`);
    if (!OBSERVED.includes(check.observed)) {
      throw new Error(`check "${check.name}" (${check.contract}) is observed as ${JSON.stringify(check.observed)}; a harness observes pass, fail or not-observed`);
    }
  }
  return run;
}

/**
 * Mint each of `contracts` (their numbers) a verdict from the checks the harness observed. A check
 * for a contract not in the list counts for none.
 * @param {{ contracts: string[], checks: Check[] }} input
 * @returns {Map<string, import("./own-health.mjs").Verdict>}
 */
export function mintAcceptance({ contracts, checks }) {
  /** @type {Map<string, import("./own-health.mjs").Verdict>} */
  const verdicts = new Map();
  for (const number of contracts) {
    const own = checks.filter((check) => check.contract === number);
    const counts = {
      passed: own.filter(({ observed }) => observed === "pass").length,
      failed: own.filter(({ observed }) => observed === "fail").length,
      skipped: own.filter(({ observed }) => observed === "not-observed").length,
      total: own.length,
    };
    const tally = `${counts.passed}/${counts.total} checks passed`;
    if (counts.failed > 0) verdicts.set(number, { number, state: "failing", ...counts, note: tally });
    else if (counts.total === 0) verdicts.set(number, { number, state: "not-checked", ...counts, reason: "no checks" });
    else if (counts.skipped > 0) {
      const unseen = own.filter(({ observed }) => observed === "not-observed").map(({ name }) => name);
      verdicts.set(number, { number, state: "not-checked", ...counts, reason: `${counts.skipped} of ${counts.total} checks not observed (${unseen.join("; ")})` });
    } else verdicts.set(number, { number, state: "passing", ...counts, note: tally });
  }
  return verdicts;
}

/**
 * Write each passing or failing verdict to its contract's verified column by "acceptance run", with
 * its tally, the run's own note (such as which copy of the product it drove), the evidence path and
 * the commit in the note. Not checked writes nothing, and the reported column is never touched.
 * @param {import("@storytree/library").Library} library
 * @param {Map<string, string>} contractIds contract number -> id
 * @param {Map<string, import("./own-health.mjs").Verdict>} verdicts
 * @param {{ commit: string, evidence: string, note?: string }} run
 */
export function recordAcceptance(library, contractIds, verdicts, { commit, evidence, note }) {
  const said = note === undefined || note.trim() === "" ? "" : `, ${note.trim()}`;
  const withEvidence = new Map(
    [...verdicts].map(([number, verdict]) => [number, verdict.note === undefined ? verdict : { ...verdict, note: `${verdict.note}${said}, evidence ${evidence}` }]),
  );
  return recordHealth(library, contractIds, withEvidence, { by: ACCEPTED_BY, commit });
}

/**
 * The states a contract's reported health was written with, oldest first, read from what
 * `storytree library history health_<contract>_reported --fields` printed: every write, so a red and a
 * green between two readings of the tree are both there. A retirement repeats the last state. No
 * history ("No history for …") is no states; no text, or a history printed without its fields, is
 * undefined: not read, never read as never red.
 * @param {string | undefined} text
 * @returns {string[] | undefined}
 */
export function reportedStates(text) {
  if (text === undefined) return undefined;
  if (/^No history for /m.test(text)) return [];
  const writes = [];
  let seq;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const entry = /^\s+(\d+)\s+\S+\s+(?:created|updated|retired)\b/.exec(line);
    if (entry) {
      if (seq !== undefined) return undefined;
      seq = Number(entry[1]);
      continue;
    }
    const fields = /^\s+fields: (\{.*\})\s*$/.exec(line);
    if (fields && seq !== undefined) {
      writes.push({ seq, state: JSON.parse(fields[1]).state });
      seq = undefined;
    }
  }
  if (seq !== undefined || writes.length === 0) return undefined;
  return writes.sort((a, b) => a.seq - b.seq).map(({ state }) => state);
}

/**
 * Whether reported states went failing, then passing later.
 * @param {string[] | undefined} states
 */
export function wentRedThenGreen(states) {
  const red = states?.indexOf("failing") ?? -1;
  return red >= 0 && states.slice(red).includes("passing");
}
