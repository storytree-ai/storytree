// Capability 10 · Work in flight
import { byCreation } from "../creation-order.js";
import { checkReference, liveRecord } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { FieldsOf } from "../schema/index.js";
import type { Wait, WaitFor } from "./waits.js";

export class WaitLoopError extends Error {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`wait loop: ${path.join(" → ")} (work may not wait on itself, directly or through other arcs and increments)`);
    this.name = "WaitLoopError";
    this.path = [...path];
  }
}

const ARC_BLOCKER = { name: "arc or increment", types: ["arc", "increment"] } as const;

export const INCREMENT_BLOCKER = { name: "increment or capability", types: ["increment", "capability"] } as const;

export interface WaitGraph {
  readonly arcs: ReadonlyMap<string, { readonly fields: { readonly waits?: readonly Wait[] | undefined } }>;
  readonly increments: ReadonlyMap<string, { readonly fields: { readonly arc: string; readonly status: string; readonly waits?: readonly Wait[] | undefined } }>;
  openIncrementsOf(arc: string): readonly { readonly id: string }[];
}

export async function addWait(
  records: SchemaRecords,
  read: () => Promise<WaitGraph>,
  waiter: string,
  blocker: string,
  reason: string,
  options?: WriteOptions,
): Promise<SchemaRecord<"arc" | "increment"> | null> {
  const record = await liveRecord(records, waiter, ["arc", "increment"]);
  if (record === null) return null;
  await checkReference(records, "on", blocker, record.type === "arc" ? ARC_BLOCKER : INCREMENT_BLOCKER);
  const stored: readonly Wait[] = record.fields.waits ?? [];
  const waits = stored.some((wait) => wait.on === blocker)
    ? stored.map((wait) => (wait.on === blocker ? { on: blocker, reason } : wait))
    : [...stored, { on: blocker, reason }];
  refuseLoop(await read(), waiter, waits);
  return (await records.edit(waiter, { waits }, options)) as SchemaRecord<"arc" | "increment"> | null;
}

export type ClearOptions = WriteOptions & { readonly reason?: string };

export async function removeWait(records: SchemaRecords, waiter: string, blocker: string, options?: ClearOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
  const record = await liveRecord(records, waiter, ["arc", "increment"]);
  if (record === null) return null;
  const waits = (record.fields.waits ?? []).filter((wait) => wait.on !== blocker);
  return (await records.edit(waiter, { waits: waits.length === 0 ? undefined : waits }, options)) as SchemaRecord<"arc" | "increment"> | null;
}

export async function clearWaitsOn(records: SchemaRecords, kind: "arc" | "increment", blocker: string, reason: string, options?: WriteOptions): Promise<string[]> {
  const waiters = [
    ...await records.select("arc", ["waits"]),
    ...kind === "arc" ? [] : await records.select("increment", ["waits"], { not: { status: "closed" } }),
  ];
  const cleared: string[] = [];
  for (const { id, fields } of waiters) {
    const stored: readonly Wait[] = fields.waits ?? [];
    if (!stored.some((wait) => wait.on === blocker)) continue;
    const waits = stored.filter((wait) => wait.on !== blocker);
    await records.edit(id, { waits: waits.length === 0 ? undefined : waits }, { ...options, reason });
    cleared.push(id);
  }
  return cleared;
}

export type WaitWrite = Omit<WaitFor, "note" | "reviewed" | "merged"> & { readonly note?: string };

export async function addWaitFor(records: SchemaRecords, id: string, wait: WaitWrite, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  if (increment === null) return null;
  if (increment.fields.status === "closed") throw new RangeError(`increment ${JSON.stringify(id)} is closed, and waits for nothing`);
  const stored = increment.fields.waitsFor ?? [];
  const had = wait.releaser === "owner" ? stored.find((one) => one.releaser === "owner") : undefined;
  const { note, why, rank } = { ...had, ...Object.fromEntries(Object.entries(wait).filter(([, value]) => value !== undefined)) } as WaitWrite;
  if (note === undefined) throw new RangeError(`a wait for ${wait.releaser === "owner" ? "the owner" : "an event"} needs a note saying what`);
  const written = checkedWaitFor({ releaser: wait.releaser, note, ...(wait.checkBack === undefined ? {} : { checkBack: wait.checkBack }), ...(why === undefined ? {} : { why }), ...(rank === undefined ? {} : { rank }) });
  const waitsFor = stored.some((one) => one.releaser === written.releaser)
    ? stored.map((one) => (one.releaser === written.releaser ? written : one))
    : [...stored, written];
  return (await records.edit(id, { waitsFor }, options)) as SchemaRecord<"increment"> | null;
}

export function checkedWaitFor({ releaser, note, checkBack, why, rank }: WaitWrite & { readonly note: string }): WaitFor {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  if (releaser === "event" && checkBack === undefined) throw new RangeError("an event wait needs a check-back day (YYYY-MM-DD)");
  if (releaser === "owner" && checkBack !== undefined) throw new RangeError("an owner wait takes no check-back day: it holds until it is cleared");
  if (checkBack !== undefined && checkBack < today) throw new RangeError(`check-back day ${checkBack} is before today`);
  if (releaser === "event") {
    if (why !== undefined || rank !== undefined) throw new RangeError("only an owner wait carries a why or a rank");
    return { releaser, note, checkBack: checkBack! };
  }
  if (why === undefined || why.trim() === "") throw new RangeError("an owner wait needs a why: what it protects or unblocks, in a line");
  if (rank !== undefined && (!Number.isInteger(rank) || rank < 1)) throw new RangeError(`a rank is a whole number from 1 (1 first), not ${rank}`);
  return { releaser, note, why, ...(rank === undefined ? {} : { rank }), reviewed: now };
}

export async function removeWaitFor(records: SchemaRecords, id: string, releaser: WaitFor["releaser"], options?: ClearOptions, { merged }: { readonly merged?: number } = {}): Promise<SchemaRecord<"increment"> | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  if (increment === null) return null;
  const waitsFor = (increment.fields.waitsFor ?? [])
    .filter((one) => one.releaser !== releaser)
    .map((one) => (merged !== undefined && one.releaser === "owner" ? { ...one, merged } : one));
  return (await records.edit(id, { waitsFor: waitsFor.length === 0 ? undefined : waitsFor }, options)) as SchemaRecord<"increment"> | null;
}

export async function releaseOnVerdict(records: SchemaRecords, contract: string, capability: string | undefined, verdict: string, options?: WriteOptions, asOf?: number): Promise<string[]> {
  const open = await records.select("increment", ["body", "links", "capabilities", "waitsFor"], { not: { status: "closed" } });
  const waiting = open
    .filter(({ fields }) => fields.waitsFor?.some((wait) => wait.releaser === "event") === true)
    .filter(({ fields }) => fields.links?.includes(contract) === true || (capability !== undefined && fields.capabilities?.includes(capability) === true))
    .sort(byCreation);
  const stood = asOf === undefined ? waiting.map(() => true) : await Promise.all(waiting.map(({ id, fields }) => stoodSince(records, id, eventWaitOf(fields.waitsFor), asOf)));
  const about = waiting.filter((_, index) => stood[index]);
  for (const { id, fields } of about) {
    const event = fields.waitsFor!.find((wait) => wait.releaser === "event")!;
    const rest = fields.waitsFor!.filter((wait) => wait !== event);
    const body = `${verdict} That released its event wait, "${event.note}" (check-back ${event.checkBack}).\n\n${fields.body}`;
    await records.edit(id, { body, waitsFor: rest.length === 0 ? undefined : rest }, { ...options, reason: verdict });
  }
  return about.map(({ id }) => id);
}

function eventWaitOf(waitsFor: readonly WaitFor[] | undefined): string | undefined {
  const event = waitsFor?.find((wait) => wait.releaser === "event");
  return event === undefined ? undefined : `${event.note}\n${event.checkBack}`;
}

async function stoodSince(records: SchemaRecords, id: string, event: string | undefined, asOf: number): Promise<boolean> {
  const [[then], since] = await Promise.all([records.history({ id, upTo: asOf, newest: 1 }), records.history({ id, since: asOf })]);
  if (then === undefined) return false;
  return [then, ...since].every((change) => eventWaitOf((records.current(change.record).fields as FieldsOf<"increment">).waitsFor) === event);
}

export async function releaseHolders(records: SchemaRecords, id: string, options?: WriteOptions): Promise<SchemaRecord<"increment">[]> {
  const heldBy = (await records.list("increment")).filter((increment) => increment.fields.heldOn?.includes(id) === true).sort(byCreation);
  for (const increment of heldBy) {
    const rest = (increment.fields.heldOn ?? []).filter((held) => held !== id);
    await records.edit(increment.id, { heldOn: rest.length === 0 ? undefined : rest }, options);
  }
  return heldBy;
}

function refuseLoop(work: WaitGraph, waiter: string, waits: readonly Wait[]): void {
  const waitsOf = (id: string): readonly Wait[] =>
    id === waiter ? waits : (work.arcs.get(id)?.fields.waits ?? work.increments.get(id)?.fields.waits ?? []);
  const next = (id: string): string[] => {
    if (work.arcs.has(id)) return [...waitsOf(id).map(({ on }) => on), ...work.openIncrementsOf(id).map((open) => open.id)];
    const increment = work.increments.get(id);
    if (increment === undefined || increment.fields.status === "closed") return [];
    return [...waitsOf(id), ...waitsOf(increment.fields.arc)].map(({ on }) => on);
  };
  const starts = [waiter, ...(work.arcs.has(waiter) ? work.openIncrementsOf(waiter).map((open) => open.id) : [])];
  for (const start of starts) {
    const loop = loopThrough(start, next);
    if (loop !== undefined) throw new WaitLoopError(loop);
  }
}

function loopThrough(start: string, next: (id: string) => readonly string[]): string[] | undefined {
  const path = [{ id: start, next: next(start).values() }];
  const reached = new Set([start]);
  for (let step = path.at(-1); step !== undefined; step = path.at(-1)) {
    const edge = step.next.next();
    if (edge.done === true) {
      path.pop();
      continue;
    }
    if (edge.value === start) return [...path.map(({ id }) => id), start];
    if (reached.has(edge.value)) continue;
    reached.add(edge.value);
    path.push({ id: edge.value, next: next(edge.value).values() });
  }
  return undefined;
}
