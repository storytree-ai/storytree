/** Capability 3 · Hooks. The prompt hook's per-session ledgers survive separate invocations of the built command. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Remember fresh ids in a ledger of their own; never use a session id as a path. */
export function notYetGivenIds(session: string, ids: readonly string[], ledger: Ledger): string[] {
  const fresh = freshIds(session, ids, ledger);
  markGiven(session, { ledger, ids: fresh });
  return fresh;
}

/** The ledgers kept per session. */
export type Ledger = "definitions" | "context-nudges" | "close-outs" | "big-injections" | "tools-stopped";

/** Ids a hook gave, to be remembered in their ledger once what it gave is the answer shown. */
export interface Given {
  readonly ledger: Ledger;
  readonly ids: readonly string[];
}

/** The ones of `ids` not yet in `session`'s `ledger`, without adding them; a session id that could not be a file name has none. */
export function freshIds(session: string, ids: readonly string[], ledger: Ledger): string[] {
  if (!/^[A-Za-z0-9._-]+$/.test(session)) return [...ids];
  const given = new Set<string>(readGiven(ledgerFile(session, ledger)));
  return ids.filter((id) => !given.has(id));
}

/** Remember `given`'s ids in `session`'s ledger; a session id that could not be a file name keeps nothing. */
export function markGiven(session: string, { ledger, ids }: Given): void {
  if (!/^[A-Za-z0-9._-]+$/.test(session)) return;
  const file = ledgerFile(session, ledger);
  const given = readGiven(file);
  const fresh = [...new Set(ids)].filter((id) => !given.includes(id));
  if (fresh.length === 0) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...given, ...fresh]));
}

/** Whether `id` is already in `session`'s `ledger`, without adding it. */
export function alreadyGiven(session: string, id: string, ledger: Ledger): boolean {
  return /^[A-Za-z0-9._-]+$/.test(session) && readGiven(ledgerFile(session, ledger)).includes(id);
}

function ledgerFile(session: string, ledger: Ledger): string {
  return path.join(tmpdir(), `storytree-${ledger}`, `${session}.json`);
}

function readGiven(file: string): string[] {
  try {
    const ids: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
