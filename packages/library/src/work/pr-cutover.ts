/**
 * Capability 4 · Work model: which repository a pull request number belongs to (increment_7f7599b35fe4). A project
 * that moves to a fresh repository under its old name restarts its pull request numbers at #1, so a number the library
 * recorded before the move names a pull request of the repository that gave up the name. The cut-over record says
 * when that happened and where those numbers live now; nothing recorded before it is rewritten.
 */
import type { FieldsOf } from "../schema/types.js";

/** The repository cut-over: when, the repository that holds the name from then, and the one that held numbers before. */
export type PrCutover = FieldsOf<"prCutover">;

/** The id the project's one cut-over is kept at. */
export const PR_CUTOVER_ID = "pr-cutover";

/** The repository that held the numbers before, when the cut-over does not say: the old one renamed `<name>-history`. */
export const historyOf = (repository: string): string => `${repository}-history`;

/** A pull request as an outcome may write it: "13", "#13", "owner/name#13" or its address. */
function pullOf(pr: string): { number: number; repository?: string } | undefined {
  const named = /^(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/|([\w.-]+\/[\w.-]+)#|#)?([1-9]\d*)\/?$/.exec(pr.trim());
  if (named === null) return undefined;
  const repository = named[1] ?? named[2];
  return { number: Number(named[3]), ...(repository === undefined ? {} : { repository }) };
}

/**
 * Whether a record written at `when` predates the cut-over. `when` is a time, or a day (YYYY-MM-DD) as a closure's
 * date is written: a day earlier than the cut-over's UTC day is before it, and the cut-over's own day is after it,
 * since the flip runs with the pool paused, so a closure on that day is recorded after it.
 */
export function beforeCutover(cutover: PrCutover | undefined, when: string): boolean {
  if (cutover === undefined) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return when < cutover.at.slice(0, 10);
  return Date.parse(when) < Date.parse(cutover.at);
}

/**
 * The repository pull request `pr`, recorded at `when`, belongs to: the one it names, unless that is the name the
 * cut-over moved; otherwise `current` (or the cut-over's repository) from the cut-over on, and before it the
 * cut-over's `before`, null when that repository was deleted. Undefined when `pr` is no pull request.
 */
export function pullRepository(cutover: PrCutover | undefined, pr: string, when: string, current: string): string | null | undefined {
  const pull = pullOf(pr);
  if (pull === undefined) return undefined;
  const repository = cutover?.repository ?? current;
  if (pull.repository !== undefined && pull.repository !== repository) return pull.repository;
  return beforeCutover(cutover, when) ? cutover!.before : repository;
}

/**
 * Pull request `pr` as a line says it: "#n" when it is the project's repository's, "owner/name#n" when it is another's
 * (the old repository's, before the cut-over), and "#n, in a deleted repository" when that one is gone. Text that is
 * no pull request is said as written.
 */
export function pullSaid(cutover: PrCutover | undefined, pr: string, when: string): string {
  const pull = pullOf(pr);
  if (pull === undefined) return pr;
  const home = cutover?.repository ?? pull.repository ?? "";
  const repository = pullRepository(cutover, pr, when, home);
  if (repository === null) return `#${pull.number}, in a deleted repository`;
  return repository === home ? `#${pull.number}` : `${repository}#${pull.number}`;
}
