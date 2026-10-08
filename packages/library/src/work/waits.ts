/**
 * Capability 11 · Waits (the library story): an arc waits on an arc, and an increment on an increment
 * on any arc, each with a reason, and a wait that would close a loop across both kinds is refused when
 * it is written. An open increment can also wait for the owner or an outside event, with a note (11.6).
 * waitHolds is the one answer to whether a wait still holds.
 *
 * WorkInFlight (capability 10) serializes each write and reads the project's open work once; the
 * rules for what a wait stores, when it holds and when it would close a loop are here.
 */
import { checkReference, liveRecord } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { FieldsOf } from "../schema/types.js";

/** A blocker still holding a wait (capability 11). */
export interface Hold {
  /** The arc or increment waited on. */
  readonly on: string;
  readonly reason: string;
  /**
   * True when it can never release: the blocking increment closed without landing (failed or
   * withdrawn), or the blocker is missing or retired (11-a).
   */
  readonly forGood: boolean;
}

/** What an increment waits for outside the library, as stored (11.6, ADR-0938 D1). */
export type WaitFor = NonNullable<FieldsOf<"increment">["waitsFor"]>[number];

/**
 * A wait for the owner or an outside event as read at one moment (11.6): an owner wait holds until
 * it is cleared; an event wait holds until UTC midnight of its check-back day, and from then no
 * longer holds, its check-back passed.
 */
export interface NoteWait {
  readonly releaser: WaitFor["releaser"];
  readonly note: string;
  readonly checkBack?: string;
  readonly holds: boolean;
}

/**
 * Every hold on a project's open work at once (11.5): each live arc's and open increment's wait holds,
 * each open increment's owner holds, and each open increment's waits for the owner or an event,
 * keyed by id, each as waitHolds, heldOnQuestion and waitsFor give it.
 */
export interface Holds {
  /** Closed increments have no holds and are omitted. */
  readonly waits: Readonly<Record<string, Hold[]>>;
  readonly heldOn: Readonly<Record<string, string[]>>;
  /**
   * An event wait whose check-back has passed is kept, reading as no longer holding. The library
   * always gives it; it is optional so a reader built before it (or a stand-in) still fits.
   */
  readonly waitsFor?: Readonly<Record<string, NoteWait[]>>;
}

/**
 * A wait would close a loop: the work would wait on itself, directly or through other arcs and
 * increments. The message names the loop, from the work the loop was found at back round to it.
 */
export class WaitLoopError extends Error {
  /** The arc and increment ids around the loop, starting and ending with the same one. */
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`wait loop: ${path.join(" → ")} (work may not wait on itself, directly or through other arcs and increments)`);
    this.name = "WaitLoopError";
    this.path = [...path];
  }
}

/** One wait, as an arc or increment stores it. */
export type Wait = { readonly on: string; readonly reason: string };

/** The open work a loop is looked for in: its arcs and open increments, as one reading gives them. */
export interface WaitGraph {
  readonly arcs: ReadonlyMap<string, { readonly fields: { readonly waits?: readonly Wait[] | undefined } }>;
  readonly increments: ReadonlyMap<string, { readonly fields: { readonly arc: string; readonly status: string; readonly waits?: readonly Wait[] | undefined } }>;
  /** The arc's open increments, oldest first. */
  openIncrementsOf(arc: string): readonly { readonly id: string }[];
}

/**
 * Make `waiter` wait on `blocker`, with a reason: an arc on a live arc, an increment on a live
 * increment on any arc (MissingReferenceError otherwise). Waiting again on the same blocker replaces
 * the reason. A wait that would close a loop in the work `read` gives is refused with a WaitLoopError
 * naming it. Null, with nothing written, if `waiter` is not a live arc or increment.
 */
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
  await checkReference(records, "on", blocker, record.type);
  const stored: readonly Wait[] = record.fields.waits ?? [];
  const waits = stored.some((wait) => wait.on === blocker)
    ? stored.map((wait) => (wait.on === blocker ? { on: blocker, reason } : wait))
    : [...stored, { on: blocker, reason }];
  refuseLoop(await read(), waiter, waits);
  return (await records.edit(waiter, { waits }, options)) as SchemaRecord<"arc" | "increment"> | null;
}

/** Stop `waiter` waiting on `blocker`. Null, with nothing written, if `waiter` is not a live arc or increment. */
export async function removeWait(records: SchemaRecords, waiter: string, blocker: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
  const record = await liveRecord(records, waiter, ["arc", "increment"]);
  if (record === null) return null;
  const waits = (record.fields.waits ?? []).filter((wait) => wait.on !== blocker);
  return (await records.edit(waiter, { waits: waits.length === 0 ? undefined : waits }, options)) as SchemaRecord<"arc" | "increment"> | null;
}

/**
 * Make an open increment wait for the owner or an outside event, with a note (11.6, ADR-0938 D1).
 * Waiting again for the same releaser replaces it. An event wait needs a check-back day, not
 * before today (UTC); an owner wait takes none; a closed increment waits for nothing: each a
 * RangeError, with nothing written. Null, with nothing written, if `id` is not a live increment.
 */
export async function addWaitFor(records: SchemaRecords, id: string, wait: WaitFor, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  if (increment === null) return null;
  const { releaser, note, checkBack } = wait;
  if (increment.fields.status === "closed") throw new RangeError(`increment ${JSON.stringify(id)} is closed, and waits for nothing`);
  if (releaser === "event" && checkBack === undefined) throw new RangeError("an event wait needs a check-back day (YYYY-MM-DD)");
  if (releaser === "owner" && checkBack !== undefined) throw new RangeError("an owner wait takes no check-back day: it holds until it is cleared");
  if (checkBack !== undefined && checkBack < new Date().toISOString().slice(0, 10)) throw new RangeError(`check-back day ${checkBack} is before today`);
  const written: WaitFor = { releaser, note, ...(checkBack === undefined ? {} : { checkBack }) };
  const stored = increment.fields.waitsFor ?? [];
  const waitsFor = stored.some((one) => one.releaser === releaser)
    ? stored.map((one) => (one.releaser === releaser ? written : one))
    : [...stored, written];
  return (await records.edit(id, { waitsFor }, options)) as SchemaRecord<"increment"> | null;
}

/** Stop an increment waiting for `releaser`. Null, with nothing written, if `id` is not a live increment. */
export async function removeWaitFor(records: SchemaRecords, id: string, releaser: WaitFor["releaser"], options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  if (increment === null) return null;
  const waitsFor = (increment.fields.waitsFor ?? []).filter((one) => one.releaser !== releaser);
  return (await records.edit(id, { waitsFor: waitsFor.length === 0 ? undefined : waitsFor }, options)) as SchemaRecord<"increment"> | null;
}

/**
 * What an open increment waits for outside the library, read at `at` (11.6), in the order written:
 * each with whether it still holds. Empty for a closed increment and for an id that is not a live one.
 */
export async function waitsFor(records: SchemaRecords, id: string, at: Date): Promise<NoteWait[]> {
  const increment = await liveRecord(records, id, ["increment"]);
  return increment === null || increment.fields.status === "closed" ? [] : noteWaits(increment.fields.waitsFor, at);
}

/** Each wait for the owner or an event, read at `at`: an event's no longer holds from UTC midnight of its check-back day (11.6). */
export function noteWaits(waitsFor: readonly WaitFor[] | undefined, at: Date): NoteWait[] {
  return (waitsFor ?? []).map(({ releaser, note, checkBack }) => ({
    releaser,
    note,
    ...(checkBack === undefined ? {} : { checkBack }),
    holds: checkBack === undefined || at.getTime() < Date.parse(`${checkBack}T00:00:00Z`),
  }));
}

/** The holds among `waits`, in order: each wait that `hold` says still holds. */
export function holdsOf(waits: readonly Wait[] | undefined, hold: (wait: Wait) => Hold | undefined): Hold[] {
  return (waits ?? []).flatMap((wait) => {
    const held = hold(wait);
    return held === undefined ? [] : [{ on: held.on, reason: held.reason, forGood: held.forGood }];
  });
}

/**
 * Whether an arc wait holds (11.2, 11-a): until the arc closes, and for good if the arc is missing
 * (`closed` undefined).
 */
export function arcHold(wait: Wait, closed: boolean | undefined): Hold | undefined {
  if (closed === undefined) return { ...wait, forGood: true };
  return closed ? undefined : { ...wait, forGood: false };
}

/**
 * Whether an increment wait holds (11.1, 11-a): until the blocker closes as landed, and for good if
 * it closed any other way or is missing (it is not among the open increments).
 */
export function incrementHold(wait: Wait, landed: boolean, open: boolean): Hold | undefined {
  return landed ? undefined : { ...wait, forGood: !open };
}

/**
 * Throw a WaitLoopError if `waiter` waiting on `waits` would close a loop. The graph is arc and
 * increment waits as one (11-b): an arc waits on the arcs it names, and cannot close until each
 * of its open increments has; an open increment waits on the increments it names, and on the
 * arcs its arc waits on. A closed increment waits on nothing and holds up nothing, and it never
 * reopens, so it can be in no loop. The loop is looked for from the waiter, and, for an arc, from
 * each of its open increments, oldest first, since their waits change with it.
 */
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

/**
 * A path along `next`'s edges from `start` back round to `start`, or undefined if there is none.
 * Depth-first, following each node's edges in order, so the same loop is reported every time;
 * iterative, so a long chain cannot overflow the stack.
 */
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
