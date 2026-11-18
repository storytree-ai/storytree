// Capability 4 · Work model
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { PendingChange, PlanChange } from "./pending-changes.js";
import type { WorkInFlight } from "./work-in-flight.js";
import type { WorkModel } from "./work-model.js";

export type PlanEditors = Pick<SchemaRecords, "get">
  & Pick<WorkModel, "editStory" | "editCapability" | "editContract" | "editEdge">
  & Pick<WorkInFlight, "editArc" | "editIncrement" | "pendChange">;

export const PLAN_TYPES: ReadonlySet<string> = new Set(["story", "capability", "contract", "edge"]);

export interface PlanClaim {
  readonly session: string;
  readonly increment?: string | undefined;
  readonly since: string;
  readonly branch?: string | undefined;
}

const MAIN_BRANCHES: ReadonlySet<string> = new Set(["main", "master"]);

export type PlanRecordType = "story" | "capability" | "contract" | "edge" | "arc" | "increment";

export function isPlanRecordType(type: string): type is PlanRecordType {
  return PLAN_TYPES.has(type) || type === "arc" || type === "increment";
}

export type PlanEdit = { readonly held: string } | { readonly edited: SchemaRecord };

export function heldIncrement(claims: readonly PlanClaim[], session: string): string | undefined {
  const last = claims
    .filter((claim) => claim.session === session && claim.increment !== undefined)
    .sort((one, other) => one.since.localeCompare(other.since))
    .at(-1);
  return last?.branch === undefined || MAIN_BRANCHES.has(last.branch) ? undefined : last.increment;
}

export async function holdPlanChange(library: PlanEditors, claims: readonly PlanClaim[], session: string, change: PlanChange, writer: WriteOptions): Promise<string | undefined> {
  const increment = heldIncrement(claims, session);
  if (increment === undefined) return undefined;
  const pended = await library.pendChange(increment, change, writer);
  return pended !== null && "pending" in pended ? increment : undefined;
}

export function heldSaid(increment: string): string {
  return `pending on increment ${increment} until its branch merges; the live plan is unchanged. Reading the increment lists it.`;
}

export async function heldPending(library: PlanEditors, claims: readonly PlanClaim[], session: string): Promise<readonly PendingChange[]> {
  const increment = heldIncrement(claims, session);
  const record = increment === undefined ? null : await library.get(increment);
  return record?.type === "increment" ? ((record.fields as { pending?: PendingChange[] }).pending ?? []) : [];
}

export async function editPlanRecord(
  library: PlanEditors,
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
