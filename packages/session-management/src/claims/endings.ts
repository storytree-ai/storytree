// Capability 5 · Claims
import type { IncrementStatus, Library, Line, NewLine, WriteOptions } from "@storytree/library";

import type { LockedLog } from "../activity/activity-log.js";

export const ENDING_KINDS = ["released", "landed", "merged", "closed"] as const;

export type Ending =
  | { readonly by: "holder" }
  | { readonly by: "manager"; readonly holder: string; readonly reason: string }
  | { readonly by: "landing" }
  | { readonly by: "merge"; readonly holder: string; readonly branch: string; readonly pr: number }
  | { readonly by: "close"; readonly disposition: "landed" | "failed" | "withdrawn" };

type On = { capability: string; increment?: undefined } | { increment: string; capability?: undefined };

export type Ender = Pick<NewLine, "session" | "harness" | "source" | "folder" | "branch">;

export type Returning = { readonly library: Library; readonly writer?: WriteOptions; readonly session: string };

export async function endClaim(log: Pick<LockedLog, "append">, ender: Ender, on: On, ending: Ending, returning?: Returning): Promise<{ line: Line; returned?: true }> {
  const returned = (ending.by === "holder" || ending.by === "manager") && returning !== undefined ? await returnUnclosed(returning, on.increment) : undefined;
  const line = await log.append(endingLine(ender, on, ending));
  return returned ? { line, returned } : { line };
}

function endingLine(ender: Ender, on: On, ending: Ending): NewLine {
  const part = on.increment !== undefined ? { increment: on.increment } : { capability: on.capability };
  switch (ending.by) {
    case "holder":
      return { ...ender, kind: "released", ...part };
    case "manager":
      return { ...ender, kind: "released", ...part, holder: ending.holder, reason: ending.reason };
    case "landing":
      return { ...ender, kind: "landed", capability: on.capability ?? on.increment! };
    case "merge":
      return { ...ender, kind: "merged", ...part, holder: ending.holder, branch: ending.branch, pr: ending.pr };
    case "close":
      return { ...ender, kind: "closed", increment: on.increment ?? on.capability!, disposition: ending.disposition };
  }
}

export async function returnUnclosed(returning: Returning, increment: string | undefined): Promise<true | undefined> {
  if (increment === undefined) return undefined;
  const work = await returning.library.get(increment);
  if (work?.type !== "increment" || (work.fields as { status: IncrementStatus }).status !== "active") return undefined;
  await returning.library.returnIncrement(increment, { ...returning.writer, actor: `session:${returning.session}` });
  return true;
}

export type Held = { readonly session: string; readonly under?: string | undefined };

export function ends(line: Line, id: string, held: Held): boolean {
  switch (line.kind) {
    case "released": {
      const on = line.increment ?? line.capability;
      return held.session === (line.holder ?? line.session) && (id === on || held.under === on);
    }
    case "landed":
      return held.session === line.session && id === line.capability;
    case "merged":
      return held.session === line.holder && id === (line.increment ?? line.capability);
    case "closed":
      return id === line.increment || held.under === line.increment;
    default:
      return false;
  }
}

export const ENDS_STANDING = `(
      (e.kind = 'released' AND coalesce(e.holder, e.session) = l.session AND (e.id = l.id OR e.id = l.under))
      OR (e.kind = 'landed' AND e.session = l.session AND e.id = l.id)
      OR (e.kind = 'merged' AND e.holder = l.session AND e.id = l.id)
      OR (e.kind = 'closed' AND (e.id = l.id OR e.id = l.under)))`;

export const ENDING_KINDS_SQL = ENDING_KINDS.map((kind) => `'${kind}'`).join(", ");
