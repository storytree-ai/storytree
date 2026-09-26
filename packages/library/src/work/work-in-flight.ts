/**
 * Capability 10 · Work in flight (stories/library.md, ADR-0640): each arc whole, with its
 * increments. An increment moves proposal → ready → active → closed, only ever forward; closed, it
 * stays as the arc's log entry, with the day it closed, its pull request, its note and whether it
 * landed, failed or was withdrawn. An arc's state is worked out from its increments on every read:
 * closed when none is open, active otherwise or while it has none, and parked, the one state that
 * is stored, while the owner has parked it (10-b). New work parked on a closed arc reopens it (R1).
 *
 * The increment's shape and the rules across its fields (a proposal carries when it was parked; a
 * closed increment its outcome; a close with no pull request a note) are capability 3's, checked
 * inside every write (schema/types.ts). What this layer checks before writing is what a schema
 * cannot see: that the arc, and every story, capability and friction an increment names, is live,
 * and that an increment moves only forward. A refusal throws with nothing written.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords } from "../schema/index.js";
import { INCREMENT_STATUSES, type FieldsOf } from "../schema/types.js";

/** Where an increment is in its lifecycle. */
export type IncrementStatus = (typeof INCREMENT_STATUSES)[number];
/** An arc's state: worked out from its increments, except for the owner's "parked". */
export type ArcState = "active" | "parked" | "closed";
/** How an increment closed. */
export type Disposition = NonNullable<FieldsOf<"increment">["outcome"]>["disposition"];

/** How an increment closes: a pull request, a note, or both, and what the close meant. */
export interface CloseInput {
  readonly pr?: string;
  /** Why it closed. Required when there is no pull request, for an increment that was parked. */
  readonly note?: string;
  readonly disposition: Disposition;
  /** The day it closed (YYYY-MM-DD). Today when omitted. */
  readonly date?: string;
}

/**
 * A new increment: the live arc it belongs to, what it is, and what it touches and remedies. With
 * `outcome` it is born closed, a log entry for work already done; without, it is a proposal.
 */
export interface NewIncrement {
  readonly arc: string;
  readonly title: string;
  readonly objective: string;
  /** The increment itself: its breakdown, in prose. */
  readonly body: string;
  /** The stories and capabilities it touches: each must be live. */
  readonly touches?: string[];
  /** The friction it remedies: each must be live. */
  readonly remedies?: string[];
  readonly outcome?: CloseInput;
}

/** An edit of what an increment is. Its arc, status and outcome move only through their own verbs. */
export interface IncrementEdit {
  readonly title?: string;
  readonly objective?: string;
  readonly body?: string;
  readonly touches?: string[] | undefined;
  readonly remedies?: string[] | undefined;
}

/** An arc whole: its record, its state, and its increments, oldest first. */
export interface ArcView {
  readonly arc: SchemaRecord<"arc">;
  readonly state: ArcState;
  readonly increments: SchemaRecord<"increment">[];
}

/**
 * An increment was asked to move backward, to stay where it is, or on from closed, which is final.
 * The message names the increment, where it is, and where it was asked to go.
 */
export class LifecycleError extends Error {
  readonly id: string;
  readonly from: IncrementStatus;
  readonly to: IncrementStatus;

  constructor(id: string, from: IncrementStatus, to: IncrementStatus) {
    super(
      from === "closed"
        ? `increment ${JSON.stringify(id)} is closed, which is final: it cannot become ${to}`
        : `increment ${JSON.stringify(id)} is ${from}, and moves only forward (${INCREMENT_STATUSES.join(" → ")}): it cannot become ${to}`,
    );
    this.name = "LifecycleError";
    this.id = id;
    this.from = from;
    this.to = to;
  }
}

const TOUCHABLE: Expected = { name: "story or capability", types: ["story", "capability"] };
const EDITABLE: ReadonlySet<string> = new Set(["title", "objective", "body", "touches", "remedies"]);

export class WorkInFlight {
  readonly #records: SchemaRecords;
  /** The last write queued through this layer; the next one starts once it has settled. */
  #lastWrite: Promise<unknown> = Promise.resolve();

  constructor(records: SchemaRecords) {
    this.#records = records;
  }

  /**
   * Add an increment to a live arc (MissingReferenceError otherwise, as for anything it touches or
   * remedies that is not live). It is a proposal, stamped with when it was parked, or, given an
   * `outcome`, born closed.
   */
  addIncrement(increment: NewIncrement): Promise<SchemaRecord<"increment">> {
    return this.#serially(async () => {
      const { outcome, ...fields } = increment;
      await checkReference(this.#records, "arc", fields.arc, "arc");
      await this.#checkNames(fields);
      const lifecycle = outcome === undefined
        ? { status: "proposal" as const, parked: new Date().toISOString() }
        : { status: "closed" as const, outcome: outcomeOf(outcome) };
      return this.#records.create("increment", { ...fields, ...lifecycle });
    });
  }

  /**
   * Move an increment on to `to`, `ready` or `active`, and only forward (LifecycleError otherwise).
   * Null, with nothing written, if `id` is not a live increment.
   */
  advanceIncrement(id: string, to: "ready" | "active"): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      const from = increment.fields.status;
      if (!(to === "ready" || to === "active") || rank(to) <= rank(from)) throw new LifecycleError(id, from, to);
      return (await this.#records.edit(id, { status: to })) as SchemaRecord<"increment"> | null;
    });
  }

  /**
   * Close an increment, recording the day, its pull request, its note and what the close meant. A
   * close with no pull request needs a note (SchemaError); closing a closed one is refused
   * (LifecycleError). Null, with nothing written, if `id` is not a live increment.
   */
  closeIncrement(id: string, close: CloseInput): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status === "closed") throw new LifecycleError(id, "closed", "closed");
      return (await this.#records.edit(id, { status: "closed", outcome: outcomeOf(close) })) as SchemaRecord<"increment"> | null;
    });
  }

  /**
   * Change what an increment is: its title, objective, body, or what it touches and remedies, each
   * checked as addIncrement checks it. Null, with nothing written, if `id` is not a live increment.
   */
  editIncrement(id: string, fields: IncrementEdit): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const other = Object.keys(fields).find((key) => !EDITABLE.has(key));
      if (other !== undefined) {
        throw new RangeError(`editIncrement changes ${[...EDITABLE].join(", ")}, not ${JSON.stringify(other)}: an increment's arc, status and outcome move through their own verbs`);
      }
      if ((await liveRecord(this.#records, id, ["increment"])) === null) return null;
      await this.#checkNames(fields);
      return (await this.#records.edit(id, fields)) as SchemaRecord<"increment"> | null;
    });
  }

  /** Park an arc: it reads parked, whatever its work, until unparked. Null if `id` is not a live arc. */
  parkArc(id: string): Promise<SchemaRecord<"arc"> | null> {
    return this.#setParked(id, true);
  }

  /** Unpark an arc: its state is worked out from its increments again. Null if `id` is not a live arc. */
  unparkArc(id: string): Promise<SchemaRecord<"arc"> | null> {
    return this.#setParked(id, undefined);
  }

  /** The arc whole, with its state and its increments, oldest first; null if `id` is not a live arc. */
  async arcView(id: string): Promise<ArcView | null> {
    const arc = await liveRecord(this.#records, id, ["arc"]);
    if (arc === null) return null;
    const increments = (await this.#records.list("increment")).filter((increment) => increment.fields.arc === id).sort(byCreation);
    return { arc, state: arcState(arc, increments), increments };
  }

  #setParked(id: string, parked: true | undefined): Promise<SchemaRecord<"arc"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["arc"])) === null) return null;
      return (await this.#records.edit(id, { parked })) as SchemaRecord<"arc"> | null;
    });
  }

  /** What an increment touches must be live stories or capabilities, and what it remedies live friction (10-a). */
  async #checkNames(fields: { readonly touches?: unknown; readonly remedies?: unknown }): Promise<void> {
    await checkReferences(this.#records, "touches", fields.touches, TOUCHABLE);
    await checkReferences(this.#records, "remedies", fields.remedies, "friction");
  }

  /** Run `write` once every write queued through this layer before it has settled, so its checks and its write happen together. */
  #serially<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#lastWrite.then(() => write());
    this.#lastWrite = result.catch(() => undefined);
    return result;
  }
}

/**
 * An arc's state (10.3): parked while the owner has parked it; otherwise closed exactly when it has
 * increments and none of them is open, and active while any is, or while it has none yet.
 */
function arcState(arc: SchemaRecord<"arc">, increments: readonly SchemaRecord<"increment">[]): ArcState {
  if (arc.fields.parked === true) return "parked";
  if (increments.length === 0) return "active";
  return increments.some((increment) => increment.fields.status !== "closed") ? "active" : "closed";
}

/** Where `status` sits in the lifecycle. */
function rank(status: string): number {
  return (INCREMENT_STATUSES as readonly string[]).indexOf(status);
}

/** The outcome a close stores: today unless a day is given, and only the parts given. */
function outcomeOf(close: CloseInput): NonNullable<FieldsOf<"increment">["outcome"]> {
  return {
    date: close.date ?? new Date().toISOString().slice(0, 10),
    ...(close.pr === undefined ? {} : { pr: close.pr }),
    ...(close.note === undefined ? {} : { note: close.note }),
    disposition: close.disposition,
  };
}
