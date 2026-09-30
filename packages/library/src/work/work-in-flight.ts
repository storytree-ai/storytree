/**
 * Capability 10 · Work in flight (the library story, ADR-0640): each arc whole, with its
 * increments. An increment moves proposal → ready → active → closed, only ever forward; closed, it
 * stays as the arc's log entry, with the day it closed, its pull request, its note and whether it
 * landed, failed or was withdrawn. An arc's state is worked out from its increments on every read:
 * closed when none is open, active otherwise or while it has none, and parked, the one state that
 * is stored, while the owner has parked it (10-b). New work parked on a closed arc reopens it (R1).
 *
 * Capability 11 · Waits: an arc waits on an arc, and an increment on an increment on any arc, each
 * with a reason, and a wait that would close a loop across both kinds is refused when it is written.
 * waitHolds is the one answer to whether a wait still holds.
 *
 * Capability 12 · Owner questions: a question is raised on an arc and settled with the owner's
 * answer, which stays on it. An open increment held on an open question is waiting on him, and
 * heldOnQuestion is the one answer to that. A question work is held on cannot be retired. An open
 * question carries a review lease (12-a, restored by ADR-0654): the day it was last checked to still
 * hold and how many days that is trusted for, 7 unless given. checkQuestion reads it fresh or lapsed,
 * renewQuestion re-stamps it, refusing a settled question, and lapsedQuestions is the librarian's drain.
 *
 * The increment's shape and the rules across its fields (a proposal carries when it was parked; a
 * closed increment its outcome; a close with no pull request a note) are capability 3's, checked
 * inside every write (schema/types.ts). What this layer checks before writing is what a schema
 * cannot see: that the arc, and every story, capability and friction an increment names, is live,
 * and that an increment moves only forward. A refusal throws with nothing written.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord, recordNamed, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
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
  /** The open questions it is held on (capability 12): each must be a live question. */
  readonly heldOn?: string[];
  readonly outcome?: CloseInput;
}

/** An edit of what an increment is. Its arc, status and outcome move only through their own verbs. */
export interface IncrementEdit {
  readonly title?: string;
  readonly objective?: string;
  readonly body?: string;
  readonly touches?: string[] | undefined;
  readonly remedies?: string[] | undefined;
  readonly heldOn?: string[] | undefined;
}

/** A new question for the owner, on a live arc (capability 12). */
export type NewQuestion = Omit<FieldsOf<"question">, "lifecycle" | "answer" | "settledAt" | "settledBy" | "verifiedAt">;

/**
 * A correction to an open question's wording (12.7): any of the fields it was raised with that say
 * what is asked. An optional one set to undefined is removed.
 */
export interface QuestionEdit {
  readonly title?: string;
  readonly stakes?: string;
  readonly statement?: string;
  readonly context?: string;
  readonly options?: string;
  readonly analogy?: string | undefined;
  readonly diagram?: string | undefined;
  readonly recommendation?: string | undefined;
}

/** How a question is settled: the owner's answer, and the decision that carried it, if one did. */
export interface Settlement {
  readonly answer: string;
  /** A live decision. */
  readonly decision?: string;
}

/** How long a question's review is trusted for, in days, unless it is raised with its own (12-a). */
export const DEFAULT_QUESTION_LEASE_DAYS = 7;

/** A question's review lease as read at one moment (12-a). */
export interface QuestionLease {
  readonly id: string;
  /**
   * Fresh while its lease runs, lapsed once it has run out (or it was never stamped), and settled
   * once the owner has answered it: a settled question's lease no longer applies.
   */
  readonly state: "fresh" | "lapsed" | "settled";
  /** When it was last checked to still hold (ISO 8601), if it ever was. */
  readonly verifiedAt?: string;
  readonly leaseDays: number;
  /** When its lease runs out (ISO 8601): verifiedAt plus leaseDays. Absent if it was never stamped. */
  readonly lapsesAt?: string;
}

/** An arc whole: its record, its state, its increments and its questions, oldest first. */
export interface ArcView {
  readonly arc: SchemaRecord<"arc">;
  readonly state: ArcState;
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

/**
 * Every hold on a project's live work at once (11.5): each live arc's and increment's wait holds,
 * and each increment's owner holds, keyed by id, each as waitHolds and heldOnQuestion give it.
 */
export interface Holds {
  readonly waits: Readonly<Record<string, Hold[]>>;
  readonly heldOn: Readonly<Record<string, string[]>>;
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

/**
 * A question some increment is held on cannot be retired (12.4): retiring it would leave the work
 * pointing at nothing. The message names the question and the increments held on it.
 */
export class RetireRefusedError extends Error {
  readonly id: string;
  /** The increments held on it. */
  readonly heldBy: readonly string[];

  constructor(id: string, heldBy: readonly string[]) {
    super(
      `question ${JSON.stringify(id)} cannot be retired: ${heldBy.map((held) => JSON.stringify(held)).join(", ")} ` +
        "hold on it (take it off their heldOn first, or settle it instead)",
    );
    this.name = "RetireRefusedError";
    this.id = id;
    this.heldBy = [...heldBy];
  }
}

/** One wait, as an arc or increment stores it. */
type Wait = { readonly on: string; readonly reason: string };

const TOUCHABLE: Expected = { name: "story or capability", types: ["story", "capability"] };
const EDITABLE: ReadonlySet<string> = new Set(["title", "objective", "body", "touches", "remedies", "heldOn"]);

/** The fields editQuestion changes: a question's wording (12.7). */
const QUESTION_WORDING: ReadonlySet<string> = new Set(["title", "stakes", "statement", "context", "options", "analogy", "diagram", "recommendation"]);

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
   * Move an increment on to `to`, `ready` or `active`, and only forward (LifecycleError otherwise).
   * Null, with nothing written, if `id` is not a live increment.
   */
  advanceIncrement(id: string, to: "ready" | "active", options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      const from = increment.fields.status;
      if (!(to === "ready" || to === "active") || rank(to) <= rank(from)) throw new LifecycleError(id, from, to);
      return (await this.#records.edit(id, { status: to }, options)) as SchemaRecord<"increment"> | null;
    });
  }

  /**
   * Close an increment, recording the day, its pull request, its note and what the close meant. A
   * close with no pull request needs a note (SchemaError); closing a closed one is refused
   * (LifecycleError). Null, with nothing written, if `id` is not a live increment.
   */
  closeIncrement(id: string, close: CloseInput, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status === "closed") throw new LifecycleError(id, "closed", "closed");
      return (await this.#records.edit(id, { status: "closed", outcome: outcomeOf(close) }, options)) as SchemaRecord<"increment"> | null;
    });
  }

  /**
   * Change what an increment is: its title, objective, body, or what it touches and remedies, each
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
   * Make `waiter` wait on `blocker`, with a reason: an arc on a live arc, an increment on a live
   * increment on any arc (MissingReferenceError otherwise). Waiting again on the same blocker
   * replaces the reason. A wait that would close a loop across arcs and increments is refused with
   * a WaitLoopError naming it. Null, with nothing written, if `waiter` is not a live arc or increment.
   */
  addWait(waiter: string, blocker: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#serially(async () => {
      const record = await liveRecord(this.#records, waiter, ["arc", "increment"]);
      if (record === null) return null;
      await checkReference(this.#records, "on", blocker, record.type);
      const stored: readonly Wait[] = record.fields.waits ?? [];
      const waits = stored.some((wait) => wait.on === blocker)
        ? stored.map((wait) => (wait.on === blocker ? { on: blocker, reason } : wait))
        : [...stored, { on: blocker, reason }];
      await this.#refuseLoop(waiter, waits);
      return (await this.#records.edit(waiter, { waits }, options)) as SchemaRecord<"arc" | "increment"> | null;
    });
  }

  /** Stop `waiter` waiting on `blocker`. Null, with nothing written, if `waiter` is not a live arc or increment. */
  removeWait(waiter: string, blocker: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#serially(async () => {
      const record = await liveRecord(this.#records, waiter, ["arc", "increment"]);
      if (record === null) return null;
      const waits = (record.fields.waits ?? []).filter((wait) => wait.on !== blocker);
      return (await this.#records.edit(waiter, { waits: waits.length === 0 ? undefined : waits }, options)) as SchemaRecord<"arc" | "increment"> | null;
    });
  }

  /**
   * The blockers still holding `id`'s waits, in the order its waits were written, each with its
   * reason and whether it can never release. An increment wait holds until its blocker closes as
   * landed; an arc wait until that arc closes. An open increment is also held by its arc's waits,
   * after its own, since its arc's work cannot start; a closed increment is held by nothing. Empty
   * when nothing holds, and for an id that is not a live arc or increment.
   */
  async waitHolds(id: string): Promise<Hold[]> {
    const record = await recordNamed(this.#records, id);
    if (record === null || !(record.type === "arc" || record.type === "increment")) return [];
    return (await this.#snapshot()).waitHolds(record as SchemaRecord<"arc" | "increment">);
  }

  /**
   * Every live arc's and increment's wait holds, and every increment's owner holds, from one
   * reading of the project's work (11.5): what a surface showing all of it asks, in place of a
   * waitHolds and a heldOnQuestion per id, each of which reads all the work again.
   */
  async holds(): Promise<Holds> {
    const work = await this.#snapshot();
    const live = [...work.arcs.values(), ...work.increments.values()];
    return {
      waits: Object.fromEntries(live.map((record) => [record.id, work.waitHolds(record)])),
      heldOn: Object.fromEntries([...work.increments.values()].map((increment) => [increment.id, work.heldOn(increment)])),
    };
  }

  /**
   * Raise a question for the owner on a live arc (MissingReferenceError otherwise). It is open, and
   * stamped as verified now: the start of its review lease (12-a).
   */
  raiseQuestion(question: NewQuestion, options?: WriteOptions): Promise<SchemaRecord<"question">> {
    return this.#serially(async () => {
      await checkReference(this.#records, "arc", question.arc, "arc");
      return this.#records.create(
        "question",
        { ...question, lifecycle: "open", verifiedAt: new Date().toISOString(), leaseDays: question.leaseDays ?? DEFAULT_QUESTION_LEASE_DAYS },
        options,
      );
    });
  }

  /**
   * Question `id`'s review lease as it reads at `at` (now, unless given): fresh, lapsed or settled
   * (12-a). Null if `id` is not a live question. A read: it writes nothing.
   */
  async checkQuestion(id: string, at: Date = new Date()): Promise<QuestionLease | null> {
    const question = await liveRecord(this.#records, id, ["question"]);
    return question === null ? null : leaseOf(question, at);
  }

  /**
   * Stamp open question `id` as checked to still hold, now: its lease starts again, as long as it was.
   * Renewing a settled question is refused (RangeError), with nothing written: it has its answer, and
   * re-stamping it would only make an answered question look live (0.2's date-only renewals).
   * Null, with nothing written, if `id` is not a live question.
   */
  renewQuestion(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(async () => {
      const question = await liveRecord(this.#records, id, ["question"]);
      if (question === null) return null;
      if (question.fields.lifecycle === "settled") {
        throw new RangeError(`question ${JSON.stringify(id)} is settled, so there is nothing to renew: its answer stands`);
      }
      return (await this.#records.edit(id, { verifiedAt: new Date().toISOString() }, options)) as SchemaRecord<"question"> | null;
    });
  }

  /**
   * Correct open question `id`'s wording in place (12.7): only the named fields change. Anything but
   * its wording (its arc, lifecycle, answer or lease) is refused (RangeError), and so is editing a
   * settled question, both with nothing written: its answer stands, answered to the words it had.
   * Null, with nothing written, if `id` is not a live question.
   */
  editQuestion(id: string, fields: QuestionEdit, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(async () => {
      const other = Object.keys(fields).find((key) => !QUESTION_WORDING.has(key));
      if (other !== undefined) {
        throw new RangeError(`editQuestion changes ${[...QUESTION_WORDING].join(", ")}, not ${JSON.stringify(other)}: a question's arc, answer and lease move through their own verbs`);
      }
      const question = await liveRecord(this.#records, id, ["question"]);
      if (question === null) return null;
      if (question.fields.lifecycle === "settled") {
        throw new RangeError(`question ${JSON.stringify(id)} is settled, so its wording cannot change: its answer stands`);
      }
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"question"> | null;
    });
  }

  /**
   * The open questions whose lease has lapsed at `at` (now, unless given), across every arc, longest
   * lapsed first (one never stamped before any): the librarian's Queues drain (12-a).
   */
  async lapsedQuestions(at: Date = new Date()): Promise<SchemaRecord<"question">[]> {
    const lapsed = (await this.#records.list("question"))
      .map((question) => ({ question, lease: leaseOf(question, at) }))
      .filter(({ lease }) => lease.state === "lapsed");
    const runOut = (lease: QuestionLease): number => (lease.lapsesAt === undefined ? -Infinity : Date.parse(lease.lapsesAt));
    return lapsed.sort((a, b) => runOut(a.lease) - runOut(b.lease) || byCreation(a.question, b.question)).map(({ question }) => question);
  }

  /**
   * Settle a question with the owner's answer, kept on it with when and the decision that carried
   * it, which must be a live decision. A settlement with no answer is refused (SchemaError), and so
   * is settling a settled question. Null, with nothing written, if `id` is not a live question.
   */
  settleQuestion(id: string, settlement: Settlement, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(async () => {
      const question = await liveRecord(this.#records, id, ["question"]);
      if (question === null) return null;
      if (question.fields.lifecycle === "settled") throw new RangeError(`question ${JSON.stringify(id)} is already settled`);
      await checkReference(this.#records, "decision", settlement.decision, "decision");
      return (await this.#records.edit(id, {
        lifecycle: "settled",
        answer: settlement.answer,
        settledAt: new Date().toISOString(),
        settledBy: settlement.decision,
      }, options)) as SchemaRecord<"question"> | null;
    });
  }

  /** The questions raised on arc `arcId`, open and settled, oldest first. */
  async questions(arcId: string): Promise<SchemaRecord<"question">[]> {
    return (await this.#records.list("question")).filter((question) => question.fields.arc === arcId).sort(byCreation);
  }

  /**
   * The open questions an increment is held on, in the order it names them: the one answer to
   * whether it is waiting on the owner. Empty when it is not: it is closed, it names none, each it
   * names is settled, or names no question at all (11-a: a missing question holds nothing).
   */
  async heldOnQuestion(incrementId: string): Promise<string[]> {
    const increment = await liveRecord(this.#records, incrementId, ["increment"]);
    if (increment === null || increment.fields.status === "closed") return [];
    return heldOnOpen(increment, await this.#records.list("question"));
  }

  /**
   * Retire a record, as capability 2's retire does, except a question an increment is held on,
   * which is refused (RetireRefusedError) with nothing written.
   */
  retire(id: string, reason: string, options?: WriteOptions): Promise<void> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["question"])) !== null) {
        const heldBy = (await this.#records.list("increment")).filter((increment) => increment.fields.heldOn?.includes(id) === true);
        if (heldBy.length > 0) throw new RetireRefusedError(id, heldBy.sort(byCreation).map((increment) => increment.id));
      }
      await this.#records.retire(id, reason, options);
    });
  }

  /** Park an arc: it reads parked, whatever its work, until unparked. Null if `id` is not a live arc. */
  parkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#setParked(id, true, options);
  }

  /** Unpark an arc: its state is worked out from its increments again. Null if `id` is not a live arc. */
  unparkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#setParked(id, undefined, options);
  }

  /** The arc whole, with its state, its increments and its questions, oldest first; null if `id` is not a live arc. */
  async arcView(id: string): Promise<ArcView | null> {
    const arc = await liveRecord(this.#records, id, ["arc"]);
    if (arc === null) return null;
    const increments = (await this.#records.list("increment")).filter((increment) => increment.fields.arc === id).sort(byCreation);
    const questions = await this.questions(id);
    return { arc, state: arcState(arc, increments, questions), increments, questions };
  }

  /** Every live arc, increment and question, and what each wait of theirs reads as, now. */
  async #snapshot(): Promise<Snapshot> {
    const [arcs, increments, questions] = await Promise.all([
      this.#records.list("arc"),
      this.#records.list("increment"),
      this.#records.list("question"),
    ]);
    return new Snapshot(arcs, increments, questions);
  }

  /**
   * Throw a WaitLoopError if `waiter` waiting on `waits` would close a loop. The graph is arc and
   * increment waits as one (11-b): an arc waits on the arcs it names, and cannot close until each
   * of its open increments has; an open increment waits on the increments it names, and on the
   * arcs its arc waits on. A closed increment waits on nothing and holds up nothing, and it never
   * reopens, so it can be in no loop. The loop is looked for from the waiter, and, for an arc, from
   * each of its open increments, oldest first, since their waits change with it.
   */
  async #refuseLoop(waiter: string, waits: readonly Wait[]): Promise<void> {
    const work = await this.#snapshot();
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

  #setParked(id: string, parked: true | undefined, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["arc"])) === null) return null;
      return (await this.#records.edit(id, { parked }, options)) as SchemaRecord<"arc"> | null;
    });
  }

  /**
   * What an increment touches must be live stories or capabilities, what it remedies live friction
   * (10-a), and what it is held on live questions (12).
   */
  async #checkNames(fields: { readonly touches?: unknown; readonly remedies?: unknown; readonly heldOn?: unknown }): Promise<void> {
    await checkReferences(this.#records, "touches", fields.touches, TOUCHABLE);
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

/** A question's review lease at `at` (12-a): an unparseable stamp reads as never stamped. */
function leaseOf(question: SchemaRecord<"question">, at: Date): QuestionLease {
  const { verifiedAt, leaseDays = DEFAULT_QUESTION_LEASE_DAYS, lifecycle } = question.fields;
  const stamped = verifiedAt === undefined ? Number.NaN : Date.parse(verifiedAt);
  const lapsesAt = Number.isNaN(stamped) ? undefined : stamped + leaseDays * 86_400_000;
  const state = lifecycle === "settled" ? "settled" : lapsesAt !== undefined && at.getTime() < lapsesAt ? "fresh" : "lapsed";
  return {
    id: question.id,
    state,
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
    leaseDays,
    ...(lapsesAt === undefined ? {} : { lapsesAt: new Date(lapsesAt).toISOString() }),
  };
}

/** The live arcs, increments and questions at one moment, and how their waits read then. */
class Snapshot {
  readonly arcs: ReadonlyMap<string, SchemaRecord<"arc">>;
  readonly increments: ReadonlyMap<string, SchemaRecord<"increment">>;
  readonly #byArc = new Map<string, SchemaRecord<"increment">[]>();
  readonly #questionsByArc = new Map<string, SchemaRecord<"question">[]>();
  readonly #questions: readonly SchemaRecord<"question">[];

  constructor(
    arcs: readonly SchemaRecord<"arc">[],
    increments: readonly SchemaRecord<"increment">[],
    questions: readonly SchemaRecord<"question">[],
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
  waitHolds(record: SchemaRecord<"arc" | "increment">): Hold[] {
    if (record.type === "arc") return holdsOf(record.fields.waits, (wait) => this.arcHold(wait));
    const increment = record as SchemaRecord<"increment">;
    if (increment.fields.status === "closed") return [];
    return [
      ...holdsOf(increment.fields.waits, (wait) => this.incrementHold(wait)),
      ...holdsOf(this.arcs.get(increment.fields.arc)?.fields.waits, (wait) => this.arcHold(wait)),
    ];
  }

  /** The open questions an increment is held on; none once it is closed (12.3). */
  heldOn(increment: SchemaRecord<"increment">): string[] {
    return increment.fields.status === "closed" ? [] : heldOnOpen(increment, this.#questions);
  }

  /** The arc's open increments, oldest first. */
  openIncrementsOf(arc: string): SchemaRecord<"increment">[] {
    return (this.#byArc.get(arc) ?? []).filter((increment) => increment.fields.status !== "closed");
  }

  /** An arc wait holds until the arc closes, and for good if the arc is missing (11.2, 11-a). */
  arcHold(wait: Wait): Hold | undefined {
    const arc = this.arcs.get(wait.on);
    if (arc === undefined) return { ...wait, forGood: true };
    const state = arcState(arc, this.#byArc.get(arc.id) ?? [], this.#questionsByArc.get(arc.id) ?? []);
    return state === "closed" ? undefined : { ...wait, forGood: false };
  }

  /**
   * An increment wait holds until the blocker closes as landed, and for good if it closed any
   * other way or is missing (11.1, 11-a).
   */
  incrementHold(wait: Wait): Hold | undefined {
    const increment = this.increments.get(wait.on);
    if (increment === undefined) return { ...wait, forGood: true };
    const { status, outcome } = increment.fields;
    if (status !== "closed") return { ...wait, forGood: false };
    return outcome?.disposition === "landed" ? undefined : { ...wait, forGood: true };
  }
}

/** The open questions among those `increment` names, in its order, each once. */
function heldOnOpen(increment: SchemaRecord<"increment">, questions: readonly SchemaRecord<"question">[]): string[] {
  const open = new Set(questions.filter((question) => question.fields.lifecycle === "open").map(({ id }) => id));
  return [...new Set(increment.fields.heldOn ?? [])].filter((id) => open.has(id));
}

/** The holds among `waits`, in order: each wait that `hold` says still holds. */
function holdsOf(waits: readonly Wait[] | undefined, hold: (wait: Wait) => Hold | undefined): Hold[] {
  return (waits ?? []).flatMap((wait) => {
    const held = hold(wait);
    return held === undefined ? [] : [{ on: held.on, reason: held.reason, forGood: held.forGood }];
  });
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

/**
 * An arc's state (10.3): parked while the owner has parked it; otherwise closed exactly when it has
 * increments, none of them is open and none of its questions waits on the owner, and active while
 * any does, or while it has no increments yet. (A drained arc still waiting on an answer stays
 * active, as 0.2's ADR-0526 settled: closed, it would leave every worklist with the question open.)
 */
function arcState(
  arc: SchemaRecord<"arc">,
  increments: readonly SchemaRecord<"increment">[],
  questions: readonly SchemaRecord<"question">[],
): ArcState {
  if (arc.fields.parked === true) return "parked";
  if (increments.length === 0) return "active";
  if (increments.some((increment) => increment.fields.status !== "closed")) return "active";
  return questions.some((question) => question.fields.lifecycle === "open") ? "active" : "closed";
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
