/**
 * Capability 10 · Work in flight (the library story): the waits an arc or increment stores on other
 * work, written as the arc record is, by one capability (ADR-1242 D2). An arc waits on an arc or an
 * increment, and an increment on an increment, on any arc, or on a capability's claim, each with a
 * reason, and a wait that would close a loop across arcs and increments is refused when it is
 * written (10.32). A wait whose blocker lands (an increment) or closes (an arc) is cleared in the same
 * step, so no stored wait is stale (10.33, ADR-0975). Whether a stored wait still holds is capability 11's (waits.ts).
 *
 * WorkInFlight serializes each write and reads the project's open work once.
 */
import { checkReference, liveRecord } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { Wait } from "./waits.js";

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

/** Stop `waiter` waiting on `blocker`. Null, with nothing written, if `waiter` is not a live arc or increment. */
export async function removeWait(records: SchemaRecords, waiter: string, blocker: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
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
