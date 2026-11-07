/**
 * Capability 4 · Work model, its pending plan changes (the library story, ADR-0966; with plan structure, ADR-1243 D4):
 * an active increment holds the changes to the plan it did not plan as pending, leaving the live records alone until it lands; its branch reads the plan with them laid
 * over; at its landing they apply through the plan's own editors, a stale or refused one parked as residue on its arc,
 * and a close that does not land drops them. These are the rules; WorkInFlight (capability 10) is their one door, and
 * queues each write behind its own as it does for waits (11) and questions (12).
 */
import { isDeepStrictEqual } from "node:util";

import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { FieldsOf } from "../schema/types.js";
import type { HistoryEntry } from "../transactions/index.js";
import type { CapabilityNode, ProjectTree, StoryNode, WorkModel } from "./work-model.js";

/** A pending plan change, as its increment keeps it (ADR-0966 D1). */
export type PendingChange = NonNullable<FieldsOf<"increment">["pending"]>[number];

/**
 * A change to a story, capability or contract, to wait on an increment: some of its fields (one
 * set to undefined is removed), or its retirement with the reason.
 */
export type PlanChange =
  | { readonly record: string; readonly fields: Readonly<Record<string, unknown>> }
  | { readonly record: string; readonly retire: string };

/** What pendChange did: the change now pending, or nothing, since the increment planned the record and edits it live. */
export type Pended = { readonly pending: PendingChange } | { readonly plannedHere: true };

/**
 * A pending change written against an older version of its record (ADR-0966 D5): the history entry
 * it was read at (`base`), and the one that has changed the record since (`moved`), with when and who.
 */
export interface StalePending {
  readonly record: string;
  readonly type: PendingChange["type"];
  readonly base: number;
  readonly moved: { readonly seq: number; readonly action: "created" | "updated" | "retired"; readonly at: string; readonly actor?: string };
}

/** A pending change not applied at its increment's landing (ADR-0966 D5): stale, naming the entry that moved it, or refused by its editor. */
export type UnappliedPending =
  | (StalePending & { readonly why: "stale" })
  | { readonly record: string; readonly type: PendingChange["type"]; readonly base: number; readonly why: "refused"; readonly refusal: string };

/** What applying an increment's pending changes did: the records changed, and, when some could not be, the residue increment parked for them. */
export interface AppliedPending {
  readonly applied: string[];
  readonly residue?: { readonly increment: string; readonly changes: UnappliedPending[] };
}

/** What settling one closed increment's leftover pending changes did (settleClosedPending). */
export interface SettledPending extends AppliedPending {
  readonly increment: string;
  /** How many were dropped, since it did not land. */
  readonly dropped: number;
}

/** What an increment's pending changes may name: its plan's records (ADR-0966 D1). */
const PLAN_RECORD = { name: "story, capability or contract", types: ["story", "capability", "contract"] } as const;

/** How a pending retirement retires its record: WorkInFlight's retire, which refuses a capability with live dependents. */
export type Retire = (id: string, reason: string, options?: WriteOptions) => Promise<void>;

/**
 * Hold `change` on active increment `id` as a pending change (ADR-0966 D1), leaving the live record
 * alone: kept with the record's latest history entry as its base, and, for an edit, the changed
 * fields' live values beside the new ones. A second change to the same record merges into the first,
 * keeping its base and first values; a retirement replaces an edit, and an edit after a pending
 * retirement is refused. A record the increment planned itself, created after it started, is not
 * held: the answer says so, and the caller edits it live. Refused, with nothing written: an increment
 * that is not active (RangeError); a record that is not a live story, capability or contract
 * (MissingReferenceError); an edit to a plugin's plan, refused as the plan's editors refuse it live (SchemaError,
 * 4.35); an edit that would leave the record invalid (SchemaError) or name a
 * missing record (MissingReferenceError); and a record another open increment already holds a
 * pending change for, naming that increment (RangeError, D5). Null if `id` is not a live increment.
 */
export async function pendChange(records: SchemaRecords, work: WorkModel, id: string, change: PlanChange, options?: WriteOptions): Promise<Pended | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  if (increment === null) return null;
  if (increment.fields.status !== "active") {
    throw new RangeError(`increment ${JSON.stringify(id)} is ${increment.fields.status}: only an active increment, one a session holds, takes pending changes`);
  }
  await checkReference(records, "record", change.record, PLAN_RECORD);
  const record = (await liveRecord(records, change.record, PLAN_RECORD.types))!;
  const [created] = await records.history({ id: record.id, oldest: 1 });
  const started = (await records.history({ id })).find((entry) => entry.record.fields["status"] === "active");
  if (started !== undefined && created!.seq > started.seq) return { plannedHere: true };
  const holder = (await records.select("increment", ["pending"], { not: { status: "closed" } }))
    .find((other) => other.id !== id && (other.fields.pending ?? []).some((pending) => pending.record === record.id));
  if (holder !== undefined) {
    throw new RangeError(
      `${record.type} ${JSON.stringify(record.id)} already has a pending change on open increment ${JSON.stringify(holder.id)}: ` +
        "two increments never hold changes to one record (ADR-0966 D5); take other work, or wait for that one to land or close",
    );
  }
  const pending = increment.fields.pending ?? [];
  const earlier = pending.find((entry) => entry.record === record.id);
  const base = earlier?.base ?? (await records.history({ id: record.id, newest: 1 }))[0]!.seq;
  const head = { record: record.id, type: record.type, base };
  let entry: PendingChange;
  if ("retire" in change) {
    entry = { ...head, retire: change.retire };
  } else {
    if (earlier !== undefined && "retire" in earlier) {
      throw new RangeError(`${record.type} ${JSON.stringify(record.id)} is pending retirement on this increment: it takes no edit after that`);
    }
    await work.refusePluginEdit(record as SchemaRecord<"story"> | SchemaRecord<"capability"> | SchemaRecord<"contract">, change.fields);
    const live = record.fields as Record<string, unknown>;
    const given = Object.keys(change.fields);
    const after = { ...(earlier?.after ?? {}), ...Object.fromEntries(given.map((field) => [field, change.fields[field] ?? null])) };
    const before = { ...Object.fromEntries(given.map((field) => [field, live[field] ?? null])), ...(earlier?.before ?? {}) };
    const merged = { ...live, ...after };
    for (const [field, value] of Object.entries(after)) if (value === null) delete merged[field];
    // A contract moved onto an edge leaves its capability, and one moved onto a capability its edge, as editContract moves it (ADR-1282 D1).
    if (record.type === "contract" && typeof after["edge"] === "string" && !Object.hasOwn(after, "capability")) delete merged["capability"];
    if (record.type === "contract" && typeof after["capability"] === "string" && !Object.hasOwn(after, "edge")) delete merged["edge"];
    records.check(record.type, merged);
    await checkReference(records, "story", record.type === "capability" ? change.fields["story"] : undefined, "story");
    await checkReferences(records, "dependsOn", change.fields["dependsOn"], "capability");
    await checkReference(records, "capability", record.type === "contract" ? change.fields["capability"] : undefined, "capability");
    await checkReference(records, "edge", record.type === "contract" ? change.fields["edge"] : undefined, "edge");
    entry = { ...head, before, after };
  }
  const next = earlier === undefined ? [...pending, entry] : pending.map((other) => (other === earlier ? entry : other));
  await records.edit(id, { pending: next }, options);
  return { pending: entry };
}

/**
 * `tree`, as WorkModel.projectTree() gives it, with increment `id`'s pending changes laid over (ADR-0966
 * D3): what its branch's own checks read. An edit's new fields replace the live ones the tree shows
 * (a capability or contract given a new story or capability moves there), and a retirement takes the
 * record, and anything under it, out. The tree given is not changed. Null if `id` is not a live increment.
 */
export async function withPending(records: SchemaRecords, id: string, tree: ProjectTree): Promise<ProjectTree | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  return increment === null ? null : overlay(tree, increment.fields.pending ?? []);
}

/**
 * Increment `id`'s pending changes their record has moved since they were read (ADR-0966 D5's gate
 * case, movedSince): each with its base and its record's latest history entry, in the increment's
 * order. A record whose latest entry is this increment's own applying of the change is not moved (4.34). Empty when none has moved; null if `id` is not a live increment.
 */
export async function stalePending(records: SchemaRecords, id: string): Promise<StalePending[] | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  if (increment === null) return null;
  const stale: StalePending[] = [];
  for (const change of increment.fields.pending ?? []) {
    const { record, type, base } = change;
    const [latest] = await records.history({ id: record, newest: 1 });
    if (latest === undefined || !movedSince(change, latest) || appliedBy(latest.reason, id)) continue;
    const moved = { seq: latest.seq, action: latest.action, at: latest.at, ...(latest.actor === undefined ? {} : { actor: latest.actor }) };
    stale.push({ record, type, base, moved });
  }
  return stale;
}

/**
 * Apply increment `id`'s pending changes (ADR-0966 D4): what GitHub reporting its branch merged, or
 * its landed close, calls. Each goes through the plan's own editor (editStory, editCapability,
 * editContract, retire), which checks it as a live edit is checked, and its history entry's reason
 * reads "applied at the merge of PR #n (<increment>)". One its record has moved since it was read
 * (movedSince), or whose record is gone, is stale; one its editor refuses is refused: neither is applied, and both are
 * parked together as one proposal increment on the same arc, its body naming each record, its base,
 * the entry that moved it or the refusal, and the change (D5). A change whose record's latest entry
 * already carries this increment's mark (any of its pull requests) on an entry after the change's base, as after a crash part-way, counts as
 * applied. Each change leaves the increment's pending list as it applies, so an apply cut off part-way
 * leaves pending only what it had not applied (4.34); the increment keeps none pending afterwards. The library has no transaction across records, so they apply one at a time,
 * in the increment's order.
 */
export async function applyPending(records: SchemaRecords, work: WorkModel, retire: Retire, increment: SchemaRecord<"increment">, pr: string | undefined, options?: WriteOptions): Promise<AppliedPending> {
  const pending = increment.fields.pending ?? [];
  if (pending.length === 0) return { applied: [] };
  const number = pr?.replace(/^#/, "");
  const mark = number === undefined || number === "" ? `applied at the landing of ${increment.id}` : `applied at the merge of PR #${number} (${increment.id})`;
  const applied: string[] = [];
  const unapplied: UnappliedPending[] = [];
  for (const change of pending) {
    const { record, type, base } = change;
    const [latest] = await records.history({ id: record, newest: 1 });
    // Its own mark counts only on an entry after the change was read: one pended on top of the increment's own earlier apply is not applied yet.
    if (latest !== undefined && latest.seq !== base && appliedBy(latest.reason, increment.id)) {
      applied.push(record);
      continue;
    }
    if (latest === undefined || movedSince(change, latest)) {
      const moved = latest === undefined
        ? { seq: base, action: "retired" as const, at: "", actor: undefined }
        : { seq: latest.seq, action: latest.action, at: latest.at, actor: latest.actor };
      unapplied.push({ record, type, base, moved: { seq: moved.seq, action: moved.action, at: moved.at, ...(moved.actor === undefined ? {} : { actor: moved.actor }) }, why: "stale" });
      continue;
    }
    try {
      if ("retire" in change) {
        await retire(record, `${change.retire} (${mark})`, options);
      } else {
        const fields = Object.fromEntries(Object.entries(change.after).map(([field, value]) => [field, value ?? undefined]));
        const write = { ...options, reason: mark };
        if (type === "story") await work.editStory(record, fields, write);
        else if (type === "capability") await work.editCapability(record, fields, write);
        else await work.editContract(record, fields, write);
      }
      applied.push(record);
    } catch (error) {
      unapplied.push({ record, type, base, why: "refused", refusal: error instanceof Error ? error.message : String(error) });
      continue;
    }
    // Cleared as it applies, so an apply cut off part-way (a hook's deadline) leaves pending only what it had not applied.
    const left = pending.filter((other) => !applied.includes(other.record));
    if (left.length > 0) await records.edit(increment.id, { pending: left }, { ...options, reason: `${mark}: ${record}` });
  }
  let residue: AppliedPending["residue"];
  if (unapplied.length > 0) {
    const changes = new Map(pending.map((change) => [change.record, change]));
    const parked = await records.create("increment", {
      arc: increment.fields.arc,
      title: `Redo the plan changes ${increment.id} could not apply at its landing`,
      objective: `The plan says what ${increment.id} meant it to say: each change below is redone by hand against its record as it is now, or let go with a reason.`,
      body: residueBody(increment.id, mark, unapplied, changes),
      links: [increment.id],
      status: "proposal",
      parked: new Date().toISOString(),
    }, options);
    residue = { increment: parked.id, changes: unapplied };
  }
  const summary = `${mark}: ${applied.length} applied${unapplied.length === 0 ? "" : `, ${unapplied.length} parked as residue on ${residue!.increment}`}`;
  await records.edit(increment.id, { pending: undefined }, { ...options, reason: summary });
  return { applied, ...(residue === undefined ? {} : { residue }) };
}

/**
 * Drop open increment `id`'s one pending change to `record`, with a reason, its history entry saying
 * which and why: for a change something else overtook, such as a plugin's own plan (ADR-0966 D6 drops
 * them all only at a close that does not land). The live plan is left as it was. Refused, with nothing
 * written: a closed increment, and a record it holds no pending change for (RangeError). Null if `id`
 * is not a live increment.
 */
export async function dropPending(records: SchemaRecords, id: string, record: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  if (increment === null) return null;
  if (increment.fields.status === "closed") throw new RangeError(`increment ${JSON.stringify(id)} is closed: its pending changes were applied or dropped when it closed`);
  const pending = increment.fields.pending ?? [];
  const change = pending.find((entry) => entry.record === record);
  if (change === undefined) throw new RangeError(`increment ${JSON.stringify(id)} holds no pending change to ${JSON.stringify(record)}`);
  const rest = pending.filter((entry) => entry !== change);
  const why = `dropped the pending change to ${change.type} ${record}: ${reason}`;
  return (await records.edit(id, { pending: rest.length === 0 ? undefined : rest }, { ...options, reason: why })) as SchemaRecord<"increment"> | null;
}

/**
 * Settle every closed increment's leftover pending changes, those of increments closed before
 * closing applied or dropped them: each that landed has them applied, as applyPending applies them
 * with its pull request; each that did not has them dropped. Oldest first; empty when none is left.
 */
export async function settleClosedPending(records: SchemaRecords, work: WorkModel, retire: Retire, options?: WriteOptions): Promise<SettledPending[]> {
  const closed = (await records.select("increment", ["pending", "outcome"], { where: { status: "closed" } }))
    .filter((increment) => (increment.fields.pending ?? []).length > 0)
    .sort(byCreation);
  const settled: SettledPending[] = [];
  for (const { id, fields } of closed) {
    const increment = (await liveRecord(records, id, ["increment"]))!;
    if (fields.outcome?.disposition === "landed") {
      settled.push({ increment: id, ...(await applyPending(records, work, retire, increment, fields.outcome.pr, options)), dropped: 0 });
    } else {
      const dropped = fields.pending!.length;
      await records.edit(id, { pending: undefined }, { ...options, reason: droppedReason(dropped, fields.outcome?.disposition ?? "withdrawn") });
      settled.push({ increment: id, applied: [], dropped });
    }
  }
  return settled;
}

/** Whether a history entry's reason is increment `id`'s own applying of a pending change (applyPending's mark). */
function appliedBy(reason: string | undefined, id: string): boolean {
  return reason !== undefined && (reason.includes(`applied at the landing of ${id}`) || new RegExp(`applied at the merge of PR #\\d+ \\(${id}\\)`).test(reason));
}

/** Why a close or a settling dropped `count` pending plan changes (ADR-0966 D6). */
export function droppedReason(count: number, disposition: string): string {
  return `dropped ${count} pending plan change${count === 1 ? "" : "s"}: the increment closed ${disposition}, so they never apply (ADR-0966 D6)`;
}

/** The residue increment's body: each unapplied change, its record, its base, why it was not applied, and the change itself. */
function residueBody(increment: string, mark: string, unapplied: readonly UnappliedPending[], changes: ReadonlyMap<string, PendingChange>): string {
  const lines = unapplied.map((one) => {
    const why = one.why === "stale"
      ? `stale: read at history entry #${one.base}, since moved by entry #${one.moved.seq} (${one.moved.action}${one.moved.at === "" ? "" : ` ${one.moved.at}`}${one.moved.actor === undefined ? "" : ` by ${one.moved.actor}`})`
      : `refused by its editor at history entry #${one.base}: ${one.refusal}`;
    const change = changes.get(one.record)!;
    const what = "retire" in change ? `retire it: ${change.retire}` : `set ${JSON.stringify(change.after)} (was ${JSON.stringify(change.before)})`;
    return `- ${one.type} ${one.record}, ${why}. The change: ${what}.`;
  });
  return [
    `RESIDUE of ${increment} (ADR-0966 D5): at its landing (${mark}) these pending plan changes were not applied, and nothing overwrote the record.`,
    ...lines,
    "Redo each against the record as it reads now, or let it go with a reason, then close this.",
  ].join("\n");
}

/**
 * Whether `latest`, its record's newest history entry, has moved `change` since it was read (ADR-0966
 * D5): the record is retired, or, for a retirement, any entry since its base; for an edit, a field it
 * sets no longer holds the value it was read with. A write that touched only other fields, as marking
 * a capability built does, leaves the edit to apply, since applying it overwrites nothing newer.
 */
function movedSince(change: PendingChange, latest: HistoryEntry): boolean {
  if (latest.seq === change.base) return false;
  if (latest.action === "retired" || "retire" in change) return true;
  const live = latest.record.fields as Record<string, unknown>;
  return Object.entries(change.before).some(([field, value]) => !isDeepStrictEqual(live[field] ?? null, value));
}

/** `tree` with `pending` laid over, as withPending gives it. */
function overlay(tree: ProjectTree, pending: readonly PendingChange[]): ProjectTree {
  const retired = new Set(pending.flatMap((change) => ("retire" in change ? [change.record] : [])));
  const after = new Map(pending.flatMap((change) => ("after" in change ? [[change.record, change.after] as const] : [])));
  const shown = <T extends { id: string; title: string; description?: string }>(node: T): T => {
    const fields = after.get(node.id);
    if (fields === undefined) return node;
    const { description: _, ...rest } = node;
    const title = Object.hasOwn(fields, "title") ? (fields["title"] as string) : node.title;
    const description = Object.hasOwn(fields, "description") ? (fields["description"] as string | null) : node.description;
    return { ...rest, title, ...(description === null || description === undefined ? {} : { description }) } as T;
  };
  const parentOf = (id: string, field: string, live: string): string => {
    const moved = after.get(id)?.[field];
    return typeof moved === "string" ? moved : live;
  };
  const capabilities = tree.stories.flatMap((story) => story.capabilities.map((capability) => ({ capability, story: parentOf(capability.id, "story", story.id) })));
  const contracts = capabilities.flatMap(({ capability }) => capability.contracts.map((contract) => ({ contract, capability: parentOf(contract.id, "capability", capability.id) })));
  const capabilityNode = (capability: CapabilityNode): CapabilityNode => {
    const fields = after.get(capability.id) ?? {};
    return {
      ...shown(capability),
      dependsOn: Object.hasOwn(fields, "dependsOn") ? [...((fields["dependsOn"] as string[] | null) ?? [])] : [...capability.dependsOn],
      proposed: Object.hasOwn(fields, "proposed") ? fields["proposed"] === true : capability.proposed,
      contracts: contracts.filter((one) => one.capability === capability.id && !retired.has(one.contract.id)).map(({ contract }) => shown(contract)),
    };
  };
  const stories: StoryNode[] = tree.stories
    .filter((story) => !retired.has(story.id))
    .map((story) => {
      return {
        ...shown(story),
        capabilities: capabilities.filter((one) => one.story === story.id && !retired.has(one.capability.id)).map(({ capability }) => capabilityNode(capability)),
      };
    });
  return { ...(tree.anchor === undefined ? {} : { anchor: { ...tree.anchor } }), stories, arcs: tree.arcs.map((arc) => ({ ...arc, stories: [...arc.stories] })) };
}
