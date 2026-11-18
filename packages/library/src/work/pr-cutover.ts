// Capability 4 · Work model
import type { FieldsOf } from "../schema/index.js";

export type PrCutover = FieldsOf<"prCutover">;

export const PR_CUTOVER_ID = "pr-cutover";

export const historyOf = (repository: string): string => `${repository}-history`;

function pullOf(pr: string): { number: number; repository?: string } | undefined {
  const named = /^(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/|([\w.-]+\/[\w.-]+)#|#)?([1-9]\d*)\/?$/.exec(pr.trim());
  if (named === null) return undefined;
  const repository = named[1] ?? named[2];
  return { number: Number(named[3]), ...(repository === undefined ? {} : { repository }) };
}

export function beforeCutover(cutover: PrCutover | undefined, when: string): boolean {
  if (cutover === undefined) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return when < cutover.at.slice(0, 10);
  return Date.parse(when) < Date.parse(cutover.at);
}

export function pullRepository(cutover: PrCutover | undefined, pr: string, when: string, current: string): string | null | undefined {
  const pull = pullOf(pr);
  if (pull === undefined) return undefined;
  const repository = cutover?.repository ?? current;
  if (pull.repository !== undefined && pull.repository !== repository) return pull.repository;
  return beforeCutover(cutover, when) ? cutover!.before : repository;
}

export function pullSaid(cutover: PrCutover | undefined, pr: string, when: string): string {
  const pull = pullOf(pr);
  if (pull === undefined) return pr;
  const home = cutover?.repository ?? pull.repository ?? "";
  const repository = pullRepository(cutover, pr, when, home);
  if (repository === null) return `#${pull.number}, in a deleted repository`;
  return repository === home ? `#${pull.number}` : `${repository}#${pull.number}`;
}
