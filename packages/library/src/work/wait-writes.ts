/**
 * Capability 10 · Work in flight (the library story): the waits and holds an arc or increment stores,
 * written as the arc and increment records are, by one capability (ADR-1242 D2): its waits on other
 * work, an increment's waits for the owner or an outside event (10.36-10.38), and the questions it is
 * held on, released when a question is settled or retired (10.39, 10.40). An arc waits on an arc or an
 * increment, and an increment on an increment, on any arc, or on a capability's claim, each with a
 * reason; a wait that would close a loop across arcs and increments is refused when it is
 * written (10.32). A wait whose blocker lands (an increment) or closes (an arc) is cleared in the same
 * step, so no stored wait is stale (10.33, ADR-0975). Whether a stored wait or hold still holds is
 * capability 11's (waits.ts), and whether a question is open capability 12's (owner-questions.ts).
 *
 * WorkInFlight serializes each write and reads the project's open work once.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, liveRecord } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { Wait, WaitFor } from "./waits.js";

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

/** What an arc may wait on (10.34): an arc, or an increment, whose landing releases it. */
const ARC_BLOCKER = { name: "arc or increment", types: ["arc", "increment"] } as const;

/** What an increment may wait on: an increment, whose landing releases it, or a capability, whose claim's release does (11.12). */
const INCREMENT_BLOCKER = { name: "increment or capability", types: ["increment", "capability"] } as const;

/** The open work a loop is looked for in: its arcs and open increments, as one reading gives them. */
export interface WaitGraph {
  readonly arcs: ReadonlyMap<string, { readonly fields: { readonly waits?: readonly Wait[] | undefined } }>;
  readonly increments: ReadonlyMap<string, { readonly fields: { readonly arc: string; readonly status: string; readonly waits?: readonly Wait[] | undefined } }>;
  /** The arc's open increments, oldest first. */
  openIncrementsOf(arc: string): readonly { readonly id: string }[];
}

/**
 * Make `waiter` wait on `blocker`, with a reason: an arc on a live arc or increment (10.34), an
 * increment on a live increment, on any arc, or on a live capability's claim (11.12; MissingReferenceError otherwise). Waiting again on the same blocker replaces
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
  await checkReference(records, "on", blocker, record.type === "arc" ? ARC_BLOCKER : INCREMENT_BLOCKER);
  const stored: readonly Wait[] = record.fields.waits ?? [];
  const waits = stored.some((wait) => wait.on === blocker)
    ? stored.map((wait) => (wait.on === blocker ? { on: blocker, reason } : wait))
    : [...stored, { on: blocker, reason }];
  refuseLoop(await read(), waiter, waits);
  return (await records.edit(waiter, { waits }, options)) as SchemaRecord<"arc" | "increment"> | null;
}

/** How a wait is cleared: by whom, and why, which the record's history keeps with the clear. */
export type ClearOptions = WriteOptions & { readonly reason?: string };

/** Stop `waiter` waiting on `blocker`. Null, with nothing written, if `waiter` is not a live arc or increment. */
export async function removeWait(records: SchemaRecords, waiter: string, blocker: string, options?: ClearOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
  const record = await liveRecord(records, waiter, ["arc", "increment"]);
  if (record === null) return null;
  const waits = (record.fields.waits ?? []).filter((wait) => wait.on !== blocker);
  return (await records.edit(waiter, { waits: waits.length === 0 ? undefined : waits }, options)) as SchemaRecord<"arc" | "increment"> | null;
}

/**
 * Clear every stored wait on `blocker`, an arc or increment as `kind` says, which has landed (an increment) or closed (an arc), so no
 * wait is ever stale (10.33): from each arc that waits on it, and, for an increment, each open increment. Each waiter's
 * history keeps the cleared wait, with `reason`. The ids of the waiters cleared.
 */
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

/**
 * A wait for the owner or an event as a writer gives it (10.37): the review day is the library's to
 * stamp, and re-writing an owner wait may leave out its note, why or rank to keep the stored ones.
 */
export type WaitWrite = Omit<WaitFor, "note" | "reviewed" | "merged"> & { readonly note?: string };

/**
 * Make an open increment wait for the owner or an outside event, with a note (10.36, ADR-0938 D1).
 * Waiting again for the same releaser replaces it; an owner wait written again keeps the note, why
 * and rank it is not given, and is stamped read again today (10.37). An event wait needs a check-back
 * day, not before today (UTC); an owner wait takes none and needs a why; a closed increment waits
 * for nothing: each a RangeError, with nothing written. Null, with nothing written, if `id` is not a
 * live increment.
 */
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

/**
 * A wait for the owner or an event as it may be written (RangeError otherwise): an event's with a
 * check-back day not before today and no why or rank, an owner's with no day, a why (what it
 * protects or unblocks) and any rank a whole number from 1, stamped read again today (10.37).
 */
export function checkedWaitFor({ releaser, note, checkBack, why, rank }: WaitWrite & { readonly note: string }): WaitFor {
  const today = new Date().toISOString().slice(0, 10);
  if (releaser === "event" && checkBack === undefined) throw new RangeError("an event wait needs a check-back day (YYYY-MM-DD)");
  if (releaser === "owner" && checkBack !== undefined) throw new RangeError("an owner wait takes no check-back day: it holds until it is cleared");
  if (checkBack !== undefined && checkBack < today) throw new RangeError(`check-back day ${checkBack} is before today`);
  if (releaser === "event") {
    if (why !== undefined || rank !== undefined) throw new RangeError("only an owner wait carries a why or a rank");
    return { releaser, note, checkBack: checkBack! };
  }
  if (why === undefined || why.trim() === "") throw new RangeError("an owner wait needs a why: what it protects or unblocks, in a line");
  if (rank !== undefined && (!Number.isInteger(rank) || rank < 1)) throw new RangeError(`a rank is a whole number from 1 (1 first), not ${rank}`);
  return { releaser, note, why, ...(rank === undefined ? {} : { rank }), reviewed: today };
}

/**
 * Stop an increment waiting for `releaser`. Given `merged`, the pull request it was handed over with that has merged,
 * its owner wait, if it has one, carries that pull request from the same write, so the audit asks for it to be read
 * again; writing the owner wait again drops it (10.38). Null, with nothing written, if `id` is not a live increment.
 */
export async function removeWaitFor(records: SchemaRecords, id: string, releaser: WaitFor["releaser"], options?: ClearOptions, { merged }: { readonly merged?: number } = {}): Promise<SchemaRecord<"increment"> | null> {
  const increment = await liveRecord(records, id, ["increment"]);
  if (increment === null) return null;
  const waitsFor = (increment.fields.waitsFor ?? [])
    .filter((one) => one.releaser !== releaser)
    .map((one) => (merged !== undefined && one.releaser === "owner" ? { ...one, merged } : one));
  return (await records.edit(id, { waitsFor: waitsFor.length === 0 ? undefined : waitsFor }, options)) as SchemaRecord<"increment"> | null;
}

/**
 * Release each open increment whose event wait is about contract `contract` (10.44): one that links it or lists its
 * `capability`. Its event wait is cleared and `verdict` written at the top of its body, in one write whose history keeps
 * `verdict` as the reason; its other waits stay. The ids of the increments released, oldest first.
 */
export async function releaseOnVerdict(records: SchemaRecords, contract: string, capability: string | undefined, verdict: string, options?: WriteOptions): Promise<string[]> {
  const open = await records.select("increment", ["body", "links", "capabilities", "waitsFor"], { not: { status: "closed" } });
  const about = open
    .filter(({ fields }) => fields.waitsFor?.some((wait) => wait.releaser === "event") === true)
    .filter(({ fields }) => fields.links?.includes(contract) === true || (capability !== undefined && fields.capabilities?.includes(capability) === true))
    .sort(byCreation);
  for (const { id, fields } of about) {
    const event = fields.waitsFor!.find((wait) => wait.releaser === "event")!;
    const rest = fields.waitsFor!.filter((wait) => wait !== event);
    const body = `${verdict} That released its event wait, "${event.note}" (check-back ${event.checkBack}).\n\n${fields.body}`;
    await records.edit(id, { body, waitsFor: rest.length === 0 ? undefined : rest }, { ...options, reason: verdict });
  }
  return about.map(({ id }) => id);
}

/**
 * Take question `id` off the heldOn of every increment that names it, open or closed, keeping their
 * other holds, as the question is settled (10.39) or retired (10.40); the increments released, oldest first.
 */
export async function releaseHolders(records: SchemaRecords, id: string, options?: WriteOptions): Promise<string[]> {
  const heldBy = (await records.list("increment")).filter((increment) => increment.fields.heldOn?.includes(id) === true).sort(byCreation);
  for (const increment of heldBy) {
    const rest = (increment.fields.heldOn ?? []).filter((held) => held !== id);
    await records.edit(increment.id, { heldOn: rest.length === 0 ? undefined : rest }, options);
  }
  return heldBy.map((increment) => increment.id);
}

/**
 * Throw a WaitLoopError if `waiter` waiting on `waits` would close a loop. The graph is arc and
 * increment waits as one: an arc waits on the arcs it names, and cannot close until each
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
