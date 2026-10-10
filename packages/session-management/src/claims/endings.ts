/**
 * Capability 5 · Claims, how a claim ends: every way one ends and what that does to its increment,
 * in one place, for the writers (release, the session manager's release, landing, close-out, merges,
 * closing an increment) and the readers (the fold in readings.ts and the standing-claims query in
 * activity/bounded.ts) alike.
 *
 * - Released by its holder, or by the session manager for a quiet holder (ADR-0944 D7): a "released"
 *   line. Releasing an increment also ends what its holder claimed under it (ADR-0949 D4).
 * - Landed by its holder: a "landed" line, on a capability.
 * - Its branch's pull request merged after it was taken (ADR-0643 D3): a "merged" line naming the holder.
 * - Its increment closed, whoever closes it and whatever the disposition: a "closed" line, which ends
 *   every claim on the increment and every capability claim taken under it (ADR-0944 D5, ADR-0949 D4).
 * - Its session ended: a "session-ended" line, which the harness hooks write.
 * - A release (by the holder or the manager) leaves an active increment nobody's work in progress, so
 *   it is a proposal again (5.29); a landing, merge, close or session end does not return it.
 *
 * Imports types alone, so the activity log's query can take its predicate without an import cycle.
 */
import type { IncrementStatus, Library, WriteOptions } from "@storytree/library";

import type { LockedLog } from "../activity/activity-log.js";
import type { Line, NewLine } from "../activity/lines.js";

/** The kinds of line that end a claim. */
export const ENDING_KINDS = ["released", "landed", "merged", "closed", "session-ended"] as const;

/** Why a claim ends, as its writer says it. */
export type Ending =
  | { readonly by: "holder" }
  | { readonly by: "manager"; readonly holder: string; readonly reason: string }
  | { readonly by: "landing" }
  | { readonly by: "merge"; readonly holder: string; readonly branch: string; readonly pr: number }
  | { readonly by: "close"; readonly disposition: "landed" | "failed" | "withdrawn" };

/** What a claim is on: a capability or an increment, exactly one. */
type On = { capability: string; increment?: undefined } | { increment: string; capability?: undefined };

/** Whose line ends it: the fields every line carries. */
export type Ender = Pick<NewLine, "session" | "harness" | "source" | "folder" | "branch">;

/** The library a release returns an unclosed increment through, and as whom. */
export type Returning = { readonly library: Library; readonly writer?: WriteOptions; readonly session: string };

/**
 * End the claim on `on` with `ending`, under the activity log's lock: a release first returns an
 * active increment to proposal through `returning`, when given (5.29), then the line is written.
 * The line written, and whether the increment was returned.
 */
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

/**
 * An increment whose last claim ends without closing it is nobody's work in progress: when it is
 * active, it is a proposal again (5.29), through the library's own `returnIncrement`. Called under
 * the activity log's lock before the "released" line, as a claim's activation is before its
 * "claimed" line, so no claim can start it in between, and a library refusal writes nothing.
 * Whether it was returned.
 */
export async function returnUnclosed(returning: Returning, increment: string | undefined): Promise<true | undefined> {
  if (increment === undefined) return undefined;
  const work = await returning.library.get(increment);
  if (work?.type !== "increment" || (work.fields as { status: IncrementStatus }).status !== "active") return undefined;
  await returning.library.returnIncrement(increment, { ...returning.writer, actor: `session:${returning.session}` });
  return true;
}

/** A standing claim, as far as whether a line ends it goes. */
export type Held = { readonly session: string; readonly under?: string | undefined };

/** Whether `line` ends `held`, the claim standing on `id`. A line of no ending kind ends nothing. */
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
    case "session-ended":
      return held.session === line.session;
    default:
      return false;
  }
}

/**
 * `ends` in SQL, for the standing-claims query: whether ending row `e` (its kind, session, holder and
 * id) ends latest claim row `l` (its id, session and under). The two must say the same.
 */
export const ENDS_STANDING = `(
      (e.kind = 'released' AND coalesce(e.holder, e.session) = l.session AND (e.id = l.id OR e.id = l.under))
      OR (e.kind = 'landed' AND e.session = l.session AND e.id = l.id)
      OR (e.kind = 'merged' AND e.holder = l.session AND e.id = l.id)
      OR (e.kind = 'closed' AND (e.id = l.id OR e.id = l.under))
      OR (e.kind = 'session-ended' AND e.session = l.session))`;

/** ENDING_KINDS as an SQL list. */
export const ENDING_KINDS_SQL = ENDING_KINDS.map((kind) => `'${kind}'`).join(", ");
