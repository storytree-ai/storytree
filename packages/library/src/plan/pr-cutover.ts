// Capability 4 · Work model
import type { FieldsOf } from "../storage/rules/index.js";

export type PrCutover = FieldsOf<"prCutover">;

export const PR_CUTOVER_ID = "pr-cutover";

export const historyOf = (repository: string): string => `${repository}-history`;

interface Pull {
  readonly number: string;
  readonly repository?: string;
}

export function beforeCutover(cutover: PrCutover | undefined, when: string): boolean {
  if (cutover === undefined) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return when < cutover.at.slice(0, 10);
  return Date.parse(when) < Date.parse(cutover.at);
}

export function pullRepository(cutover: PrCutover | undefined, pr: string, when: string, current: string): string | null | undefined {
  const pull = parse(pr);
  if (pull === undefined) return undefined;
  const moved = cutover !== undefined && beforeCutover(cutover, when);
  if (pull.repository === undefined) return moved ? cutover.before : (cutover?.repository ?? current);
  return moved && pull.repository === cutover.repository ? cutover.before : pull.repository;
}

export function pullSaid(cutover: PrCutover | undefined, pr: string, when: string): string {
  const pull = parse(pr);
  if (pull === undefined) return pr;
  if (cutover === undefined) return `#${pull.number}`;
  const repository = pullRepository(cutover, pr, when, cutover.repository);
  if (repository === null) return `#${pull.number}, in a deleted repository`;
  return repository === cutover.repository ? `#${pull.number}` : `${repository}#${pull.number}`;
}

function parse(pr: string): Pull | undefined {
  const local = /^#?(\d+)$/.exec(pr.trim());
  if (local !== null) return { number: local[1]! };
  const named = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(pr.trim());
  if (named !== null) return { repository: named[1]!, number: named[2]! };
  const address = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?$/.exec(pr.trim());
  if (address !== null) return { repository: address[1]!, number: address[2]! };
  return undefined;
}
