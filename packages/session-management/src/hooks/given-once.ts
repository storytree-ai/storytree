// Capability 3 · Hooks
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function notYetGivenIds(session: string, ids: readonly string[], ledger: Ledger): string[] {
  const fresh = freshIds(session, ids, ledger);
  markGiven(session, { ledger, ids: fresh });
  return fresh;
}

export type Ledger = "definitions" | "context-nudges" | "close-outs" | "big-injections" | "tools-stopped";

export interface Given {
  readonly ledger: Ledger;
  readonly ids: readonly string[];
}

export function freshIds(session: string, ids: readonly string[], ledger: Ledger): string[] {
  if (!/^[A-Za-z0-9._-]+$/.test(session)) return [...ids];
  const given = new Set<string>(readGiven(ledgerFile(session, ledger)));
  return ids.filter((id) => !given.has(id));
}

export function markGiven(session: string, { ledger, ids }: Given): void {
  if (!/^[A-Za-z0-9._-]+$/.test(session)) return;
  const file = ledgerFile(session, ledger);
  const given = readGiven(file);
  const fresh = [...new Set(ids)].filter((id) => !given.includes(id));
  if (fresh.length === 0) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...given, ...fresh]));
}

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
