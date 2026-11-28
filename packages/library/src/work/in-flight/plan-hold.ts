// Capability 10 · Arcs and increments
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../../records/index.js";
import type { PendingChange, PlanChange } from "./pending-changes.js";
import type { WorkInFlight } from "./work-in-flight.js";
import type { WorkModel } from "../../plan/index.js";

export type PlanEditors = Pick<SchemaRecords, "get" | "history">
  & Pick<WorkModel, "editStory" | "editCapability" | "editContract" | "editEdge">
  & Pick<WorkInFlight, "editArc" | "editIncrement" | "pendChange">;

export const PLAN_TYPES: ReadonlySet<string> = new Set(["story", "capability", "contract", "edge"]);

export interface PlanClaim {
  readonly session: string;
  readonly increment?: string | undefined;
  readonly capability?: string | undefined;
  readonly since: string;
  readonly branch?: string | undefined;
  readonly holder?: string | undefined;
}

const MAIN_BRANCHES: ReadonlySet<string> = new Set(["main", "master"]);

export type PlanRecordType = "story" | "capability" | "contract" | "edge" | "arc" | "increment";

export function isPlanRecordType(type: string): type is PlanRecordType {
  return PLAN_TYPES.has(type) || type === "arc" || type === "increment";
}

export type PlanEdit = { readonly held: string } | { readonly refused: string } | { readonly edited: SchemaRecord };

export function heldIncrement(claims: readonly PlanClaim[], session: string): string | undefined {
  const last = claims
    .filter((claim) => claim.session === session && claim.increment !== undefined)
    .sort((one, other) => one.since.localeCompare(other.since))
    .at(-1);
  return last?.branch === undefined || MAIN_BRANCHES.has(last.branch) ? undefined : last.increment;
}

async function capabilityOf(library: Pick<SchemaRecords, "get">, id: string): Promise<string | undefined> {
  const record = await library.get(id);
  if (record === null) return undefined;
  const fields = record.fields as { capability?: string; edge?: string; from?: string };
  if (record.type === "capability") return record.id;
  if (record.type === "edge") return fields.from;
  if (record.type !== "contract") return undefined;
  return fields.capability ?? (fields.edge === undefined ? undefined : await capabilityOf(library, fields.edge));
}

async function listedOn(library: Pick<SchemaRecords, "get">, increment: string): Promise<readonly string[]> {
  const record = await library.get(increment);
  return record?.type === "increment" ? ((record.fields as { capabilities?: string[] }).capabilities ?? []) : [];
}

export async function refuseHeldPlanWrite(library: Pick<SchemaRecords, "get">, claims: readonly PlanClaim[], session: string, id: string): Promise<string | undefined> {
  if (session.startsWith("person:")) return undefined;
  const others = claims.filter((claim) => claim.session !== session && claim.holder === "live");
  if (others.length === 0) return undefined;
  const capability = await capabilityOf(library, id);
  if (capability === undefined) return undefined;
  let holder = others.find((claim) => claim.capability === capability);
  let on: string | undefined;
  if (holder === undefined) {
    if (claims.some((claim) => claim.capability === capability && claim.session === session)) return undefined;
    for (const claim of others) {
      if (claim.increment !== undefined && (await listedOn(library, claim.increment)).includes(capability)) {
        holder = claim;
        on = claim.increment;
        break;
      }
    }
  }
  if (holder === undefined) return undefined;
  const where = on === undefined ? "holds it" : `holds it on the capabilities list of ${on}`;
  return `Refused, nothing written: ${id} is on capability ${capability}, and live session ${holder.session} ${where}, so another session does not add, edit or retire its contracts. Back off (ADR-0944 D3): wait on that capability's claim (the set_wait tool with on: ${capability}, or \`storytree arc increment wait <increment> --on ${capability} --reason …\`), which clears when ${holder.session} releases it, and take other work.`;
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

async function plannedBy(library: Pick<SchemaRecords, "history">, increment: string, record: string): Promise<boolean> {
  const [created] = await library.history({ id: record, oldest: 1 });
  const started = (await library.history({ id: increment })).find((entry) => entry.record.fields["status"] === "active");
  return created !== undefined && started !== undefined && created.seq > started.seq;
}

async function refuseSplitNest(library: PlanEditors, claims: readonly PlanClaim[], session: string, id: string, fields: Record<string, unknown>): Promise<string | undefined> {
  const others = Object.keys(fields).filter((field) => field !== "parent");
  if (others.length === 0) return undefined;
  const increment = heldIncrement(claims, session);
  if (increment === undefined || (await plannedBy(library, increment, id))) return undefined;
  const parent = typeof fields["parent"] === "string" ? `parent ${fields["parent"]}` : "parent (cleared)";
  return `Refused, nothing written: the ${parent} of capability ${id} goes to the live plan at once, but its ${others.join(", ")} would wait on increment ${increment} until its branch merges, so one edit cannot carry both. Give --parent alone (applied to the live plan at once), the ${others.join(", ")} in an edit of their own (pending on ${increment}), or the whole edit with --live.`;
}

export async function editPlanRecord(
  library: PlanEditors,
  claims: readonly PlanClaim[],
  session: string,
  { type, id, fields, live = false, nests = false }: { readonly type: PlanRecordType; readonly id: string; readonly fields: Record<string, unknown>; readonly live?: boolean; readonly nests?: boolean },
  writer: WriteOptions,
): Promise<PlanEdit | null> {
  if (type === "contract") {
    for (const target of [id, fields.capability, fields.edge]) {
      if (typeof target !== "string") continue;
      const refused = await refuseHeldPlanWrite(library, claims, session, target);
      if (refused !== undefined) return { refused };
    }
  }
  if (nests && !live) {
    const refused = await refuseSplitNest(library, claims, session, id, fields);
    if (refused !== undefined) return { refused };
  }
  if (PLAN_TYPES.has(type) && !live && !nests) {
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
