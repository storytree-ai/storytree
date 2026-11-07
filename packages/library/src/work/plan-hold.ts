/**
 * Capability 4 · Work model, its pending plan changes. The one rule both front doors call for a change to the plan (ADR-0966 D1, ADR-0793):
 * an edit or retirement of a story, capability or contract made by a session holding an increment waits on that
 * increment as a pending change until its branch merges; one made by a session holding none is made live.
 */
import type { Library } from "../api/library.js";
import type { SchemaRecord, WriteOptions } from "../schema/index.js";
import type { PendingChange, PlanChange } from "./pending-changes.js";

/** The kinds whose edits and retirements wait on the caller's increment until its branch merges (ADR-0966 D1). */
export const PLAN_TYPES: ReadonlySet<string> = new Set(["story", "capability", "contract"]);

/** A claim as a door reads it: the session holding it, the increment it is for, if any, and since when. */
export interface PlanClaim {
  readonly session: string;
  readonly increment?: string | undefined;
  readonly since: string;
}

/** The kinds of plan record a door edits through the plan's own editors; an edge's are made live (ADR-1282 D1). */
export type PlanRecordType = "story" | "capability" | "contract" | "edge" | "arc" | "increment";

/** Whether a record of `type` is edited through the plan's own editors. */
export function isPlanRecordType(type: string): type is PlanRecordType {
  return PLAN_TYPES.has(type) || type === "edge" || type === "arc" || type === "increment";
}

/** What a plan edit did: held on the caller's increment, or made live. */
export type PlanEdit = { readonly held: string } | { readonly edited: SchemaRecord };

/** The increment `session` claimed last of those it holds, if any. */
export function heldIncrement(claims: readonly PlanClaim[], session: string): string | undefined {
  return claims
    .filter((claim) => claim.session === session && claim.increment !== undefined)
    .sort((one, other) => one.since.localeCompare(other.since))
    .at(-1)?.increment;
}

/**
 * Hold `change` on the increment `session` holds, as a pending change, and return that increment; undefined when it
 * holds none (a person's shell holds none), or the increment planned the record itself, and the change is made live.
 */
export async function holdPlanChange(library: Library, claims: readonly PlanClaim[], session: string, change: PlanChange, writer: WriteOptions): Promise<string | undefined> {
  const increment = heldIncrement(claims, session);
  if (increment === undefined) return undefined;
  const pended = await library.pendChange(increment, change, writer);
  return pended !== null && "pending" in pended ? increment : undefined;
}

/** How a door says a change was held on `increment`. */
export function heldSaid(increment: string): string {
  return `pending on increment ${increment} until its branch merges; the live plan is unchanged. Reading the increment lists it.`;
}

/** The pending changes of the increment `session` holds, which its branch's new capabilities are numbered against (ADR-0966 D3). */
export async function heldPending(library: Library, claims: readonly PlanClaim[], session: string): Promise<readonly PendingChange[]> {
  const increment = heldIncrement(claims, session);
  const record = increment === undefined ? null : await library.get(increment);
  return record?.type === "increment" ? ((record.fields as { pending?: PendingChange[] }).pending ?? []) : [];
}

/**
 * Edit plan record `id` of `type` through its kind's editor, unless the edit is held on the caller's increment (a
 * story, capability or contract, not `live`: a correction the increment does not change, made live with its claim kept);
 * null when no live record has the id.
 */
export async function editPlanRecord(
  library: Library,
  claims: readonly PlanClaim[],
  session: string,
  { type, id, fields, live = false }: { readonly type: PlanRecordType; readonly id: string; readonly fields: Record<string, unknown>; readonly live?: boolean },
  writer: WriteOptions,
): Promise<PlanEdit | null> {
  if (PLAN_TYPES.has(type) && !live) {
    const held = await holdPlanChange(library, claims, session, { record: id, fields }, writer);
    if (held !== undefined) return { held };
  }
  const edit = fields as never;
  const edited =
    type === "story"
      ? await library.editStory(id, edit, writer)
      : type === "capability"
        ? await library.editCapability(id, edit, writer)
        : type === "contract"
          ? await library.editContract(id, edit, writer)
          : type === "edge"
            ? await library.editEdge(id, edit, writer)
            : type === "arc"
            ? await library.editArc(id, edit, writer)
            : await library.editIncrement(id, edit, writer);
  return edited === null ? null : { edited };
}
