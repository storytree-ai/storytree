/** The prompt hook's per-session ledgers survive separate invocations of the built command. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Remember fresh ids in a ledger of their own; never use a session id as a path. */
export function notYetGivenIds(session: string, ids: readonly string[], ledger: "definitions" | "context-nudges"): string[] {
  if (!/^[A-Za-z0-9._-]+$/.test(session)) return [...ids];
  const folder = path.join(tmpdir(), `storytree-${ledger}`);
  const file = path.join(folder, `${session}.json`);
  const given = new Set<string>(readGiven(file));
  const fresh = ids.filter((id) => !given.has(id));
  if (fresh.length > 0) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, JSON.stringify([...given, ...fresh]));
  }
  return fresh;
}

function readGiven(file: string): string[] {
  try {
    const ids: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
