// Capability 4 · Work model
import { isDeepStrictEqual } from "node:util";

import type { PendingPlanChange, ProjectTree, WorkModel } from "../../plan/index.js";
import { liveOf, MissingReferenceError, referTo, SchemaError, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../storage/rules/index.js";
import type { HistoryEntry } from "../../storage/store/index.js";

export type PlanChange = { readonly record: string; readonly fields: Readonly<Record<string, unknown>> } | { readonly record: string; readonly retire: string };
export type Pended = { readonly pending: PendingPlanChange } | { readonly plannedHere: true };

export interface StalePending {
  readonly record: string;
  readonly type: PendingPlanChange["type"];
  readonly base: number;
  readonly moved: { readonly seq: number; readonly action: "created" | "updated" | "retired"; readonly at: string; readonly actor?: string };
}

export type UnappliedPending =
  | (StalePending & { readonly why: "stale" })
  | { readonly record: string; readonly type: PendingPlanChange["type"]; readonly base: number; readonly why: "refused"; readonly refusal: string };

export interface AppliedPending {
  readonly applied: string[];
  readonly residue?: { readonly increment: string; readonly changes: UnappliedPending[] };
}

export interface SettledPending extends AppliedPending {
  readonly increment: string;
  readonly dropped: number;
}

type Planned = PendingPlanChange["type"];
type PlanRecord = SchemaRecord<Planned>;
type Fields = Record<string, unknown>;

const PLANNED: readonly string[] = ["story", "capability", "contract", "edge"];

export function markOf(increment: string, pr: string | undefined): string {
  return pr === undefined ? `applied at the landing of its increment (${increment})` : `applied at the merge of PR ${prSaid(pr)} (${increment})`;
}

export function prSaid(pr: string): string {
  return pr.startsWith("#") ? pr : `#${pr}`;
}

export function droppedSaid(count: number): string {
  return `dropped ${count} pending plan change${count === 1 ? "" : "s"}`;
}

export async function pendChange(records: SchemaRecords, work: WorkModel, id: string, change: PlanChange, options: WriteOptions = {}): Promise<Pended | null> {
  return await records.inOneWrite(async () => {
    const increment = await liveOf(records, "increment", id);
    if (increment === null) return null;
    if (increment.fields.status !== "active") throw new RangeError(`${id} is ${increment.fields.status}: only active work takes a pending plan change`);
    const target = await records.get(change.record);
    if (target === null || !PLANNED.includes(target.type)) throw new MissingReferenceError("record", change.record, "story, capability, contract or edge", target?.type);
    if (await plannedHere(records, id, change.record)) return { plannedHere: true as const };
    const record = target as PlanRecord;
    await refusePlugin(records, record);
    const pending = increment.fields.pending ?? [];
    const mine = pending.find((one) => one.record === record.id);
    if (mine !== undefined && "retire" in mine) throw new RangeError(`${record.id} is pending retirement under ${id}: drop that change before editing it`);
    if (!("retire" in change)) await checkEdit(records, work, record, mine, change.fields);
    const holders = (await records.select("increment", ["status", "pending"], { where: { status: "active" } }))
      .filter((other) => other.id !== id && (other.fields.pending ?? []).some((one) => one.record === record.id));
    if (holders.length > 0) throw new RangeError(`${record.id} already has a pending change under ${holders.map((other) => other.id).join(", ")}: it applies when that work lands, so wait on it`);
    const base = mine?.base ?? (await records.history({ id: record.id, newest: 1 }))[0]!.seq;
    const next: PendingPlanChange = "retire" in change
      ? { record: record.id, type: record.type, base, retire: change.retire }
      : merged(record, base, mine, change.fields);
    const list = mine === undefined ? [...pending, next] : pending.map((one) => (one === mine ? next : one));
    await records.edit(id, { pending: list }, options);
    return { pending: next };
  }, options.signal);
}

export async function withPending(records: SchemaRecords, id: string, tree: ProjectTree): Promise<ProjectTree | null> {
  const increment = await liveOf(records, "increment", id);
  if (increment === null) return null;
  const next = structuredClone(tree);
  for (const change of increment.fields.pending ?? []) overlay(next, change);
  return next;
}

export async function stalePending(records: SchemaRecords, id: string): Promise<StalePending[] | null> {
  const increment = await liveOf(records, "increment", id);
  if (increment === null) return null;
  const stale: StalePending[] = [];
  for (const change of increment.fields.pending ?? []) {
    const moved = await movedSince(records, id, change);
    if (moved !== undefined) stale.push({ record: change.record, type: change.type, base: change.base, moved });
  }
  return stale;
}

export async function applyPending(records: SchemaRecords, work: WorkModel, id: string, pr: string | undefined, options: WriteOptions = {}): Promise<AppliedPending | null> {
  const increment = await liveOf(records, "increment", id);
  if (increment === null) return null;
  const pending = increment.fields.pending ?? [];
  if (pending.length === 0) return { applied: [] };
  const mark = markOf(id, pr);
  const applied: string[] = [];
  const unapplied: UnappliedPending[] = [];
  let left = [...pending];
  for (const change of pending) {
    const outcome = await applyOne(records, work, id, change, mark, options);
    if (outcome === undefined) applied.push(change.record);
    else unapplied.push(outcome);
    left = left.filter((one) => one !== change);
    const said = outcome === undefined ? `${mark}: the pending change to ${change.type} ${change.record}` : `set aside the pending change to ${change.type} ${change.record}, ${outcome.why}`;
    await records.edit(id, { pending: left.length === 0 ? undefined : left }, { ...writer(options), reason: said });
  }
  if (unapplied.length === 0) return { applied };
  const residue = await records.create("increment", {
    arc: increment.fields.arc,
    title: `Residue of ${increment.fields.title}`,
    objective: "Make by hand the plan changes its landing could not apply",
    body: residueBody(id, unapplied),
    status: "proposal",
    parked: new Date().toISOString(),
  }, writer(options));
  return { applied, residue: { increment: residue.id, changes: unapplied } };
}

export async function dropPending(records: SchemaRecords, id: string, record: string, reason: string, options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
  return await records.inOneWrite(async () => {
    const increment = await liveOf(records, "increment", id);
    if (increment === null) return null;
    if (increment.fields.status === "closed") throw new RangeError(`${id} is closed: its pending changes were applied or dropped when it closed`);
    const pending = increment.fields.pending ?? [];
    const change = pending.find((one) => one.record === record);
    if (change === undefined) throw new RangeError(`${id} holds no pending change to ${record}`);
    const left = pending.filter((one) => one !== change);
    return (await records.edit(id, { pending: left.length === 0 ? undefined : left }, { ...writer(options), reason: `dropped the pending change to ${change.type} ${record}: ${reason}` })) as SchemaRecord<"increment">;
  }, options.signal);
}

export async function settleClosedPending(records: SchemaRecords, work: WorkModel, options: WriteOptions = {}): Promise<SettledPending[]> {
  const closed = (await records.select("increment", ["status", "pending", "outcome"], { where: { status: "closed" } }))
    .filter((increment) => (increment.fields.pending ?? []).length > 0);
  const settled: SettledPending[] = [];
  for (const increment of closed) {
    const outcome = increment.fields.outcome;
    if (outcome?.disposition === "landed") {
      const result = await applyPending(records, work, increment.id, outcome.pr, options);
      settled.push({ increment: increment.id, ...(result ?? { applied: [] }), dropped: 0 });
      continue;
    }
    const dropped = increment.fields.pending!.length;
    await records.edit(increment.id, { pending: undefined }, { ...writer(options), reason: `${droppedSaid(dropped)}: it closed ${outcome?.disposition ?? "without landing"}` });
    settled.push({ increment: increment.id, applied: [], dropped });
  }
  return settled;
}

async function applyOne(records: SchemaRecords, work: WorkModel, id: string, change: PendingPlanChange, mark: string, options: WriteOptions): Promise<UnappliedPending | undefined> {
  const later = await laterEntries(records, change);
  if (later.some((entry) => markedBy(entry, id))) return undefined;
  const moved = await movedSince(records, id, change);
  if (moved !== undefined) return { record: change.record, type: change.type, base: change.base, why: "stale", moved };
  const marked = { ...writer(options), reason: mark };
  try {
    if ("retire" in change) {
      await records.retire(change.record, `${mark}: ${change.retire}`, writer(options));
      return undefined;
    }
    const fields = Object.fromEntries(Object.entries(change.after).map(([key, value]) => [key, value === null ? undefined : value])) as never;
    const edited = change.type === "story" ? await work.editStory(change.record, fields, marked)
      : change.type === "capability" ? await work.editCapability(change.record, fields, marked)
        : change.type === "contract" ? await work.editContract(change.record, fields, marked)
          : await work.editEdge(change.record, fields, marked);
    if (edited === null) return { record: change.record, type: change.type, base: change.base, why: "refused", refusal: `${change.record} is no longer in the plan` };
    return undefined;
  } catch (error) {
    return { record: change.record, type: change.type, base: change.base, why: "refused", refusal: error instanceof Error ? error.message : String(error) };
  }
}

function residueBody(id: string, changes: readonly UnappliedPending[]): string {
  const lines = changes.map((change) => {
    if (change.why === "refused") return `- ${change.type} ${change.record} (read at history entry #${change.base}): refused when applied: ${change.refusal}`;
    const by = change.moved.actor === undefined ? "" : ` by ${change.moved.actor}`;
    return `- ${change.type} ${change.record}: read at history entry #${change.base}, then ${change.moved.action} at entry #${change.moved.seq} (${change.moved.at}${by}), so its change was not applied over it`;
  });
  return [`The landing of ${id} left these plan changes unapplied; make each by hand, or drop it:`, ...lines].join("\n");
}

async function laterEntries(records: SchemaRecords, change: PendingPlanChange): Promise<HistoryEntry[]> {
  return await records.history({ id: change.record, since: change.base });
}

async function movedSince(records: SchemaRecords, id: string, change: PendingPlanChange): Promise<StalePending["moved"] | undefined> {
  const entries = await records.history({ id: change.record });
  const at = entries.findIndex((entry) => entry.seq === change.base);
  let previous: Fields = at < 0 ? {} : entries[at]!.record.fields;
  for (const entry of entries.slice(at + 1)) {
    if (entry.seq <= change.base) continue;
    const fields = entry.record.fields;
    if (markedBy(entry, id)) {
      previous = fields;
      continue;
    }
    const moves = entry.action === "retired" || "retire" in change || Object.keys(change.after).some((key) => !isDeepStrictEqual(fields[key], previous[key]));
    if (moves) return { seq: entry.seq, action: entry.action, at: entry.at, ...(entry.actor === undefined ? {} : { actor: entry.actor }) };
    previous = fields;
  }
  return undefined;
}

function markedBy(entry: HistoryEntry, id: string): boolean {
  return entry.reason !== undefined && entry.reason.startsWith("applied at the ") && entry.reason.includes(`(${id})`);
}

async function plannedHere(records: SchemaRecords, id: string, record: string): Promise<boolean> {
  const entries = await records.history({ id });
  let activated: number | undefined;
  entries.forEach((entry, index) => {
    if (entry.record.fields["status"] === "active" && entries[index - 1]?.record.fields["status"] !== "active") activated = entry.seq;
  });
  const created = (await records.history({ id: record, oldest: 1 }))[0];
  return activated !== undefined && created !== undefined && created.action === "created" && created.seq > activated;
}

async function refusePlugin(records: SchemaRecords, record: PlanRecord): Promise<void> {
  const story = await storyOf(records, record);
  const plugin = story === undefined ? undefined : (await liveOf(records, "story", story))?.fields.plugin;
  if (plugin === undefined) return;
  throw new SchemaError(record.type, [{ field: undefined, problem: `${record.id} is part of ${plugin}'s plan: edit plugins/${plugin}'s plan file and import it, never a pending change` }]);
}

async function storyOf(records: SchemaRecords, record: PlanRecord): Promise<string | undefined> {
  if (record.type === "story") return record.id;
  if (record.type === "capability") return record.fields.story;
  const capability = record.type === "edge" ? record.fields.from : record.fields.capability ?? (await liveOf(records, "edge", record.fields.edge ?? ""))?.fields.from;
  return capability === undefined ? undefined : (await liveOf(records, "capability", capability))?.fields.story;
}

async function checkEdit(records: SchemaRecords, work: WorkModel, record: PlanRecord, mine: PendingPlanChange | undefined, fields: Readonly<Fields>): Promise<void> {
  if (record.type === "edge") work.refuseEdgeEnds(fields);
  const effective: Fields = { ...record.fields };
  const layer = (values: Readonly<Fields>) => {
    if (record.type === "contract") {
      if (values["edge"] !== undefined && values["edge"] !== null && !("capability" in values)) delete effective["capability"];
      if (values["capability"] !== undefined && values["capability"] !== null && !("edge" in values)) delete effective["edge"];
    }
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) delete effective[key];
      else effective[key] = value;
    }
  };
  if (mine !== undefined && "after" in mine) layer(mine.after);
  layer(fields);
  if (record.type === "capability") {
    if (typeof fields["story"] === "string") await referTo(records, "story", fields["story"], "story");
    for (const one of Array.isArray(fields["dependsOn"]) ? fields["dependsOn"] : []) await referTo(records, "dependsOn", String(one), "capability");
  }
  if (record.type === "contract") {
    if (typeof fields["capability"] === "string") await referTo(records, "capability", fields["capability"], "capability");
    if (typeof fields["edge"] === "string") await referTo(records, "edge", fields["edge"], "edge");
  }
  records.check(record.type, effective);
}

function merged(record: PlanRecord, base: number, mine: PendingPlanChange | undefined, fields: Readonly<Fields>): PendingPlanChange {
  const current = record.fields as Fields;
  const before: Fields = Object.fromEntries(Object.keys(fields).map((key) => [key, current[key] ?? null]));
  const after: Fields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? null]));
  if (mine === undefined || !("after" in mine)) return { record: record.id, type: record.type, base, before, after };
  return { record: record.id, type: record.type, base, before: { ...before, ...mine.before }, after: { ...mine.after, ...after } };
}

function overlay(tree: ProjectTree, change: PendingPlanChange): void {
  const after = "after" in change ? change.after : undefined;
  if (change.type === "story") {
    const at = tree.stories.findIndex((story) => story.id === change.record);
    if (at < 0) return;
    if (after === undefined) tree.stories.splice(at, 1);
    else assign(tree.stories[at]!, after);
    return;
  }
  if (change.type === "capability") {
    for (const story of tree.stories) {
      const at = story.capabilities.findIndex((capability) => capability.id === change.record);
      if (at < 0) continue;
      const [node] = story.capabilities.splice(at, 1);
      if (after === undefined) return;
      const { story: moved, dependsOn, ...rest } = after;
      assign(node!, rest);
      if (dependsOn !== undefined) node!.dependsOn = (dependsOn ?? []) as string[];
      const home = typeof moved === "string" ? tree.stories.find((other) => other.id === moved) ?? story : story;
      if (home === story) story.capabilities.splice(at, 0, node!);
      else home.capabilities.push(node!);
      return;
    }
    return;
  }
  if (change.type === "edge") {
    for (const story of tree.stories) {
      const at = story.edges?.findIndex((edge) => edge.id === change.record) ?? -1;
      if (at < 0) continue;
      const edge = story.edges![at]!;
      if (after !== undefined) {
        assign(edge, after);
        return;
      }
      story.edges!.splice(at, 1);
      if (story.edges!.length === 0) delete story.edges;
      const from = story.capabilities.find((capability) => capability.id === edge.from);
      if (from !== undefined) {
        const index = from.dependsOn.indexOf(edge.to);
        if (index >= 0) from.dependsOn.splice(index, 1);
      }
      return;
    }
    return;
  }
  const holders = tree.stories.flatMap((story) => [...story.capabilities, ...(story.edges ?? [])]);
  for (const holder of holders) {
    const at = holder.contracts.findIndex((contract) => contract.id === change.record);
    if (at < 0) continue;
    const [node] = holder.contracts.splice(at, 1);
    if (after === undefined) return;
    const { capability, edge, ...rest } = after;
    assign(node!, rest);
    const owner = typeof capability === "string" ? capability : typeof edge === "string" ? edge : undefined;
    const home = owner === undefined ? holder : holders.find((other) => other.id === owner) ?? holder;
    if (home === holder) holder.contracts.splice(at, 0, node!);
    else home.contracts.push(node!);
    return;
  }
}

function assign(node: object, values: Readonly<Fields>): void {
  const target = node as Fields;
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) delete target[key];
    else target[key] = value;
  }
}

function writer(options: WriteOptions): WriteOptions {
  return options.actor === undefined ? {} : { actor: options.actor };
}
