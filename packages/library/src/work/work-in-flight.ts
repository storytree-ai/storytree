/**
 * Capability 10 · Work in flight (the library story, ADR-0640): each arc whole, with its
 * increments. An increment moves proposal → active → closed, only ever forward (its ready step is retired, ADR-0909 D4); closed, it
 * stays as the arc's log entry, with the day it closed, its pull request, its note and whether it
 * landed, failed or was withdrawn. An arc's state is worked out from its increments on every read:
 * closed when none is open, active otherwise or while it has none, and parked, the one state that
 * is stored, while the owner has parked it (10-b). New work parked on a closed arc reopens it (R1).
 *
 * WorkInFlight is also the one door to waits (capability 11, waits.ts) and owner questions
 * (capability 12, owner-questions.ts): it queues their writes behind its own, and reads the
 * project's open work once for each.
 *
 * The increment's shape and the rules across its fields (a proposal carries when it was parked; a
 * closed increment its outcome; a close with no pull request a note) are capability 3's, checked
 * inside every write (schema/types.ts). What this layer checks before writing is what a schema
 * cannot see: that the arc, and every capability, link and friction an increment names, is live,
 * and that an increment moves only forward. A refusal throws with nothing written.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import { INCREMENT_STATUSES, type FieldsOf } from "../schema/types.js";
import * as questions from "./owner-questions.js";
import { heldOnOpen, type NewQuestion, type QuestionEdit, type QuestionLease, type Settlement } from "./owner-questions.js";
import * as waits from "./waits.js";
import { arcHold, holdsOf, incrementHold, noteWaits, type Hold, type Holds, type NoteWait, type Wait, type WaitFor } from "./waits.js";

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
 * A new increment: the live arc it belongs to, what it is, the capabilities it changes (parked
 * empty by default, ADR-0949 D2), what it links to and what it remedies. With
 * `outcome` it is born closed, a log entry for work already done; without, it is a proposal.
 */
export interface NewIncrement {
  readonly arc: string;
  readonly title: string;
  readonly objective: string;
  /** The increment itself: its breakdown, in prose. */
  readonly body: string;
  /** The capabilities it changes, its lock list (ADR-0949 D2): each must be a live capability. */
  readonly capabilities?: string[];
  /** Anything else it cites, such as its stories, notes or decisions: each must be live. */
  readonly links?: string[];
  /** The friction it remedies: each must be live. */
  readonly remedies?: string[];
  /** The open questions it is held on (capability 12): each must be a live question. */
  readonly heldOn?: string[];
  readonly outcome?: CloseInput;
}

/** An edit of what an increment is. Its arc, status and outcome move only through their own verbs. */
export interface IncrementEdit {
  readonly title?: string;
  readonly objective?: string;
  readonly body?: string;
  readonly capabilities?: string[] | undefined;
  readonly links?: string[] | undefined;
  readonly remedies?: string[] | undefined;
  readonly heldOn?: string[] | undefined;
}

/** How to park an arc: a write's options, and the day it wakes (YYYY-MM-DD, UTC), if it has one. */
export interface ParkOptions extends WriteOptions {
  readonly until?: string;
}

/** An arc whole: its record, its state, its increments and its questions, oldest first. */
export interface ArcView {
  readonly arc: SchemaRecord<"arc">;
  readonly state: ArcState;
  /** While it reads parked until a day, that day: the owner's (10.6), or the earliest check-back its work waits for (10.10). */
  readonly wakes?: string;
  readonly increments: SchemaRecord<"increment">[];
  /** Its questions, open and settled. */
  readonly questions: SchemaRecord<"question">[];
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

const EDITABLE: ReadonlySet<string> = new Set(["title", "objective", "body", "capabilities", "links", "remedies", "heldOn"]);

export class WorkInFlight {
  readonly #records: SchemaRecords;
  /** The last write queued through this layer; the next one starts once it has settled. */
  #lastWrite: Promise<unknown> = Promise.resolve();

  constructor(records: SchemaRecords) {
    this.#records = records;
  }

  /**
   * Add an increment to a live arc (MissingReferenceError otherwise, as for any capability, link or
   * remedies that is not live). It is a proposal, stamped with when it was parked, or, given an
   * `outcome`, born closed.
   */
  addIncrement(increment: NewIncrement, options?: WriteOptions): Promise<SchemaRecord<"increment">> {
    return this.#serially(async () => {
      const { outcome, ...fields } = increment;
      await checkReference(this.#records, "arc", fields.arc, "arc");
      await this.#checkNames(fields);
      const lifecycle = outcome === undefined
        ? { status: "proposal" as const, parked: new Date().toISOString() }
        : { status: "closed" as const, outcome: outcomeOf(outcome) };
      return this.#records.create("increment", { ...fields, ...lifecycle }, options);
    });
  }

  /**
   * Start an increment: move it on to `active`, and only forward (LifecycleError otherwise).
   * Null, with nothing written, if `id` is not a live increment.
   */
  advanceIncrement(id: string, to: "active", options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      const from = increment.fields.status;
      if (to !== "active" || rank(to) <= rank(from)) throw new LifecycleError(id, from, to);
      return (await this.#records.edit(id, { status: to }, options)) as SchemaRecord<"increment"> | null;
    });
  }

  /**
   * Return an active increment to proposal, keeping the day it was parked: the one step back, for
   * work whose last claim ended without closing it (10.9). Whether anyone still holds it is the
   * caller's to know. Anything but active is refused (LifecycleError). Null, with nothing written, if
   * `id` is not a live increment.
   */
  returnIncrement(id: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status !== "active") throw new LifecycleError(id, increment.fields.status, "proposal");
      const parked = increment.fields.parked ?? new Date().toISOString();
      return (await this.#records.edit(id, { status: "proposal", parked }, options)) as SchemaRecord<"increment"> | null;
    });
  }

  /**
   * Close an increment, recording the day, its pull request, its note and what the close meant. A
   * close with no pull request needs a note (SchemaError); closing a closed one is refused
   * (LifecycleError). Null, with nothing written, if `id` is not a live increment. In the same step
   * the waits on it are cleared if it landed, and the waits on its arc if that now reads closed (11.8);
   * a failed or withdrawn close leaves its waits, holding for good, since the work did not arrive.
   */
  closeIncrement(id: string, close: CloseInput, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status === "closed") throw new LifecycleError(id, "closed", "closed");
      const closed = (await this.#records.edit(id, { status: "closed", outcome: outcomeOf(close) }, options)) as SchemaRecord<"increment"> | null;
      await this.#clearAfter(async () => {
        if (close.disposition === "landed") await waits.clearWaitsOn(this.#records, "increment", id, `its blocker ${id} landed, so the wait on it is cleared`, options);
        await this.#clearIfClosed(increment.fields.arc, options);
      });
      return closed;
    });
  }

  /**
   * Replace a closed increment's outcome, keeping the correction and its nonblank reason in
   * history (10.2). The closure date stays unless supplied; the other outcome fields are replaced.
   * Open work is refused (RangeError), and the usual outcome validation still applies (SchemaError).
   * Null, with nothing written, if `id` is not a live increment. Its lifecycle never changes. A
   * correction to landed clears the waits on it (11.8).
   */
  correctIncrementClosure(id: string, close: CloseInput, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status !== "closed") throw new RangeError(`increment ${JSON.stringify(id)} must be closed before its closure can be corrected`);
      if (typeof reason !== "string" || reason.trim() === "") throw new RangeError("correcting an increment's closure requires a nonblank reason");
      const outcome = outcomeOf({ ...close, date: close.date ?? increment.fields.outcome!.date });
      const corrected = (await this.#records.edit(id, { outcome }, { ...options, reason })) as SchemaRecord<"increment"> | null;
      if (close.disposition === "landed") await this.#clearAfter(() => waits.clearWaitsOn(this.#records, "increment", id, `its blocker ${id} landed, so the wait on it is cleared`, options));
      return corrected;
    });
  }

  /**
   * Move an increment to another arc, keeping its id, lifecycle, waits and claims; its history
   * records the move with `reason`. The arc must be live (MissingReferenceError otherwise). Open
   * work cannot move into a closed arc (ADR-0792 D2, RangeError), while completed history may move
   * there during arc decomposition without reopening it. Null, with nothing written, if `id` is
   * not a live increment. Moving the last open work off an arc closes it, clearing the waits on it (11.8).
   */
  moveIncrement(id: string, arc: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      await checkReference(this.#records, "arc", arc, "arc");
      if (increment.fields.status !== "closed" && (await this.arcView(arc))?.state === "closed") {
        throw new RangeError(`arc ${JSON.stringify(arc)} is closed and takes nothing new: move ${JSON.stringify(id)} to a live arc`);
      }
      const moved = (await this.#records.edit(id, { arc }, { ...options, reason })) as SchemaRecord<"increment"> | null;
      await this.#clearAfter(() => this.#clearIfClosed(increment.fields.arc, options));
      return moved;
    });
  }

  /**
   * Change what an increment is: its title, objective, body, capabilities, links or remedies, each
   * checked as addIncrement checks it. Null, with nothing written, if `id` is not a live increment.
   */
  editIncrement(id: string, fields: IncrementEdit, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const other = Object.keys(fields).find((key) => !EDITABLE.has(key));
      if (other !== undefined) {
        throw new RangeError(`editIncrement changes ${[...EDITABLE].join(", ")}, not ${JSON.stringify(other)}: an increment's arc, status and outcome move through their own verbs`);
      }
      if ((await liveRecord(this.#records, id, ["increment"])) === null) return null;
      await this.#checkNames(fields);
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"increment"> | null;
    });
  }

  /**
   * Make `waiter` wait on `blocker`, with a reason (capability 11): an arc on a live arc, an increment
   * on a live increment on any arc. A wait that would close a loop is refused (WaitLoopError).
   */
  addWait(waiter: string, blocker: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#serially(() => waits.addWait(this.#records, () => this.#snapshot(), waiter, blocker, reason, options));
  }

  /** Stop `waiter` waiting on `blocker` (capability 11). */
  removeWait(waiter: string, blocker: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#serially(() => waits.removeWait(this.#records, waiter, blocker, options));
  }

  /** Make an open increment wait for the owner or an outside event, with a note (11.6). */
  addWaitFor(id: string, wait: WaitFor, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(() => waits.addWaitFor(this.#records, id, wait, options));
  }

  /** Stop an increment waiting for `releaser` (11.6). */
  removeWaitFor(id: string, releaser: WaitFor["releaser"], options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(() => waits.removeWaitFor(this.#records, id, releaser, options));
  }

  /** What an open increment waits for outside the library, read at `at` (11.6). */
  waitsFor(id: string, at: Date = new Date()): Promise<NoteWait[]> {
    return waits.waitsFor(this.#records, id, at);
  }

  /**
   * The blockers still holding `id`'s waits, in the order its waits were written, each with its
   * reason and whether it can never release. An increment wait holds until its blocker closes as
   * landed; an arc wait until that arc closes. An open increment is also held by its arc's waits,
   * after its own, since its arc's work cannot start; a closed increment is held by nothing. Empty
   * when nothing holds, and for an id that is not a live arc or increment.
   */
  async waitHolds(id: string): Promise<Hold[]> {
    const work = await this.#snapshot();
    const record = work.arcs.get(id) ?? work.increments.get(id);
    return record === undefined ? [] : work.waitHolds(record);
  }

  /**
   * Every live arc's and open increment's wait holds, and every open increment's owner holds and
   * waits for the owner or an event (read at `at`), from one reading of the project's work (11.5):
   * what a surface showing all of it asks, in place of a waitHolds, a heldOnQuestion and a waitsFor
   * per id, each of which reads the work again.
   */
  async holds(at: Date = new Date()): Promise<Holds> {
    const work = await this.#snapshot();
    const live = [...work.arcs.values(), ...work.increments.values()];
    const open = [...work.increments.values()];
    return {
      waits: Object.fromEntries(live.map((record) => [record.id, work.waitHolds(record)])),
      heldOn: Object.fromEntries(open.map((increment) => [increment.id, work.heldOn(increment)])),
      waitsFor: Object.fromEntries(open.map((increment) => [increment.id, noteWaits(increment.fields.waitsFor, at)])),
    };
  }

  /** Raise a question for the owner on a live arc that is not parked (capability 12). */
  raiseQuestion(question: NewQuestion, options?: WriteOptions): Promise<SchemaRecord<"question">> {
    return this.#serially(() => questions.raiseQuestion(this.#records, (arc) => isParked(arc), question, options));
  }

  /** Question `id`'s review lease as it reads at `at` (12-a). */
  checkQuestion(id: string, at: Date = new Date()): Promise<QuestionLease | null> {
    return questions.checkQuestion(this.#records, id, at);
  }

  /** Stamp open question `id` as checked to still hold, now (12-a). */
  renewQuestion(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.renewQuestion(this.#records, id, options));
  }

  /** Correct open question `id`'s wording in place (12.7). */
  editQuestion(id: string, fields: QuestionEdit, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.editQuestion(this.#records, id, fields, options));
  }

  /** The open questions whose lease has lapsed at `at`, longest lapsed first (12-a). */
  lapsedQuestions(at: Date = new Date()): Promise<SchemaRecord<"question">[]> {
    return questions.lapsedQuestions(this.#records, at);
  }

  /** Settle a question with the owner's answer (capability 12), clearing the waits on its arc if that now reads closed (11.8). */
  settleQuestion(id: string, settlement: Settlement, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(async () => {
      const settled = await questions.settleQuestion(this.#records, id, settlement, options);
      if (settled !== null) await this.#clearAfter(() => this.#clearIfClosed(settled.fields.arc, options));
      return settled;
    });
  }

  /** The questions raised on arc `arcId`, open and settled, oldest first. */
  async questions(arcId: string): Promise<SchemaRecord<"question">[]> {
    return (await this.#records.list("question", { where: { arc: arcId } })).sort(byCreation);
  }

  /** The open questions an increment is held on: the one answer to whether it waits on the owner (capability 12). */
  heldOnQuestion(incrementId: string): Promise<string[]> {
    return questions.heldOnQuestion(this.#records, incrementId);
  }

  /**
   * Retire question `id`, taking it off every increment held on it in the same step (12.9): the
   * increments released, or null, with nothing written, if it is not a live question.
   */
  retireQuestion(id: string, reason: string, options?: WriteOptions): Promise<string[] | null> {
    return this.#serially(async () => {
      const question = await liveRecord(this.#records, id, ["question"]);
      const heldBy = await questions.retireQuestion(this.#records, id, reason, options);
      if (question !== null) await this.#clearAfter(() => this.#clearIfClosed(question.fields.arc, options));
      return heldBy;
    });
  }

  /**
   * Retire a record, as capability 2's retire does, except a question an increment is held on or
   * a capability with live dependents, refused (RetireRefusedError) with nothing written.
   */
  retire(id: string, reason: string, options?: WriteOptions): Promise<void> {
    return this.#serially(async () => {
      const record = await liveRecord(this.#records, id, ["question", "capability"]);
      if (record?.type === "question") await questions.refuseRetiringHeld(this.#records, id);
      if (record?.type === "capability") {
        const dependents = (await this.#records.select("capability", ["dependsOn"]))
          .filter((capability) => capability.fields.dependsOn?.includes(id) === true);
        if (dependents.length > 0) throw new questions.RetireRefusedError(id, dependents.map((capability) => capability.id), "dependsOn");
      }
      await this.#records.retire(id, reason, options);
    });
  }


  /**
   * Park an arc: it reads parked, whatever its work, until unparked, or, given `until` (a day,
   * YYYY-MM-DD), until UTC midnight of that day, when it wakes by itself on read (10.6). A plain park
   * drops a wake day. Null if `id` is not a live arc.
   */
  parkArc(id: string, options?: ParkOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#setParked(id, true, options);
  }

  /** Unpark an arc: its state is worked out from its increments again. Null if `id` is not a live arc. */
  unparkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#setParked(id, undefined, options);
  }

  /** The arc whole, with its state, its increments and its questions, oldest first; null if `id` is not a live arc. */
  async arcView(id: string, at: Date = new Date()): Promise<ArcView | null> {
    const arc = await liveRecord(this.#records, id, ["arc"]);
    if (arc === null) return null;
    const increments = (await this.#records.list("increment", { where: { arc: id } })).sort(byCreation);
    const questions = await this.questions(id);
    return arcViewOf(arc, increments, questions, at);
  }

  /** Every live arc's view, oldest arc first, as arcView answers each, read in three lists however many arcs there are. */
  async arcViews(at: Date = new Date()): Promise<ArcView[]> {
    const [arcs, increments, questions] = await Promise.all([
      this.#records.list("arc"),
      this.#records.list("increment"),
      this.#records.list("question"),
    ]);
    const byArc = <T extends { fields: { arc: string } }>(records: readonly T[]): Map<string, T[]> => {
      const grouped = new Map<string, T[]>();
      for (const record of records) grouped.set(record.fields.arc, [...(grouped.get(record.fields.arc) ?? []), record]);
      return grouped;
    };
    const incrementsOf = byArc([...increments].sort(byCreation));
    const questionsOf = byArc([...questions].sort(byCreation));
    return [...arcs].sort(byCreation).map((arc) => {
      return arcViewOf(arc, incrementsOf.get(arc.id) ?? [], questionsOf.get(arc.id) ?? [], at);
    });
  }

  /** Only open work and the facts needed to read its named blockers, never closed prose. */
  async #snapshot(): Promise<Snapshot> {
    const [arcs, increments, questions] = await Promise.all([
      this.#records.select("arc", ["waits", "parked", "parkedUntil"]),
      this.#records.select("increment", ["arc", "status", "waits", "waitsFor", "heldOn", "outcome"], { not: { status: "closed" } }),
      this.#records.select("question", ["arc", "lifecycle"], { where: { lifecycle: "open" } }),
    ]);
    const hasIncrements = new Set(increments.map(({ fields }) => fields.arc));
    const arcIds = new Set(arcs.map(({ id }) => id));
    const namedArcs = new Set(arcs.flatMap(({ fields }) => (fields.waits ?? []).map(({ on }) => on)));
    // An arc with no open work can be empty (active) or drained (closed). Read at most one
    // increment, with no fields, only for named arc blockers whose existence matters.
    const needsExistence = [...namedArcs].filter((id) => arcIds.has(id) && !hasIncrements.has(id));
    const blockerIds = [...new Set(increments.flatMap(({ fields }) => (fields.waits ?? []).map(({ on }) => on)))];
    const [landed] = await Promise.all([
      blockerIds.length === 0 ? [] : this.#records.select("increment", [], { ids: blockerIds, where: { status: "closed", "outcome.disposition": "landed" } }),
      ...needsExistence.map(async (arc) => {
        if ((await this.#records.select("increment", [], { where: { arc }, limit: 1 })).length > 0) hasIncrements.add(arc);
      }),
    ]);
    return new Snapshot(arcs, increments, questions, hasIncrements, new Set(landed.map(({ id }) => id)));
  }


  /**
   * Once arc `id` reads closed, clear the waits on it (11.8): run after a write that can close it,
   * its last open increment closing or its last open question going.
   */
  async #clearIfClosed(id: string, options?: WriteOptions): Promise<void> {
    if ((await this.arcView(id))?.state === "closed") await waits.clearWaitsOn(this.#records, "arc", id, `its blocker ${id} closed, so the wait on it is cleared`, options);
  }

  /**
   * Run the clearing that follows a committed write, which stands whatever the clearing meets: a
   * record it cannot read (a newer sibling schema, 6.9) leaves the waits stored, and they hold no
   * longer anyway, since waitHolds reads each blocker.
   */
  async #clearAfter(clear: () => Promise<unknown>): Promise<void> {
    try {
      await clear();
    } catch {
      // The write before it is committed; a later reader sees the blocker closed.
    }
  }

  #setParked(id: string, parked: true | undefined, options?: ParkOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["arc"])) === null) return null;
      const parkedUntil = parked === undefined ? undefined : options?.until;
      return (await this.#records.edit(id, { parked, parkedUntil }, options)) as SchemaRecord<"arc"> | null;
    });
  }

  /**
   * What an increment lists as its capabilities must be live capabilities, and nothing else
   * (ADR-0949 D2); what it links to any live records; what it remedies live friction (10-a); and
   * what it is held on live questions (12).
   */
  async #checkNames(fields: { readonly capabilities?: unknown; readonly links?: unknown; readonly remedies?: unknown; readonly heldOn?: unknown }): Promise<void> {
    await checkReferences(this.#records, "capabilities", fields.capabilities, "capability");
    await checkReferences(this.#records, "links", fields.links, "record");
    await checkReferences(this.#records, "remedies", fields.remedies, "friction");
    await checkReferences(this.#records, "heldOn", fields.heldOn, "question");
  }

  /** Run `write` once every write queued through this layer before it has settled, so its checks and its write happen together. */
  #serially<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#lastWrite.then(() => write());
    this.#lastWrite = result.catch(() => undefined);
    return result;
  }
}

type ArcFacts = Omit<SchemaRecord<"arc">, "fields"> & { fields: Pick<FieldsOf<"arc">, "waits" | "parked" | "parkedUntil"> };
type IncrementFacts = Omit<SchemaRecord<"increment">, "fields"> & { fields: Pick<FieldsOf<"increment">, "arc" | "status" | "waits" | "waitsFor" | "heldOn" | "outcome"> };
type QuestionFacts = Omit<SchemaRecord<"question">, "fields"> & { fields: Pick<FieldsOf<"question">, "arc" | "lifecycle"> };

/** The live arcs, increments and questions at one moment, and how their waits read then. */
class Snapshot {
  readonly arcs: ReadonlyMap<string, ArcFacts>;
  readonly increments: ReadonlyMap<string, IncrementFacts>;
  readonly #byArc = new Map<string, IncrementFacts[]>();
  readonly #questionsByArc = new Map<string, QuestionFacts[]>();
  readonly #questions: readonly QuestionFacts[];

  constructor(
    arcs: readonly ArcFacts[],
    increments: readonly IncrementFacts[],
    questions: readonly QuestionFacts[],
    readonly hasIncrements: ReadonlySet<string>,
    readonly landed: ReadonlySet<string>,
  ) {
    this.arcs = new Map(arcs.map((arc) => [arc.id, arc]));
    this.#questions = questions;
    this.increments = new Map(increments.map((increment) => [increment.id, increment]));
    for (const increment of [...increments].sort(byCreation)) {
      const siblings = this.#byArc.get(increment.fields.arc);
      if (siblings === undefined) this.#byArc.set(increment.fields.arc, [increment]);
      else siblings.push(increment);
    }
    for (const question of questions) {
      const siblings = this.#questionsByArc.get(question.fields.arc);
      if (siblings === undefined) this.#questionsByArc.set(question.fields.arc, [question]);
      else siblings.push(question);
    }
  }

  /**
   * The blockers still holding `record`'s waits: an arc's own; an open increment's own, then its
   * arc's; a closed increment's none (11.4).
   */
  waitHolds(record: ArcFacts | IncrementFacts): Hold[] {
    if (record.type === "arc") return holdsOf(record.fields.waits, (wait) => this.arcHold(wait));
    const increment = record as IncrementFacts;
    if (increment.fields.status === "closed") return [];
    return [
      ...holdsOf(increment.fields.waits, (wait) => this.incrementHold(wait)),
      ...holdsOf(this.arcs.get(increment.fields.arc)?.fields.waits, (wait) => this.arcHold(wait)),
    ];
  }

  /** The open questions an increment is held on; none once it is closed (12.3). */
  heldOn(increment: IncrementFacts): string[] {
    return increment.fields.status === "closed" ? [] : heldOnOpen(increment, this.#questions);
  }

  /** The arc's open increments, oldest first. */
  openIncrementsOf(arc: string): IncrementFacts[] {
    return (this.#byArc.get(arc) ?? []).filter((increment) => increment.fields.status !== "closed");
  }

  /** Whether an arc wait holds, as capability 11 reads the arc's state now. */
  arcHold(wait: Wait): Hold | undefined {
    const arc = this.arcs.get(wait.on);
    const closed = arc === undefined
      ? undefined
      : arcState(arc, this.#byArc.get(arc.id) ?? [], this.#questionsByArc.get(arc.id) ?? [], new Date(), this.hasIncrements.has(arc.id)) === "closed";
    return arcHold(wait, closed);
  }

  /** Whether an increment wait holds, as capability 11 reads its blocker. */
  incrementHold(wait: Wait): Hold | undefined {
    return incrementHold(wait, this.landed.has(wait.on), this.increments.has(wait.on));
  }
}

/**
 * An arc's state (10.3): parked while the owner has parked it, and, parked until a day, only before
 * UTC midnight of that day at `at` (10.6); otherwise closed exactly when it has
 * increments, none of them is open and none of its questions waits on the owner, and active while
 * any does, or while it has no increments yet. (A drained arc still waiting on an answer stays
 * active, as 0.2's ADR-0526 settled: closed, it would leave every worklist with the question open.)
 */
function arcState(
  arc: ArcFacts,
  increments: readonly IncrementFacts[],
  questions: readonly QuestionFacts[],
  at: Date = new Date(),
  hasIncrements: boolean = increments.length > 0,
): ArcState {
  if (isParked(arc, at)) return "parked";
  if (!hasIncrements) return "active";
  if (increments.some((increment) => increment.fields.status !== "closed")) return asleepUntil(arc, increments, questions, at) === undefined ? "active" : "parked";
  return questions.some((question) => question.fields.lifecycle === "open") ? "active" : "closed";
}

/** An arc's view at `at`: its state, and the day a dated park ends while one holds. */
function arcViewOf(arc: SchemaRecord<"arc">, increments: SchemaRecord<"increment">[], questions: SchemaRecord<"question">[], at: Date): ArcView {
  const state = arcState(arc, increments, questions, at);
  const wakes = state !== "parked" ? undefined : isParked(arc, at) ? arc.fields.parkedUntil : asleepUntil(arc, increments, questions, at);
  return { arc, state, ...(wakes === undefined ? {} : { wakes }), increments, questions };
}

/**
 * The day an arc's open work sleeps until (10.10, ADR-0938 narrowed by the owner, 2026-10-09), or
 * undefined if any of it can move before then. It sleeps when it has open work, waits on no arc and
 * has no open question, and every open increment is a proposal with no owner wait and no open held-on
 * question, held by an event wait before its check-back day, or by waits only on its own arc's work
 * that sleeps, or has landed. It sleeps until the earliest of those days. A wait on any other work
 * keeps it awake, so it folds under that work instead (ADR-0760 D1).
 */
function asleepUntil(arc: ArcFacts, increments: readonly IncrementFacts[], questions: readonly QuestionFacts[], at: Date): string | undefined {
  if ((arc.fields.waits ?? []).length > 0 || questions.some((question) => question.fields.lifecycle === "open")) return undefined;
  const settled = new Set(questions.filter((question) => question.fields.lifecycle !== "open").map(({ id }) => id));
  const byId = new Map(increments.map((increment) => [increment.id, increment]));
  const days = new Map<string, string | undefined>();
  const until = (increment: IncrementFacts): string | undefined => {
    if (days.has(increment.id)) return days.get(increment.id);
    days.set(increment.id, undefined); // a loop never sleeps (and capability 11 refuses one)
    const { status, waitsFor, waits, heldOn } = increment.fields;
    const notes = noteWaits(waitsFor, at).filter(({ holds }) => holds);
    if (status !== "proposal" || notes.some(({ releaser }) => releaser === "owner") || (heldOn ?? []).some((id) => !settled.has(id))) return undefined;
    const candidates = notes.flatMap(({ checkBack }) => (checkBack === undefined ? [] : [checkBack]));
    for (const { on } of waits ?? []) {
      const blocker = byId.get(on);
      if (blocker?.fields.status === "closed" && blocker.fields.outcome?.disposition === "landed") continue;
      const day = blocker === undefined || blocker.fields.status === "closed" ? undefined : until(blocker);
      if (day === undefined) return undefined;
      candidates.push(day);
    }
    const day = candidates.sort()[0];
    days.set(increment.id, day);
    return day;
  };
  const open = increments.filter((increment) => increment.fields.status !== "closed");
  const each = open.map(until);
  return each.some((day) => day === undefined) ? undefined : (each as string[]).sort()[0];
}

/** Whether the owner has `arc` parked at `at`: parked, and, parked until a day, only before UTC midnight of that day (10.6). */
function isParked(arc: ArcFacts, at: Date = new Date()): boolean {
  const { parked, parkedUntil } = arc.fields;
  return parked === true && (parkedUntil === undefined || at.getTime() < Date.parse(`${parkedUntil}T00:00:00Z`));
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
