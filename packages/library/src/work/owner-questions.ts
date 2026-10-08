/**
 * Capability 12 · Owner questions (the library story): a question is raised on an arc and settled
 * with the owner's answer, which stays on it. An open increment held on an open question is waiting
 * on him, and heldOnQuestion is the one answer to that. A question work is held on cannot be retired.
 * An open question carries a review lease (12-a, restored by ADR-0654): the day it was last checked to
 * still hold and how many days that is trusted for, 7 unless given. checkQuestion reads it fresh or
 * lapsed, renewQuestion re-stamps it, refusing a settled question, and lapsedQuestions is the
 * librarian's drain.
 *
 * WorkInFlight (capability 10) serializes each write; the rules for raising, reading, renewing,
 * correcting and settling a question are here.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, liveRecord } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { FieldsOf } from "../schema/types.js";

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

/**
 * A question some increment is held on (12.4), or a capability another depends on (4.9), cannot
 * be retired: the message names the live records whose links must be dealt with first.
 */
export class RetireRefusedError extends Error {
  readonly id: string;
  /** The increments held on the question, or capabilities depending on the capability. */
  readonly heldBy: readonly string[];

  constructor(id: string, heldBy: readonly string[], field: "heldOn" | "dependsOn" = "heldOn") {
    super(
      `${field === "heldOn" ? "question" : "capability"} ${JSON.stringify(id)} cannot be retired: ` +
        `${heldBy.map((held) => JSON.stringify(held)).join(", ")} ` +
        (field === "heldOn"
          ? "hold on it (take it off their heldOn first, or settle it instead)"
          : "depend on it (take it off their dependsOn first)"),
    );
    this.name = "RetireRefusedError";
    this.id = id;
    this.heldBy = [...heldBy];
  }
}

/** The fields editQuestion changes: a question's wording (12.7). */
const QUESTION_WORDING: ReadonlySet<string> = new Set(["title", "stakes", "statement", "context", "options", "analogy", "diagram", "recommendation"]);

/**
 * Raise a question for the owner on a live arc (MissingReferenceError otherwise) that is not parked
 * (RangeError, with nothing written: a parked arc raises no questions, ADR-0835 D1), as `parked`
 * says. It is open, and stamped as verified now: the start of its review lease (12-a).
 */
export async function raiseQuestion(
  records: SchemaRecords,
  parked: (arc: SchemaRecord<"arc">) => boolean,
  question: NewQuestion,
  options?: WriteOptions,
): Promise<SchemaRecord<"question">> {
  await checkReference(records, "arc", question.arc, "arc");
  const arc = await liveRecord(records, question.arc, ["arc"]);
  if (arc !== null && parked(arc)) {
    throw new RangeError(
      `arc ${JSON.stringify(question.arc)} is parked, so it raises no questions (ADR-0835): write what you would ask into the arc's residue, its owning increment's body, to be raised when the arc is unparked`,
    );
  }
  return records.create(
    "question",
    { ...question, lifecycle: "open", verifiedAt: new Date().toISOString(), leaseDays: question.leaseDays ?? DEFAULT_QUESTION_LEASE_DAYS },
    options,
  );
}

/**
 * Question `id`'s review lease as it reads at `at`: fresh, lapsed or settled (12-a). Null if `id` is
 * not a live question. A read: it writes nothing.
 */
export async function checkQuestion(records: SchemaRecords, id: string, at: Date): Promise<QuestionLease | null> {
  const question = await liveRecord(records, id, ["question"]);
  return question === null ? null : leaseOf(question, at);
}

/**
 * Stamp open question `id` as checked to still hold, now: its lease starts again, as long as it was.
 * Renewing a settled question is refused (RangeError), with nothing written: it has its answer, and
 * re-stamping it would only make an answered question look live (0.2's date-only renewals).
 * Null, with nothing written, if `id` is not a live question.
 */
export async function renewQuestion(records: SchemaRecords, id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    throw new RangeError(`question ${JSON.stringify(id)} is settled, so there is nothing to renew: its answer stands`);
  }
  return (await records.edit(id, { verifiedAt: new Date().toISOString() }, options)) as SchemaRecord<"question"> | null;
}

/**
 * Correct open question `id`'s wording in place (12.7): only the named fields change. Anything but
 * its wording (its arc, lifecycle, answer or lease) is refused (RangeError), and so is editing a
 * settled question, both with nothing written: its answer stands, answered to the words it had.
 * Null, with nothing written, if `id` is not a live question.
 */
export async function editQuestion(records: SchemaRecords, id: string, fields: QuestionEdit, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const other = Object.keys(fields).find((key) => !QUESTION_WORDING.has(key));
  if (other !== undefined) {
    throw new RangeError(`editQuestion changes ${[...QUESTION_WORDING].join(", ")}, not ${JSON.stringify(other)}: a question's arc, answer and lease move through their own verbs`);
  }
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    throw new RangeError(`question ${JSON.stringify(id)} is settled, so its wording cannot change: its answer stands`);
  }
  return (await records.edit(id, fields, options)) as SchemaRecord<"question"> | null;
}

/**
 * The open questions whose lease has lapsed at `at`, across every arc, longest lapsed first (one
 * never stamped before any): the librarian's Queues drain (12-a).
 */
export async function lapsedQuestions(records: SchemaRecords, at: Date): Promise<SchemaRecord<"question">[]> {
  const lapsed = (await records.list("question"))
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
export async function settleQuestion(records: SchemaRecords, id: string, settlement: Settlement, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") throw new RangeError(`question ${JSON.stringify(id)} is already settled`);
  await checkReference(records, "decision", settlement.decision, "decision");
  return (await records.edit(id, {
    lifecycle: "settled",
    answer: settlement.answer,
    settledAt: new Date().toISOString(),
    settledBy: settlement.decision,
  }, options)) as SchemaRecord<"question"> | null;
}

/**
 * The open questions an increment is held on, in the order it names them: the one answer to
 * whether it is waiting on the owner. Empty when it is not: it is closed, it names none, each it
 * names is settled, or names no question at all (11-a: a missing question holds nothing).
 */
export async function heldOnQuestion(records: SchemaRecords, incrementId: string): Promise<string[]> {
  const increment = await liveRecord(records, incrementId, ["increment"]);
  if (increment === null || increment.fields.status === "closed") return [];
  return heldOnOpen(increment, await records.list("question"));
}

/** Refuse (RetireRefusedError) retiring question `id` while any increment is held on it (12.4). */
export async function refuseRetiringHeld(records: SchemaRecords, id: string): Promise<void> {
  const heldBy = (await records.list("increment")).filter((increment) => increment.fields.heldOn?.includes(id) === true);
  if (heldBy.length > 0) throw new RetireRefusedError(id, heldBy.sort(byCreation).map((increment) => increment.id));
}

/** The open questions among those `increment` names, in its order, each once. */
export function heldOnOpen(
  increment: { readonly fields: { readonly heldOn?: readonly string[] | undefined } },
  questions: readonly { readonly id: string; readonly fields: { readonly lifecycle: string } }[],
): string[] {
  const open = new Set(questions.filter((question) => question.fields.lifecycle === "open").map(({ id }) => id));
  return [...new Set(increment.fields.heldOn ?? [])].filter((id) => open.has(id));
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
