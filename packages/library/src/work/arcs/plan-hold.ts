// Capability 4 · Work model
import type { WorkModel } from "../../plan/index.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../../storage/rules/index.js";
import type { WorkInFlight } from "./flight.js";
import type { PendingPlanChange } from "../../plan/index.js";
import type { PlanChange } from "./pending.js";

export type PlanEditors = Pick<SchemaRecords, "get"> & Pick<WorkModel, "editStory" | "editCapability" | "editContract" | "editEdge"> & Pick<WorkInFlight, "editArc" | "editIncrement" | "pendChange">;

export interface PlanClaim {
  readonly session: string;
  readonly increment?: string | undefined;
  readonly capability?: string | undefined;
  readonly since: string;
  readonly branch?: string | undefined;
  readonly holder?: string | undefined;
}

export type PlanRecordType = "story" | "capability" | "contract" | "edge" | "arc" | "increment";

export type PlanEdit = { readonly held: string } | { readonly refused: string } | { readonly edited: SchemaRecord };

const MAIN_LINE: readonly string[] = ["main", "master"];
const HELD: readonly string[] = ["story", "capability", "contract", "edge"];

export async function refuseHeldPlanWrite(library: Pick<SchemaRecords, "get">, claims: readonly PlanClaim[], session: string, id: string): Promise<string | undefined> {
  if (session.startsWith("person:")) return undefined;
  const capability = await capabilityOf(library, id);
  if (capability === undefined) return undefined;
  for (const claim of claims) {
    if (claim.holder !== "live" || claim.session === session) continue;
    if (claim.capability === capability) return claimedSaid(claim.session, capability);
    if (claim.increment === undefined) continue;
    const increment = await library.get(claim.increment);
    if (increment?.type === "increment" && (increment.fields.capabilities ?? []).includes(capability)) return claimedSaid(claim.session, capability);
  }
  return undefined;
}

export async function holdPlanChange(library: PlanEditors, claims: readonly PlanClaim[], session: string, change: PlanChange, writer: WriteOptions): Promise<string | undefined> {
  const claim = branchClaim(claims, session);
  if (claim === undefined) return undefined;
  const pended = await library.pendChange(claim.increment!, change, writer);
  return pended === null || "plannedHere" in pended ? undefined : claim.increment;
}

export function heldSaid(increment: string): string {
  return `held as a change pending on increment ${increment} until its branch merges; the live plan is unchanged until then.`;
}

export async function heldPending(library: PlanEditors, claims: readonly PlanClaim[], session: string): Promise<readonly PendingPlanChange[]> {
  const claim = branchClaim(claims, session);
  if (claim === undefined) return [];
  const increment = await library.get(claim.increment!);
  return increment?.type === "increment" ? increment.fields.pending ?? [] : [];
}

export async function editPlanRecord(
  library: PlanEditors,
  claims: readonly PlanClaim[],
  session: string,
  { type, id, fields, live = false }: { readonly type: PlanRecordType; readonly id: string; readonly fields: Record<string, unknown>; readonly live?: boolean },
  writer: WriteOptions,
): Promise<PlanEdit | null> {
  if (type === "contract") {
    for (const target of [id, fields["capability"], fields["edge"]]) {
      if (typeof target !== "string") continue;
      const refused = await refuseHeldPlanWrite(library, claims, session, target);
      if (refused !== undefined) return { refused };
    }
  }
  if (!live && HELD.includes(type)) {
    const held = await holdPlanChange(library, claims, session, { record: id, fields }, writer);
    if (held !== undefined) return { held };
  }
  const edit = fields as never;
  const edited = type === "story" ? await library.editStory(id, edit, writer)
    : type === "capability" ? await library.editCapability(id, edit, writer)
      : type === "contract" ? await library.editContract(id, edit, writer)
        : type === "edge" ? await library.editEdge(id, edit, writer)
          : type === "arc" ? await library.editArc(id, edit, writer)
            : await library.editIncrement(id, edit, writer);
  return edited === null ? null : { edited };
}

function branchClaim(claims: readonly PlanClaim[], session: string): PlanClaim | undefined {
  return claims.find((claim) => claim.session === session && claim.increment !== undefined && claim.branch !== undefined && !MAIN_LINE.includes(claim.branch));
}

async function capabilityOf(library: Pick<SchemaRecords, "get">, id: string): Promise<string | undefined> {
  const record = await library.get(id);
  if (record?.type === "capability") return record.id;
  if (record?.type === "edge") return record.fields.from;
  if (record?.type !== "contract") return undefined;
  if (record.fields.capability !== undefined) return record.fields.capability;
  const edge = record.fields.edge === undefined ? null : await library.get(record.fields.edge);
  return edge?.type === "edge" ? edge.fields.from : undefined;
}

function claimedSaid(holder: string, capability: string): string {
  return `This write is on capability ${capability}, and live session ${holder} holds it: wait on its claim (set_wait with on: ${capability}), which clears the moment its holder releases it`;
}
