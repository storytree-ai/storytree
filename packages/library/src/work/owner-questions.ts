/**
 * Capability 12 · Owner questions (the library story): a question is raised on an arc and settled
 * with the owner's answer, which stays on it. An open increment held on an open question is waiting
 * on him, and heldOnQuestion is the one answer to that. A question work is held on cannot be retired
 * (12.4), except by WorkInFlight's retireQuestion, which releases its holders in the same step: the
 * increment's heldOn, like its other fields, is capability 10's to write (wait-writes.ts, ADR-1242 D2).
 * An open question carries a review lease (12-a, restored by ADR-0654): the day it was last checked to
 * still hold and how many days that is trusted for, 7 unless given. checkQuestion reads it fresh or
 * lapsed, renewQuestion re-stamps it, refusing a settled question, and lapsedQuestions is the
 * librarian's drain.
 * A question links the evidence it cites (12.17, 12.18, ADR-1304): the ids it is raised with and every live library record its
 * words name, never the plan or an arc; a settled question still gains a link, its wording frozen (12.7).
 * For the assistant pass (ADR-1231 D3), an open question takes a would-be answer (predictQuestion, 12.12), kept in its
 * own prediction record so no read of the question carries it (12.14), and a prep mark (prepQuestion, 12.15); settled,
 * it takes one score (scoreQuestion, 12.13), and questionDeviation counts the scores per confidence band (3.23).
 *
 * WorkInFlight (capability 10) serializes each write; the rules for raising, reading, renewing,
 * correcting, moving and settling a question are here.
 */
import { byCreation } from "../creation-order.js";
import { KNOWLEDGE_KINDS } from "../knowledge/knowledge.js";
import { checkReference, checkReferences, liveRecord, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import { VERDICTS, type FieldsOf, type RecordType } from "../schema/types.js";

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
  /** The evidence it cites (12.17): a settled question takes this alone, keeping every link it had (12.7). */
  readonly links?: readonly string[];
  /** The session putting it to the owner now (12.10), or undefined once it no longer is. */
  readonly presenting?: { readonly session: string; readonly since: string } | undefined;
}

/** How a question is settled: the owner's answer, and the decision that carried it, if one did. */
export interface Settlement {
  readonly answer: string;
  /** A live decision. */
  readonly decision?: string;
}

/** A would-be answer as it is given (12.12): its pick, confidence and why; it is stamped with its time. */
export type WouldBeAnswer = Omit<FieldsOf<"prediction">, "question" | "at">;

/** How an answer given ahead of the owner compares with his (12.13). */
export type Verdict = (typeof VERDICTS)[number];

/** A settled question's score (12.13): one verdict for its would-be answer and one for its raiser's recommendation, each where it had one, and who scored it. */
export interface Score {
  readonly prediction?: Verdict;
  readonly recommendation?: Verdict;
  readonly by: string;
}

/** A prep mark as it is given (12.15): the stance on the raiser's recommendation, with the reason when it differs or proposes retire. */
export interface Prep {
  readonly stance: "agrees" | "differs" | "retire";
  readonly reason?: string;
}

/** One confidence band of a deviation report (3.23): "none" holds the questions scored with no would-be answer. */
export interface DeviationBand {
  readonly band: "high" | "medium" | "low" | "none";
  /** The scored questions in it. */
  readonly questions: number;
  /** How its would-be answers scored; absent for "none". */
  readonly prediction?: Readonly<Record<Verdict, number>>;
  /** How the raisers' recommendations on the same questions scored. */
  readonly recommendation: Readonly<Record<Verdict, number>>;
}

/** The questions settled in a window, scored per confidence band beside their raisers' recommendations (3.23). */
export interface QuestionDeviation {
  readonly settled: number;
  readonly unscored: number;
  /** The bands with a scored question in them: high, medium, low, then none. */
  readonly bands: readonly DeviationBand[];
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

/** The fields editQuestion changes: a question's wording (12.7), its evidence (12.17), and who is putting it to the owner (12.10). */
const QUESTION_WORDING: ReadonlySet<string> = new Set(["title", "stakes", "statement", "context", "options", "analogy", "diagram", "recommendation", "links", "presenting"]);

/** The kinds a question links as its evidence (12.17): live library records, never the plan or an arc. */
export const EVIDENCE_TYPES: readonly RecordType[] = ["decision", "definition", ...KNOWLEDGE_KINDS, "increment", "question"];

const EVIDENCE: Expected = {
  name: "library record",
  types: EVIDENCE_TYPES,
  why: "a question links the evidence it cites: notes, decisions, research, increments and other questions, never the plan or an arc",
};

/** A record id in a question's words; a dotted one (a voice note's, voice.note_…) is quoted, not linked. */
const NAMED_ID = /(?<![\w.])[a-z]+_[0-9a-f]{12}\b/g;

/** The words of a question that may name its evidence. */
const NAMING_FIELDS = ["title", "stakes", "statement", "context", "options", "analogy", "diagram", "recommendation"] as const;

/**
 * Raise a question for the owner on a live arc (MissingReferenceError otherwise) that is not parked
 * (RangeError, with nothing written: a parked arc raises no questions, ADR-0835 D1), as `parked`
 * says. It is open, and stamped as verified now: the start of its review lease (12-a). It links the
 * ids it is given, each a live library record (MissingReferenceError otherwise, with nothing written),
 * then every other live one its words name (12.17).
 */
export async function raiseQuestion(
  records: SchemaRecords,
  parked: (arc: SchemaRecord<"arc">) => boolean,
  question: NewQuestion,
  options?: WriteOptions,
): Promise<SchemaRecord<"question">> {
  await checkReference(records, "arc", question.arc, "arc");
  await checkReferences(records, "links", question.links, EVIDENCE);
  const arc = await liveRecord(records, question.arc, ["arc"]);
  if (arc !== null && parked(arc)) {
    throw new RangeError(
      `arc ${JSON.stringify(question.arc)} is parked, so it raises no questions (ADR-0835): write what you would ask into the arc's residue, its owning increment's body, to be raised when the arc is unparked`,
    );
  }
  const links = [...new Set([...(question.links ?? []), ...(await namedEvidence(records, question))])];
  return records.create(
    "question",
    { ...question, ...(links.length === 0 ? {} : { links }), lifecycle: "open", verifiedAt: new Date().toISOString(), leaseDays: question.leaseDays ?? DEFAULT_QUESTION_LEASE_DAYS },
    options,
  );
}

/**
 * Link every live library record question `id`'s words name that it does not link yet, after its other links (12.18),
 * open or settled: the backfill, and the prep pass's catch of an id its raiser named but did not link. One with nothing
 * new writes nothing. Null, with nothing written, if `id` is not a live question.
 */
export async function linkNamedEvidence(records: SchemaRecords, id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  const links = question.fields.links ?? [];
  const added = (await namedEvidence(records, question.fields)).filter((named) => named !== id && !links.includes(named));
  if (added.length === 0) return question;
  return (await records.edit(id, { links: [...links, ...added] }, options)) as SchemaRecord<"question"> | null;
}

/** The live library records a question's words name, in the order they are first named, each once (12.17). */
async function namedEvidence(records: SchemaRecords, words: Partial<Record<(typeof NAMING_FIELDS)[number], string | undefined>>): Promise<string[]> {
  const named = new Set(NAMING_FIELDS.flatMap((field) => words[field]?.match(NAMED_ID) ?? []));
  const live: string[] = [];
  for (const id of named) if ((await liveRecord(records, id, EVIDENCE_TYPES)) !== null) live.push(id);
  return live;
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
 * Correct open question `id`'s wording in place (12.7), its links (12.17), or mark or clear the session
 * putting it to the owner (12.10): only the named fields change. Anything else (its arc, lifecycle,
 * answer or lease) is refused (RangeError), and so is editing a settled question, except to add links
 * keeping every one it had, and a link to anything but a live library record (MissingReferenceError),
 * all with nothing written: its answer stands, answered to the words it had.
 * Null, with nothing written, if `id` is not a live question.
 */
export async function editQuestion(records: SchemaRecords, id: string, fields: QuestionEdit, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const other = Object.keys(fields).find((key) => !QUESTION_WORDING.has(key));
  if (other !== undefined) {
    throw new RangeError(`editQuestion changes ${[...QUESTION_WORDING].join(", ")}, not ${JSON.stringify(other)}: a question's arc moves with moveQuestion (question move), and its answer and lease through their own verbs`);
  }
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    const kept = (question.fields.links ?? []).every((link) => fields.links?.includes(link) === true);
    if (Object.keys(fields).some((key) => key !== "links") || !kept) {
      throw new RangeError(`question ${JSON.stringify(id)} is settled, so its wording cannot change: its answer stands (it may only gain links, keeping those it has)`);
    }
  }
  await checkReferences(records, "links", fields.links, EVIDENCE);
  // Its wording corrected after its prep mark, it reads unprepared until it is prepped again (12.15).
  const { prep } = question.fields;
  const reworded = prep !== undefined && Object.keys(fields).some((key) => key !== "presenting" && key !== "links");
  return (await records.edit(id, reworded ? { ...fields, prep: { ...prep, editedAt: new Date().toISOString() } } : fields, options)) as SchemaRecord<"question"> | null;
}

/** Question `id`'s would-be answer (12.12), the one read that gives it while the question is open (12.14); null if it has none. */
export async function questionPrediction(records: SchemaRecords, id: string): Promise<SchemaRecord<"prediction"> | null> {
  return (await records.list("prediction")).find((prediction) => prediction.fields.question === id) ?? null;
}

/**
 * Record the assistant pass's would-be answer to open question `id`, stamped now (12.12), in its own record so no read
 * of the question carries it (12.14); a later one replaces it in place. A settled question refuses one (RangeError),
 * and a pick that is no option's number, retire or defer is refused (SchemaError), both with nothing written. Null,
 * with nothing written, if `id` is not a live question.
 */
export async function predictQuestion(records: SchemaRecords, id: string, answer: WouldBeAnswer, options?: WriteOptions): Promise<SchemaRecord<"prediction"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    throw new RangeError(`question ${JSON.stringify(id)} is settled, so it takes no would-be answer: the owner has answered it`);
  }
  const fields = { pick: answer.pick, confidence: answer.confidence, why: answer.why, at: new Date().toISOString() };
  const earlier = await questionPrediction(records, id);
  if (earlier !== null) return (await records.edit(earlier.id, fields, options)) as SchemaRecord<"prediction"> | null;
  return records.create("prediction", { question: id, ...fields }, options);
}

/**
 * Score settled question `id` once, now (12.13): a verdict for its would-be answer if it has one, and for its raiser's
 * recommendation if it has one, each required where there is one and refused where there is none, with who scored it.
 * An open question, one already scored, or a verdict that is not match, match-with-changes, different or rejected is
 * refused (RangeError, SchemaError), with nothing written. Null, with nothing written, if `id` is not a live question.
 */
export async function scoreQuestion(records: SchemaRecords, id: string, score: Score, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  const name = JSON.stringify(id);
  if (question.fields.lifecycle === "open") throw new RangeError(`question ${name} is open: it is scored once settled, against the owner's answer`);
  if (question.fields.score !== undefined) throw new RangeError(`question ${name} is already scored: it takes one score`);
  const predicted = (await questionPrediction(records, id)) !== null;
  const recommended = question.fields.recommendation !== undefined;
  for (const [side, has, given] of [["a would-be answer", predicted, score.prediction], ["a recommendation", recommended, score.recommendation]] as const) {
    if (has && given === undefined) throw new RangeError(`question ${name} has ${side}, so its score needs a verdict for it`);
    if (!has && given !== undefined) throw new RangeError(`question ${name} has no ${side.slice(2)} to score`);
  }
  if (!predicted && !recommended) throw new RangeError(`question ${name} has no would-be answer and no recommendation: there is nothing to score`);
  const fields = {
    ...(score.prediction === undefined ? {} : { prediction: score.prediction }),
    ...(score.recommendation === undefined ? {} : { recommendation: score.recommendation }),
    by: score.by,
    at: new Date().toISOString(),
  };
  return (await records.edit(id, { score: fields }, options)) as SchemaRecord<"question"> | null;
}

/**
 * Mark open question `id` prepped now, with its stance on the raiser's recommendation (12.15), replacing any earlier
 * mark, so it reads prepared again. A stance that differs or proposes retire needs its reason (SchemaError), and a
 * settled question refuses a mark (RangeError), both with nothing written. Null, with nothing written, if `id` is not
 * a live question.
 */
export async function prepQuestion(records: SchemaRecords, id: string, prep: Prep, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") throw new RangeError(`question ${JSON.stringify(id)} is settled, so it takes no prep mark: the one it has is the record of its prep`);
  const mark = { at: new Date().toISOString(), stance: prep.stance, ...(prep.reason === undefined ? {} : { reason: prep.reason }) };
  return (await records.edit(id, { prep: mark }, options)) as SchemaRecord<"question"> | null;
}

/**
 * The questions settled at or after `since` (3.23): how many, how many are unscored, and the scored ones per
 * confidence band of their would-be answer, each band's verdicts beside its raisers' recommendations on the same
 * questions. A read: it writes nothing.
 */
export async function questionDeviation(records: SchemaRecords, since: Date): Promise<QuestionDeviation> {
  const settled = (await records.list("question")).filter(({ fields }) => fields.settledAt !== undefined && Date.parse(fields.settledAt) >= since.getTime());
  const confidence = new Map((await records.list("prediction")).map(({ fields }) => [fields.question, fields.confidence]));
  const tally = (): Record<Verdict, number> => Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<Verdict, number>;
  const bands = (["high", "medium", "low", "none"] as const).map((band) => ({ band, questions: 0, prediction: tally(), recommendation: tally() }));
  for (const { id, fields } of settled) {
    const { score } = fields;
    if (score === undefined) continue;
    const band = bands.find((one) => one.band === (score.prediction === undefined ? "none" : (confidence.get(id) ?? "none")))!;
    band.questions += 1;
    if (score.prediction !== undefined) band.prediction[score.prediction] += 1;
    if (score.recommendation !== undefined) band.recommendation[score.recommendation] += 1;
  }
  return {
    settled: settled.length,
    unscored: settled.filter(({ fields }) => fields.score === undefined).length,
    bands: bands.filter(({ questions }) => questions > 0).map(({ band, questions, prediction, recommendation }) => ({ band, questions, ...(band === "none" ? {} : { prediction }), recommendation })),
  };
}

/**
 * Move open question `id` to arc `arc` in place (12.11), keeping its id, wording, lease and the
 * increments held on it; its history records the move with `reason`. The arc must be live
 * (MissingReferenceError otherwise) and not closed, as `closed` says (RangeError: an open question
 * would reopen it). A parked arc takes it, and the question parks with it (ADR-0835 D2): a move is
 * not a new question. Moving a settled question, or to the arc it is on, is refused (RangeError),
 * all with nothing written. Null, with nothing written, if `id` is not a live question.
 */
export async function moveQuestion(
  records: SchemaRecords,
  closed: (arc: string) => Promise<boolean>,
  id: string,
  arc: string,
  reason: string,
  options?: WriteOptions,
): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    throw new RangeError(`question ${JSON.stringify(id)} is settled, so it stays on the arc it was asked on: its answer stands there`);
  }
  await checkReference(records, "arc", arc, "arc");
  if (question.fields.arc === arc) throw new RangeError(`question ${JSON.stringify(id)} is already on arc ${JSON.stringify(arc)}`);
  if (await closed(arc)) throw new RangeError(`arc ${JSON.stringify(arc)} is closed and takes nothing new: move ${JSON.stringify(id)} to a live arc`);
  return (await records.edit(id, { arc }, { ...options, reason })) as SchemaRecord<"question"> | null;
}

/**
 * The open questions whose lease has lapsed at `at`, across every arc, longest lapsed first (one
 * never stamped before any): the librarian's lapsed-questions drain (12-a).
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
 * it, which must be a live decision; it is no longer being put to him (12.10). WorkInFlight takes it
 * off every increment's heldOn in the same step (10.39). A settlement with no answer is refused (SchemaError),
 * and so is settling a settled question. Null, with nothing written, if `id` is not a live question.
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
    presenting: undefined,
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
