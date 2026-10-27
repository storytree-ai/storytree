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
import { isDeepStrictEqual } from "node:util";

import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import { INCREMENT_STATUSES, type FieldsOf } from "../schema/types.js";
import type { HistoryEntry } from "../transactions/index.js";
import * as questions from "./owner-questions.js";
import { heldOnOpen, type NewQuestion, type QuestionEdit, type QuestionLease, type Settlement } from "./owner-questions.js";
import * as waits from "./waits.js";
import { WorkModel, type CapabilityNode, type ProjectTree, type StoryNode } from "./work-model.js";
import { arcHold, checkedWaitFor, holdsOf, incrementHold, noteWaits, type Hold, type Holds, type NoteWait, type Wait, type WaitFor } from "./waits.js";

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
  /** The one machine that can take it, by its short name; absent, any machine can. */
  readonly machine?: string;
  /** The escape it fixes: the pull request (`#123`) or live increment that caused it, and the live story it hit. */
  readonly escape?: Escape;
  /** The increments it is born waiting on, each with why (11): each must be a live increment. */
  readonly waits?: Wait[];
  /**
   * What it is born waiting for outside the library, the owner or an event, one note per releaser
   * (11.6), written in the parking's own write so it is never open work without the wait (10.25).
   */
  readonly waitsFor?: WaitFor[];
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
  /** Undefined clears it, so any machine can take it. */
  readonly machine?: string | undefined;
  /** Undefined clears it: it fixes no escape. */
  readonly escape?: Escape | undefined;
  /** Undefined clears it: no risk line read. Its stories must be live stories. */
  readonly risk?: RiskLine | undefined;
}

/** An increment's risk line: its tier, rating, depth, radius, flags, the stories it touches and the day read. */
export type RiskLine = NonNullable<FieldsOf<"increment">["risk"]>;

/** An escape an increment fixes: the change that caused it and the story it hit. */
export type Escape = NonNullable<FieldsOf<"increment">["escape"]>;

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

/** An arc that parks a capability (ADR-0992 D6): its id and title, so the capability's card can name it. */
export interface ParkedOn {
  readonly arc: string;
  readonly title: string;
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

/** The increment fields the arc board draws (10.22): never its planning body, links, remedies or pending changes. */
export const BOARD_INCREMENT_FIELDS = ["arc", "title", "objective", "status", "parked", "capabilities", "waits", "waitsFor", "heldOn", "outcome", "machine"] as const;

/** An increment as the arc board reads it: its record with only the fields the board draws. */
export type BoardIncrement = Omit<SchemaRecord<"increment">, "fields"> & { fields: Pick<FieldsOf<"increment">, (typeof BOARD_INCREMENT_FIELDS)[number]> };

/** An arc as the arc board reads it (10.22): an ArcView with its increments' drawn fields, and, closed, its closing day. */
export interface BoardArcView {
  readonly arc: SchemaRecord<"arc">;
  readonly state: ArcState;
  readonly wakes?: string;
  /** Closed, the day it closed: the latest outcome day among its increments (YYYY-MM-DD). */
  readonly closed?: string;
  readonly increments: BoardIncrement[];
  readonly questions: SchemaRecord<"question">[];
}

/** A window of days, YYYY-MM-DD, from `from` up to but not including `to`. */
export interface DayWindow {
  readonly from: string;
  readonly to: string;
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

const EDITABLE: ReadonlySet<string> = new Set(["title", "objective", "body", "capabilities", "links", "remedies", "heldOn", "machine", "escape", "risk"]);

export class WorkInFlight {
  readonly #records: SchemaRecords;
  /** The plan's editors, through which a landed increment's pending changes apply (ADR-0966 D4). */
  readonly #work: WorkModel;
  /** The last write queued through this layer; the next one starts once it has settled. */
  #lastWrite: Promise<unknown> = Promise.resolve();

  constructor(records: SchemaRecords, work: WorkModel = new WorkModel(records)) {
    this.#records = records;
    this.#work = work;
  }

  /**
   * Add an increment to a live arc (MissingReferenceError otherwise, as for any capability, link,
   * remedies or increment it waits on that is not live). A wait given at birth needs no loop check,
   * since nothing can wait on a record not yet written. It is a proposal, stamped with when it was parked, or, given an
   * `outcome`, born closed.
   */
  addIncrement(increment: NewIncrement, options?: WriteOptions): Promise<SchemaRecord<"increment">> {
    return this.#serially(async () => {
      const { outcome, ...fields } = increment;
      await checkReference(this.#records, "arc", fields.arc, "arc");
      await this.#checkNames(fields);
      for (const { on } of fields.waits ?? []) await checkReference(this.#records, "on", on, "increment");
      const waitsFor = fields.waitsFor?.map(checkedWaitFor);
      if (waitsFor !== undefined && outcome !== undefined) throw new RangeError("an increment born closed waits for nothing");
      if (new Set(waitsFor?.map(({ releaser }) => releaser)).size !== (waitsFor?.length ?? 0)) throw new RangeError("an increment waits with one note per releaser");
      const lifecycle = outcome === undefined
        ? { status: "proposal" as const, parked: new Date().toISOString() }
        : { status: "closed" as const, outcome: outcomeOf(outcome) };
      return this.#records.create("increment", { ...fields, ...(waitsFor === undefined || waitsFor.length === 0 ? { waitsFor: undefined } : { waitsFor }), ...lifecycle }, options);
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
   * Its pending plan changes (ADR-0966) are applied first if it landed, as applyPending applies them,
   * and dropped in the close itself otherwise, its history saying how many (D6). The friction it
   * remedies then moves as the close says (ADR-1016 D2): resolved if it landed, back to the drain if not.
   */
  closeIncrement(id: string, close: CloseInput, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      let increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status === "closed") throw new LifecycleError(id, "closed", "closed");
      if (close.disposition === "landed" && (increment.fields.pending ?? []).length > 0) {
        await this.#applyPending(increment, close.pr, options);
        increment = (await liveRecord(this.#records, id, ["increment"]))!;
      }
      const dropped = increment.fields.pending?.length ?? 0;
      const fields = { status: "closed" as const, outcome: outcomeOf(close), ...(dropped === 0 ? {} : { pending: undefined }) };
      const write = dropped === 0 ? options : { ...options, reason: droppedReason(dropped, close.disposition) };
      const closed = (await this.#records.edit(id, fields, write)) as SchemaRecord<"increment"> | null;
      await this.#clearAfter(async () => {
        if (close.disposition === "landed") await waits.clearWaitsOn(this.#records, "increment", id, `its blocker ${id} landed, so the wait on it is cleared`, options);
        await this.#clearIfClosed(increment.fields.arc, options);
      });
      await this.#clearAfter(() => this.#settleRemedies(increment, close, undefined, options));
      return closed;
    });
  }

  /**
   * Replace a closed increment's outcome, keeping the correction and its nonblank reason in
   * history (10.2). The closure date stays unless supplied; the other outcome fields are replaced.
   * Open work is refused (RangeError), and the usual outcome validation still applies (SchemaError).
   * Null, with nothing written, if `id` is not a live increment. Its lifecycle never changes. A
   * correction to landed clears the waits on it (11.8), and the friction it remedies follows the
   * corrected outcome (ADR-1016 D2).
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
      await this.#clearAfter(() => this.#settleRemedies(increment, close, increment.fields.outcome, options));
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
   * Change what an increment is: its title, objective, body, capabilities, links, remedies, held-on questions or machine, each
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
   * Hold `change` on active increment `id` as a pending change (ADR-0966 D1), leaving the live record
   * alone: kept with the record's latest history entry as its base, and, for an edit, the changed
   * fields' live values beside the new ones. A second change to the same record merges into the first,
   * keeping its base and first values; a retirement replaces an edit, and an edit after a pending
   * retirement is refused. A record the increment planned itself, created after it started, is not
   * held: the answer says so, and the caller edits it live. Refused, with nothing written: an increment
   * that is not active (RangeError); a record that is not a live story, capability or contract
   * (MissingReferenceError); an edit that would leave the record invalid (SchemaError) or name a
   * missing record (MissingReferenceError); and a record another open increment already holds a
   * pending change for, naming that increment (RangeError, D5). Null if `id` is not a live increment.
   */
  pendChange(id: string, change: PlanChange, options?: WriteOptions): Promise<Pended | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status !== "active") {
        throw new RangeError(`increment ${JSON.stringify(id)} is ${increment.fields.status}: only an active increment, one a session holds, takes pending changes`);
      }
      await checkReference(this.#records, "record", change.record, PLAN_RECORD);
      const record = (await liveRecord(this.#records, change.record, PLAN_RECORD.types))!;
      const [created] = await this.#records.history({ id: record.id, oldest: 1 });
      const started = (await this.#records.history({ id })).find((entry) => entry.record.fields["status"] === "active");
      if (started !== undefined && created!.seq > started.seq) return { plannedHere: true };
      const holder = (await this.#records.select("increment", ["pending"], { not: { status: "closed" } }))
        .find((other) => other.id !== id && (other.fields.pending ?? []).some((pending) => pending.record === record.id));
      if (holder !== undefined) {
        throw new RangeError(
          `${record.type} ${JSON.stringify(record.id)} already has a pending change on open increment ${JSON.stringify(holder.id)}: ` +
            "two increments never hold changes to one record (ADR-0966 D5); take other work, or wait for that one to land or close",
        );
      }
      const pending = increment.fields.pending ?? [];
      const earlier = pending.find((entry) => entry.record === record.id);
      const base = earlier?.base ?? (await this.#records.history({ id: record.id, newest: 1 }))[0]!.seq;
      const head = { record: record.id, type: record.type, base };
      let entry: PendingChange;
      if ("retire" in change) {
        entry = { ...head, retire: change.retire };
      } else {
        if (earlier !== undefined && "retire" in earlier) {
          throw new RangeError(`${record.type} ${JSON.stringify(record.id)} is pending retirement on this increment: it takes no edit after that`);
        }
        const live = record.fields as Record<string, unknown>;
        const given = Object.keys(change.fields);
        const after = { ...(earlier?.after ?? {}), ...Object.fromEntries(given.map((field) => [field, change.fields[field] ?? null])) };
        const before = { ...Object.fromEntries(given.map((field) => [field, live[field] ?? null])), ...(earlier?.before ?? {}) };
        const merged = { ...live, ...after };
        for (const [field, value] of Object.entries(after)) if (value === null) delete merged[field];
        this.#records.check(record.type, merged);
        await checkReference(this.#records, "story", record.type === "capability" ? change.fields["story"] : undefined, "story");
        await checkReferences(this.#records, "dependsOn", change.fields["dependsOn"], "capability");
        await checkReference(this.#records, "capability", record.type === "contract" ? change.fields["capability"] : undefined, "capability");
        entry = { ...head, before, after };
      }
      const next = earlier === undefined ? [...pending, entry] : pending.map((other) => (other === earlier ? entry : other));
      await this.#records.edit(id, { pending: next }, options);
      return { pending: entry };
    });
  }

  /**
   * `tree`, as WorkModel.projectTree() gives it, with increment `id`'s pending changes laid over (ADR-0966
   * D3): what its branch's own checks read. An edit's new fields replace the live ones the tree shows
   * (a capability or contract given a new story or capability moves there), and a retirement takes the
   * record, and anything under it, out. The tree given is not changed. Null if `id` is not a live increment.
   */
  async withPending(id: string, tree: ProjectTree): Promise<ProjectTree | null> {
    const increment = await liveRecord(this.#records, id, ["increment"]);
    return increment === null ? null : overlay(tree, increment.fields.pending ?? []);
  }

  /**
   * Increment `id`'s pending changes their record has moved since they were read (ADR-0966 D5's gate
   * case, movedSince): each with its base and its record's latest history entry, in the increment's
   * order. Empty when none has moved; null if `id` is not a live increment.
   */
  async stalePending(id: string): Promise<StalePending[] | null> {
    const increment = await liveRecord(this.#records, id, ["increment"]);
    if (increment === null) return null;
    const stale: StalePending[] = [];
    for (const change of increment.fields.pending ?? []) {
      const { record, type, base } = change;
      const [latest] = await this.#records.history({ id: record, newest: 1 });
      if (latest === undefined || !movedSince(change, latest)) continue;
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
   * already carries its mark, as after a crash part-way, counts as applied. The increment keeps none
   * pending afterwards. The library has no transaction across records, so they apply one at a time,
   * in the increment's order. Null if `id` is not a live increment.
   */
  applyPending(id: string, pr?: string, options?: WriteOptions): Promise<AppliedPending | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      return increment === null ? null : this.#applyPending(increment, pr, options);
    });
  }

  /**
   * Settle every closed increment's leftover pending changes, those of increments closed before
   * closing applied or dropped them: each that landed has them applied, as applyPending applies them
   * with its pull request; each that did not has them dropped. Oldest first; empty when none is left.
   */
  settleClosedPending(options?: WriteOptions): Promise<SettledPending[]> {
    return this.#serially(async () => {
      const closed = (await this.#records.select("increment", ["pending", "outcome"], { where: { status: "closed" } }))
        .filter((increment) => (increment.fields.pending ?? []).length > 0)
        .sort(byCreation);
      const settled: SettledPending[] = [];
      for (const { id, fields } of closed) {
        const increment = (await liveRecord(this.#records, id, ["increment"]))!;
        if (fields.outcome?.disposition === "landed") {
          settled.push({ increment: id, ...(await this.#applyPending(increment, fields.outcome.pr, options)), dropped: 0 });
        } else {
          const dropped = fields.pending!.length;
          await this.#records.edit(id, { pending: undefined }, { ...options, reason: droppedReason(dropped, fields.outcome?.disposition ?? "withdrawn") });
          settled.push({ increment: id, applied: [], dropped });
        }
      }
      return settled;
    });
  }

  /**
   * Make `waiter` wait on `blocker`, with a reason (capability 11): an arc on a live arc, an increment
   * on a live increment on any arc. A wait that would close a loop across arcs and increments is
   * refused (WaitLoopError). Null if `waiter` is not a live arc or increment.
   */
  addWait(waiter: string, blocker: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#serially(() => waits.addWait(this.#records, () => this.#snapshot(), waiter, blocker, reason, options));
  }

  /** Stop `waiter` waiting on `blocker` (capability 11). Null if `waiter` is not a live arc or increment. */
  removeWait(waiter: string, blocker: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#serially(() => waits.removeWait(this.#records, waiter, blocker, options));
  }

  /**
   * Make an open increment wait for the owner (an action) or an outside event (with a check-back
   * day), with a note (11.6); waiting again for the same releaser replaces it (RangeError for an event
   * with no day or a day before today, an owner wait with a day, or a closed increment). Null if `id`
   * is not a live increment.
   */
  addWaitFor(id: string, wait: WaitFor, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(() => waits.addWaitFor(this.#records, id, wait, options));
  }

  /** Stop an increment waiting for `releaser` (11.6). Null if `id` is not a live increment. */
  removeWaitFor(id: string, releaser: WaitFor["releaser"], options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(() => waits.removeWaitFor(this.#records, id, releaser, options));
  }

  /**
   * What an open increment waits for outside the library at `at` (now, unless given), each with
   * whether it still holds: an event wait no longer holds from its check-back day (11.6).
   */
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
   * waits for the owner or an event (read at `at`, now unless given), from one reading of the
   * project's work (11.5): what a surface showing all of it asks, in place of a waitHolds, a
   * heldOnQuestion and a waitsFor per id, each of which reads the work again. Closed increments have
   * no holds and are omitted.
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

  /** Raise a question for the owner on a live arc that is not parked (capability 12): it is open. */
  raiseQuestion(question: NewQuestion, options?: WriteOptions): Promise<SchemaRecord<"question">> {
    return this.#serially(() => questions.raiseQuestion(this.#records, (arc) => isParked(arc), question, options));
  }

  /**
   * Question `id`'s review lease at `at` (now, unless given): fresh while it runs, lapsed once it has
   * run out, settled once answered (12-a). Null if `id` is not a live question. It writes nothing.
   */
  checkQuestion(id: string, at: Date = new Date()): Promise<QuestionLease | null> {
    return questions.checkQuestion(this.#records, id, at);
  }

  /**
   * Stamp open question `id` as checked to still hold, now, starting its lease again (12-a). Renewing
   * a settled question is refused (RangeError). Null if `id` is not a live question.
   */
  renewQuestion(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.renewQuestion(this.#records, id, options));
  }

  /**
   * Correct open question `id`'s wording in place, only the named fields; an optional one set to
   * undefined is removed (12.7). Anything but its wording, or a settled question, is refused
   * (RangeError) with nothing written. Null if `id` is not a live question.
   */
  editQuestion(id: string, fields: QuestionEdit, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.editQuestion(this.#records, id, fields, options));
  }

  /**
   * Move open question `id` to another arc in place, keeping its id, wording and holders, its
   * history recording `reason` (12.11). A parked arc takes it; a closed or missing arc, its own arc
   * or a settled question is refused with nothing written. Moving the last open question off an arc
   * closes it, clearing the waits on it (11.8). Null if `id` is not a live question.
   */
  moveQuestion(id: string, arc: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(async () => {
      const question = await liveRecord(this.#records, id, ["question"]);
      const closed = async (to: string): Promise<boolean> => (await this.arcView(to))?.state === "closed";
      const moved = await questions.moveQuestion(this.#records, closed, id, arc, reason, options);
      if (question !== null && moved !== null) await this.#clearAfter(() => this.#clearIfClosed(question.fields.arc, options));
      return moved;
    });
  }

  /** The open questions whose lease has lapsed at `at` (now, unless given), longest lapsed first (12-a). */
  lapsedQuestions(at: Date = new Date()): Promise<SchemaRecord<"question">[]> {
    return questions.lapsedQuestions(this.#records, at);
  }

  /**
   * Settle a question with the owner's answer, and the live decision that carried it, if one did
   * (capability 12), clearing the waits on its arc if that now reads closed (11.8). Null if `id` is
   * not a live question.
   */
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
    return this.#serially(() => this.#retire(id, reason, options));
  }

  async #retire(id: string, reason: string, options?: WriteOptions): Promise<void> {
    const record = await liveRecord(this.#records, id, ["question", "capability"]);
    if (record?.type === "question") await questions.refuseRetiringHeld(this.#records, id);
    if (record?.type === "capability") {
      const dependents = (await this.#records.select("capability", ["dependsOn"]))
        .filter((capability) => capability.fields.dependsOn?.includes(id) === true);
      if (dependents.length > 0) throw new questions.RetireRefusedError(id, dependents.map((capability) => capability.id), "dependsOn");
    }
    await this.#records.retire(id, reason, options);
  }

  /** applyPending's work, run inside the caller's turn of the queue. */
  async #applyPending(increment: SchemaRecord<"increment">, pr: string | undefined, options?: WriteOptions): Promise<AppliedPending> {
    const pending = increment.fields.pending ?? [];
    if (pending.length === 0) return { applied: [] };
    const number = pr?.replace(/^#/, "");
    const mark = number === undefined || number === "" ? `applied at the landing of ${increment.id}` : `applied at the merge of PR #${number} (${increment.id})`;
    const applied: string[] = [];
    const unapplied: UnappliedPending[] = [];
    for (const change of pending) {
      const { record, type, base } = change;
      const [latest] = await this.#records.history({ id: record, newest: 1 });
      if (latest?.reason?.includes(mark) === true) {
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
          await this.#retire(record, `${change.retire} (${mark})`, options);
        } else {
          const fields = Object.fromEntries(Object.entries(change.after).map(([field, value]) => [field, value ?? undefined]));
          const write = { ...options, reason: mark };
          if (type === "story") await this.#work.editStory(record, fields, write);
          else if (type === "capability") await this.#work.editCapability(record, fields, write);
          else await this.#work.editContract(record, fields, write);
        }
        applied.push(record);
      } catch (error) {
        unapplied.push({ record, type, base, why: "refused", refusal: error instanceof Error ? error.message : String(error) });
      }
    }
    let residue: AppliedPending["residue"];
    if (unapplied.length > 0) {
      const changes = new Map(pending.map((change) => [change.record, change]));
      const parked = await this.#records.create("increment", {
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
    await this.#records.edit(increment.id, { pending: undefined }, { ...options, reason: summary });
    return { applied, ...(residue === undefined ? {} : { residue }) };
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

  /**
   * The arc whole: its state (worked out on every read at `at`, now unless given, or parked), its
   * increments and its questions, oldest first. Null if `id` is not a live arc.
   */
  async arcView(id: string, at: Date = new Date()): Promise<ArcView | null> {
    const arc = await liveRecord(this.#records, id, ["arc"]);
    if (arc === null) return null;
    const increments = (await this.#records.list("increment", { where: { arc: id } })).sort(byCreation);
    const questions = await this.questions(id);
    return arcViewOf(arc, increments, questions, at);
  }

  /** Every live arc's view, oldest arc first, as arcView answers each, read at `at` (now, unless given) in three lists however many arcs there are. */
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

  /**
   * The arc board's reading at `at` (10.22): every live arc (active or parked), and each closed arc
   * whose closing day falls in `closed`, oldest arc first, its increments carrying only the fields the
   * board draws. Closed arcs outside the window are never read past the facts that decide their state.
   */
  boardArcs(closed: DayWindow, at: Date = new Date()): Promise<BoardArcView[]> {
    return this.#boardArcs(closed, true, at);
  }

  /** Only the closed arcs whose closing day falls in `window`, read as boardArcs reads them (10.22). */
  closedArcs(window: DayWindow, at: Date = new Date()): Promise<BoardArcView[]> {
    return this.#boardArcs(window, false, at);
  }

  /**
   * The closing day is worked out here, not stored or asked of SQL: a first pass selects only the
   * fields that decide each arc's state and its increments' outcome days, then the arcs kept are read.
   */
  async #boardArcs(window: DayWindow, live: boolean, at: Date): Promise<BoardArcView[]> {
    const [arcFacts, incrementFacts, questionFacts] = await Promise.all([
      this.#records.select("arc", ["waits", "parked", "parkedUntil"]),
      this.#records.select("increment", ["arc", "status", "waits", "waitsFor", "heldOn", "outcome"]),
      this.#records.select("question", ["arc", "lifecycle"]),
    ]);
    const group = <T extends { fields: { arc: string } }>(records: readonly T[]): Map<string, T[]> => {
      const grouped = new Map<string, T[]>();
      for (const record of records) grouped.set(record.fields.arc, [...(grouped.get(record.fields.arc) ?? []), record]);
      return grouped;
    };
    const incrementsOf = group([...incrementFacts].sort(byCreation));
    const questionsOf = group(questionFacts);
    const kept = new Map<string, string | undefined>();
    for (const arc of arcFacts) {
      const increments = incrementsOf.get(arc.id) ?? [];
      if (arcState(arc, increments, questionsOf.get(arc.id) ?? [], at) !== "closed") {
        if (live) kept.set(arc.id, undefined);
        continue;
      }
      const day = increments.map(({ fields }) => fields.outcome?.date ?? "").sort().at(-1) ?? "";
      if (day >= window.from && day < window.to) kept.set(arc.id, day);
    }
    const ids = [...kept.keys()];
    if (ids.length === 0) return [];
    const [arcs, increments, questionRecords] = await Promise.all([
      this.#records.list("arc", { ids }),
      this.#records.select("increment", BOARD_INCREMENT_FIELDS, { ids: ids.flatMap((id) => (incrementsOf.get(id) ?? []).map((increment) => increment.id)) }),
      this.#records.list("question", { ids: ids.flatMap((id) => (questionsOf.get(id) ?? []).map((question) => question.id)) }),
    ]);
    const drawnOf = group([...increments].sort(byCreation));
    const askedOf = group([...questionRecords].sort(byCreation));
    return [...arcs].sort(byCreation).map((arc): BoardArcView => {
      const facts = incrementsOf.get(arc.id) ?? [];
      const questions = askedOf.get(arc.id) ?? [];
      const state = arcState(arc, facts, questions, at);
      const wakes = state !== "parked" ? undefined : isParked(arc, at) ? arc.fields.parkedUntil : asleepUntil(arc, facts, questions, at);
      const closed = kept.get(arc.id);
      return { arc, state, ...(wakes === undefined ? {} : { wakes }), ...(closed === undefined ? {} : { closed }), increments: drawnOf.get(arc.id) ?? [], questions };
    });
  }

  /**
   * The capabilities parked on purpose at `at` (now, unless given; ADR-0992 D2, D3), each with the arcs
   * that park it, in the order of the increments naming it: open increments name it, every one sits on an
   * arc reading parked (the owner's, or asleep on a dated event, 10.10), and none waits for the owner or
   * is held on an open question. Its arcs' states are read as arcViews reads them, from three selections
   * of the fields that decide them, never their prose.
   */
  async parkedCapabilities(at: Date = new Date()): Promise<Map<string, ParkedOn[]>> {
    const [arcs, increments, questions] = await Promise.all([
      this.#records.select("arc", ["title", "waits", "parked", "parkedUntil"]),
      this.#records.select("increment", ["arc", "status", "waits", "waitsFor", "heldOn", "outcome", "capabilities"]),
      this.#records.select("question", ["arc", "lifecycle"]),
    ]);
    const of = <T extends { fields: { arc: string } }>(records: readonly T[], arc: string): T[] => records.filter((record) => record.fields.arc === arc);
    const parked = new Map(arcs.filter((arc) => arcState(arc, of(increments, arc.id).sort(byCreation), of(questions, arc.id), at) === "parked").map((arc) => [arc.id, arc.fields.title]));
    const named = new Map<string, { arcs: ParkedOn[]; asks: boolean }>();
    for (const increment of [...increments].sort(byCreation)) {
      if (increment.fields.status === "closed") continue;
      const title = parked.get(increment.fields.arc);
      const asks = title === undefined || noteWaits(increment.fields.waitsFor, at).some(({ releaser, holds }) => holds && releaser === "owner") || heldOnOpen(increment, questions).length > 0;
      for (const capability of increment.fields.capabilities ?? []) {
        const seen = named.get(capability) ?? { arcs: [], asks: false };
        if (title !== undefined && !seen.arcs.some(({ arc }) => arc === increment.fields.arc)) seen.arcs.push({ arc: increment.fields.arc, title });
        named.set(capability, { arcs: seen.arcs, asks: seen.asks || asks });
      }
    }
    return new Map([...named].flatMap(([capability, { arcs, asks }]) => (asks ? [] : [[capability, arcs] as const])));
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
   * Move the friction an increment remedies as its close says (ADR-1016 D2). Landed, each report
   * not yet resolved is resolved, stamped with the pull request, or the increment when it has none.
   * Failed or withdrawn, each still owed its remedy goes back to the drain, open with its route
   * cleared, unless another open increment remedies it. A closure corrected from landed does that to
   * the reports this increment's stamp resolved; corrected to landed, it resolves them as a landing does.
   */
  async #settleRemedies(increment: SchemaRecord<"increment">, close: CloseInput, previous: FieldsOf<"increment">["outcome"], options?: WriteOptions): Promise<void> {
    const remedies = increment.fields.remedies ?? [];
    if (remedies.length === 0) return;
    const landedBefore = previous?.disposition === "landed";
    if (close.disposition === "landed" && landedBefore) return;
    const stamp = stampOf(increment.id, close.pr);
    const elsewhere = close.disposition === "landed" ? new Set<string>() : new Set(
      (await this.#records.select("increment", ["remedies"], { not: { status: "closed" } }))
        .filter(({ id }) => id !== increment.id)
        .flatMap(({ fields }) => fields.remedies ?? []),
    );
    const write = { ...options, reason: `increment ${increment.id} closed ${close.disposition} (ADR-1016 D2)` };
    for (const id of remedies) {
      const report = await liveRecord(this.#records, id, ["friction"]);
      if (report === null) continue;
      const { state, route, dischargedBy } = report.fields as FieldsOf<"friction">;
      if (close.disposition === "landed") {
        if (state !== "resolved") await this.#records.edit(id, { state: "resolved", dischargedBy: stamp }, write);
        continue;
      }
      const owed = landedBefore ? state === "resolved" && dischargedBy === stampOf(increment.id, previous?.pr) : state === "routed";
      if (!owed) continue;
      const reopen = elsewhere.has(id) && route !== undefined
        ? { state: "routed" as const, dischargedBy: undefined }
        : { state: "open" as const, route: undefined, routeReason: undefined, dischargedBy: undefined };
      await this.#records.edit(id, reopen, write);
    }
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
  async #checkNames(fields: { readonly capabilities?: unknown; readonly links?: unknown; readonly remedies?: unknown; readonly heldOn?: unknown; readonly escape?: Escape | undefined; readonly risk?: RiskLine | undefined }): Promise<void> {
    await checkReferences(this.#records, "capabilities", fields.capabilities, "capability");
    await checkReferences(this.#records, "links", fields.links, "record");
    await checkReferences(this.#records, "remedies", fields.remedies, "friction");
    await checkReferences(this.#records, "heldOn", fields.heldOn, "question");
    // A cause that is neither a pull request nor an increment's id is the schema's to refuse.
    if (fields.escape?.causedBy.startsWith("increment_") === true) await checkReference(this.#records, "escape.causedBy", fields.escape.causedBy, "increment");
    await checkReference(this.#records, "escape.story", fields.escape?.story, "story");
    await checkReferences(this.#records, "risk.stories", fields.risk?.stories, "story");
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
    if (record.type === "arc") return holdsOf(record.fields.waits, (wait) => this.arcWaitHold(wait));
    const increment = record as IncrementFacts;
    if (increment.fields.status === "closed") return [];
    return [
      ...holdsOf(increment.fields.waits, (wait) => this.incrementHold(wait)),
      ...holdsOf(this.arcs.get(increment.fields.arc)?.fields.waits, (wait) => this.arcWaitHold(wait)),
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

  /** Whether an arc's wait holds: on an arc, as arcHold reads it; on an increment, as incrementHold does (11.9). */
  arcWaitHold(wait: Wait): Hold | undefined {
    return this.arcs.has(wait.on) ? this.arcHold(wait) : this.incrementHold(wait);
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

/** Why a close or a settling dropped `count` pending plan changes (ADR-0966 D6). */
function droppedReason(count: number, disposition: string): string {
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

/** Where `status` sits in the lifecycle. */
function rank(status: string): number {
  return (INCREMENT_STATUSES as readonly string[]).indexOf(status);
}

/** The delivery stamp a landing leaves on the friction it remedies: its pull request as `#n`, or the increment itself when it has none. */
function stampOf(increment: string, pr: string | undefined): string {
  if (pr === undefined) return increment;
  return /^\d+$/.test(pr) ? `#${pr}` : pr;
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

/** `tree` with `pending` laid over, as WorkInFlight.withPending gives it. */
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
