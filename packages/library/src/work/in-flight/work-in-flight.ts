// Capability 10 · Arcs and increments
import { byCreation, checkReference, checkReferences, type FieldsOf, liveRecord, SchemaError, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../records/index.js";
import { INCREMENT_STATUSES } from "../schema.js";
import { Knowledge } from "../../knowledge/index.js";
import * as pending from "./pending-changes.js";
import type { AppliedPending, Pended, PlanChange, SettledPending, StalePending } from "./pending-changes.js";
import * as questions from "../questions/owner-questions.js";
import { heldOnOpen, type NewQuestion, type Prep, type QuestionDeviation, type QuestionEdit, type QuestionLease, type Score, type Settlement, type WouldBeAnswer } from "../questions/owner-questions.js";
import * as waits from "./waits.js";
import * as waitWrites from "./wait-writes.js";
import { WorkModel, type ProjectTree } from "../../plan/index.js";
import { arcHold, claimHold, holdsOf, incrementHold, noteWaits, onClaim, type ClaimReading, type Hold, type Holds, type NoteWait, type Wait, type WaitFor } from "./waits.js";
import { checkedWaitFor, INCREMENT_BLOCKER, type WaitWrite } from "./wait-writes.js";

const FROM_HIS_ANSWER = /\b(?:voice\.note|question)_[0-9a-f]{12}\b/;
const QUESTION = /\bquestion_[0-9a-f]{12}\b/g;

export type IncrementStatus = (typeof INCREMENT_STATUSES)[number];
export type SettledQuestion = SchemaRecord<"question"> & { released: { id: string; title: string }[] };

export type ArcState = "active" | "parked" | "closed";
export type Disposition = NonNullable<FieldsOf<"increment">["outcome"]>["disposition"];

export interface CloseInput {
  readonly pr?: string;
  readonly note?: string;
  readonly disposition: Disposition;
  readonly date?: string;
}

export interface NewIncrement {
  readonly arc: string;
  readonly title: string;
  readonly objective: string;
  readonly body: string;
  readonly capabilities?: string[];
  readonly links?: string[];
  readonly remedies?: string[];
  readonly heldOn?: string[];
  readonly machine?: string;
  readonly escape?: Escape;
  readonly waits?: Wait[];
  readonly waitsFor?: (WaitWrite & { readonly note: string })[];
  readonly outcome?: CloseInput;
}

export interface IncrementEdit {
  readonly title?: string;
  readonly objective?: string;
  readonly body?: string;
  readonly capabilities?: string[] | undefined;
  readonly links?: string[] | undefined;
  readonly remedies?: string[] | undefined;
  readonly heldOn?: string[] | undefined;
  readonly machine?: string | undefined;
  readonly escape?: Escape | undefined;
  readonly risk?: RiskLine | undefined;
}

export type RiskLine = NonNullable<FieldsOf<"increment">["risk"]>;

export type Escape = NonNullable<FieldsOf<"increment">["escape"]>;

export type { AppliedPending, Pended, PendingChange, PlanChange, SettledPending, StalePending, UnappliedPending } from "./pending-changes.js";

export type NewArc = Omit<FieldsOf<"arc">, "parked">;
export type ArcEdit = { [F in keyof NewArc]?: NewArc[F] | undefined };

export interface ParkedOn {
  readonly arc: string;
  readonly title: string;
}

export interface ParkOptions extends WriteOptions {
  readonly until?: string;
}

export interface ArcView {
  readonly arc: SchemaRecord<"arc">;
  readonly state: ArcState;
  readonly wakes?: string;
  readonly increments: SchemaRecord<"increment">[];
  readonly questions: SchemaRecord<"question">[];
}

export const BOARD_INCREMENT_FIELDS = ["arc", "title", "objective", "status", "parked", "capabilities", "links", "waits", "waitsFor", "heldOn", "outcome", "machine"] as const;

export type BoardIncrement = Omit<SchemaRecord<"increment">, "fields"> & { fields: Pick<FieldsOf<"increment">, (typeof BOARD_INCREMENT_FIELDS)[number]> };

export interface BoardArcView {
  readonly arc: SchemaRecord<"arc">;
  readonly state: ArcState;
  readonly wakes?: string;
  readonly closed?: string;
  readonly increments: BoardIncrement[];
  readonly questions: SchemaRecord<"question">[];
}

export const SURVEY_INCREMENT_FIELDS = ["arc", "title", "status", "parked", "capabilities", "machine", "waits", "waitsFor", "heldOn", "outcome"] as const;

export type SurveyIncrement = Omit<SchemaRecord<"increment">, "fields"> & { fields: Pick<FieldsOf<"increment">, (typeof SURVEY_INCREMENT_FIELDS)[number]> };

export interface SurveyArc {
  readonly id: string;
  readonly createdAt: string;
  readonly state: ArcState;
  readonly wakes?: string;
  readonly title?: string;
  readonly priority?: number;
  readonly openQuestions: number;
}

export interface SurveyOptions {
  readonly also?: readonly string[];
  readonly closedTitles?: boolean;
  readonly empty?: (arcs: readonly string[]) => Promise<ReadonlySet<string>>;
}

export interface WorkSurvey {
  readonly arcs: SurveyArc[];
  readonly increments: SurveyIncrement[];
  holds(reading?: ClaimReading): Holds;
}

export interface DayWindow {
  readonly from: string;
  readonly to: string;
}

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

export interface OpenListing {
  readonly increment: string;
  readonly title: string;
  readonly arc: string;
  readonly capabilities: readonly string[];
}

export function listedSaid(other: OpenListing): string {
  return `${other.capabilities.join(", ")} ${isAre(other)} already on the capabilities list of ${listingOf(other)}`;
}

export function listedNotice(other: OpenListing): string {
  return `Note: ${other.capabilities.join(", ")} ${isAre(other)} also on the capabilities list of ${listingOf(other)}; your edit is saved`;
}

const isAre = (other: OpenListing): string => (other.capabilities.length === 1 ? "is" : "are");
const listingOf = (other: OpenListing): string => `open increment ${other.increment} (${JSON.stringify(other.title)}, on arc ${other.arc})`;

export class WorkInFlight {
  readonly #records: SchemaRecords;
  readonly #work: WorkModel;
  #lastWrite: Promise<unknown> = Promise.resolve();
  readonly #knowledge: Knowledge;

  constructor(records: SchemaRecords, work: WorkModel = new WorkModel(records)) {
    this.#records = records;
    this.#work = work;
    this.#knowledge = new Knowledge(records);
  }

  addIncrement(increment: NewIncrement, options?: WriteOptions): Promise<SchemaRecord<"increment">> {
    return this.#serially(async () => {
      const { outcome, ...fields } = increment;
      await checkReference(this.#records, "arc", fields.arc, "arc");
      await this.#checkNames(fields);
      for (const { on } of fields.waits ?? []) await checkReference(this.#records, "on", on, INCREMENT_BLOCKER);
      if (outcome === undefined) {
        const follows = new Set((fields.waits ?? []).map(({ on }) => on));
        const shared = (await this.openListing(fields.capabilities ?? [])).filter((other) => !follows.has(other.increment) && !other.capabilities.every((capability) => follows.has(capability)));
        if (shared.length > 0) {
          const claims = shared.flatMap((other) => other.capabilities).map((capability) => `${capability}'s claim`).join(" and ");
          throw new RangeError(`${shared.map(listedSaid).join("; ")}: route this work to the increment it belongs to, or, if it follows one, park it waiting on each it follows, or, if it waits only for a capability, on ${claims}`);
        }
      }
      const waitsFor = fields.waitsFor?.map(checkedWaitFor);
      if (waitsFor !== undefined && outcome !== undefined) throw new RangeError("an increment born closed waits for nothing");
      if (new Set(waitsFor?.map(({ releaser }) => releaser)).size !== (waitsFor?.length ?? 0)) throw new RangeError("an increment waits with one note per releaser");
      const lifecycle = outcome === undefined
        ? { status: "proposal" as const, parked: new Date().toISOString() }
        : { status: "closed" as const, outcome: outcomeOf(outcome), ...escapeAnswer(fields.escape, outcome) };
      const added = await this.#records.create("increment", { ...fields, ...(waitsFor === undefined || waitsFor.length === 0 ? { waitsFor: undefined } : { waitsFor }), ...lifecycle }, options);
      if (outcome !== undefined) await this.#offerFindings(added, outcome, options);
      return added;
    });
  }

  async openListing(capabilities: readonly string[], except?: string): Promise<OpenListing[]> {
    if (capabilities.length === 0) return [];
    const open = await this.#records.select("increment", ["title", "arc", "capabilities"], { not: { status: "closed" } });
    return open
      .filter((other) => other.id !== except)
      .map((other) => ({ increment: other.id, title: other.fields.title, arc: other.fields.arc, capabilities: capabilities.filter((id) => (other.fields.capabilities ?? []).includes(id)) }))
      .filter((other) => other.capabilities.length > 0);
  }

  advanceIncrement(id: string, to: "active", options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      const from = increment.fields.status;
      if (to !== "active" || rank(to) <= rank(from)) throw new LifecycleError(id, from, to);
      return (await this.#records.edit(id, { status: to }, options)) as SchemaRecord<"increment"> | null;
    });
  }

  returnIncrement(id: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status !== "active") throw new LifecycleError(id, increment.fields.status, "proposal");
      const parked = increment.fields.parked ?? new Date().toISOString();
      return (await this.#records.edit(id, { status: "proposal", parked }, options)) as SchemaRecord<"increment"> | null;
    });
  }

  closeIncrement(id: string, close: CloseInput, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      let increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status === "closed") throw new LifecycleError(id, "closed", "closed");
      if (close.disposition === "landed" && (increment.fields.pending ?? []).length > 0) {
        await pending.applyPending(this.#records, this.#work, this.#retireOne, increment, close.pr, options);
        increment = (await liveRecord(this.#records, id, ["increment"]))!;
      }
      const dropped = increment.fields.pending?.length ?? 0;
      const fields = { status: "closed" as const, outcome: outcomeOf(close), ...escapeAnswer(increment.fields.escape, close), ...(dropped === 0 ? {} : { pending: undefined }) };
      const write = dropped === 0 ? options : { ...options, reason: pending.droppedReason(dropped, close.disposition) };
      const closed = (await this.#records.edit(id, fields, write)) as SchemaRecord<"increment"> | null;
      await this.#clearAfter(async () => {
        if (close.disposition === "landed") await waitWrites.clearWaitsOn(this.#records, "increment", id, `its blocker ${id} landed, so the wait on it is cleared`, options);
        await this.#clearIfClosed(increment.fields.arc, options);
      });
      await this.#clearAfter(() => this.#settleRemedies(increment, close, undefined, options));
      await this.#offerFindings(increment, close, options);
      return closed;
    });
  }

  async #offerFindings({ id, fields }: SchemaRecord<"increment">, close: CloseInput, options?: WriteOptions): Promise<void> {
    if (close.disposition !== "landed" || close.pr !== undefined || close.note === undefined) return;
    const from = [fields.body, ...(fields.links ?? [])].join("\n");
    if (!FROM_HIS_ANSWER.test(from)) return;
    if ((close.note.match(QUESTION) ?? []).some((question) => !from.includes(question))) return;
    const fyi = { title: `What your answer found: ${fields.title}`, what: close.note, about: id, by: options?.actor ?? "storytree", at: new Date().toISOString() };
    await this.#records.create("fyi", fyi, options);
  }

  correctIncrementClosure(id: string, close: CloseInput, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      if (increment.fields.status !== "closed") throw new RangeError(`increment ${JSON.stringify(id)} must be closed before its closure can be corrected`);
      if (typeof reason !== "string" || reason.trim() === "") throw new RangeError("correcting an increment's closure requires a nonblank reason");
      const outcome = outcomeOf({ ...close, date: close.date ?? increment.fields.outcome!.date });
      const escape = increment.fields.escape === "none" && close.disposition !== "landed" ? { escape: undefined } : escapeAnswer(increment.fields.escape, close);
      const corrected = (await this.#records.edit(id, { outcome, ...escape }, { ...options, reason })) as SchemaRecord<"increment"> | null;
      if (close.disposition === "landed") await this.#clearAfter(() => waitWrites.clearWaitsOn(this.#records, "increment", id, `its blocker ${id} landed, so the wait on it is cleared`, options));
      await this.#clearAfter(() => this.#settleRemedies(increment, close, increment.fields.outcome, options));
      return corrected;
    });
  }

  moveIncrement(id: string, arc: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      await checkReference(this.#records, "arc", arc, "arc");
      if (increment.fields.status !== "closed" && (await this.arcView(arc))?.state === "closed") {
        throw new RangeError(
          `arc ${JSON.stringify(arc)} is closed and takes nothing new: move ${JSON.stringify(id)} to a live arc, or, splitting an arc, ` +
            `move open increments before closed ones; to reopen this one for it, \`arc park ${arc}\`, move it, then \`arc unpark ${arc}\``,
        );
      }
      const moved = (await this.#records.edit(id, { arc }, { ...options, reason })) as SchemaRecord<"increment"> | null;
      await this.#clearAfter(() => this.#clearIfClosed(increment.fields.arc, options));
      return moved;
    });
  }

  editIncrement(id: string, fields: IncrementEdit, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(async () => {
      const other = Object.keys(fields).find((key) => !EDITABLE.has(key));
      if (other !== undefined) {
        throw new RangeError(`editIncrement changes ${[...EDITABLE].join(", ")}, not ${JSON.stringify(other)}: an increment's arc, status and outcome move through their own verbs`);
      }
      const increment = await liveRecord(this.#records, id, ["increment"]);
      if (increment === null) return null;
      const recorded = increment.fields.escape === "none" ? undefined : increment.fields.escape?.story;
      await this.#checkNames(fields, recorded);
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"increment"> | null;
    });
  }

  pendChange(id: string, change: PlanChange, options?: WriteOptions): Promise<Pended | null> {
    return this.#serially(() => pending.pendChange(this.#records, this.#work, id, change, options));
  }

  withPending(id: string, tree: ProjectTree): Promise<ProjectTree | null> {
    return pending.withPending(this.#records, id, tree);
  }

  stalePending(id: string): Promise<StalePending[] | null> {
    return pending.stalePending(this.#records, id);
  }

  applyPending(id: string, pr?: string, options?: WriteOptions): Promise<AppliedPending | null> {
    return this.#serially(async () => {
      const increment = await liveRecord(this.#records, id, ["increment"]);
      return increment === null ? null : pending.applyPending(this.#records, this.#work, this.#retireOne, increment, pr, options);
    });
  }

  dropPending(id: string, record: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(() => pending.dropPending(this.#records, id, record, reason, options));
  }

  settleClosedPending(options?: WriteOptions): Promise<SettledPending[]> {
    return this.#serially(() => pending.settleClosedPending(this.#records, this.#work, this.#retireOne, options));
  }

  addWait(waiter: string, blocker: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#serially(() => waitWrites.addWait(this.#records, () => this.#snapshot(), waiter, blocker, reason, options));
  }

  removeWait(waiter: string, blocker: string, options?: waitWrites.ClearOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#serially(() => waitWrites.removeWait(this.#records, waiter, blocker, options));
  }

  releaseOnVerdict(contract: string, capability: string | undefined, verdict: string, options?: WriteOptions, asOf?: number): Promise<string[]> {
    return this.#serially(() => waitWrites.releaseOnVerdict(this.#records, contract, capability, verdict, options, asOf));
  }

  addWaitFor(id: string, wait: WaitWrite, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(() => waitWrites.addWaitFor(this.#records, id, wait, options));
  }

  removeWaitFor(id: string, releaser: WaitFor["releaser"], options?: waitWrites.ClearOptions, cleared?: { readonly merged?: number }): Promise<SchemaRecord<"increment"> | null> {
    return this.#serially(() => waitWrites.removeWaitFor(this.#records, id, releaser, options, cleared));
  }

  waitsFor(id: string, at: Date = new Date()): Promise<NoteWait[]> {
    return waits.waitsFor(this.#records, id, at);
  }

  async waitHolds(id: string, { claimed }: ClaimReading = {}): Promise<Hold[]> {
    const work = await this.#snapshot();
    const record = work.arcs.get(id) ?? work.increments.get(id);
    return record === undefined ? [] : work.waitHolds(record, claimed);
  }

  async holds(at: Date = new Date(), reading: ClaimReading = {}): Promise<Holds> {
    return holdsIn(await this.#snapshot(), at, reading);
  }

  raiseQuestion(question: NewQuestion, options?: WriteOptions): Promise<SchemaRecord<"question">> {
    return this.#serially(() => questions.raiseQuestion(this.#records, (arc) => isParked(arc), question, options));
  }

  checkQuestion(id: string, at: Date = new Date()): Promise<QuestionLease | null> {
    return questions.checkQuestion(this.#records, id, at);
  }

  renewQuestion(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.renewQuestion(this.#records, id, options));
  }

  editQuestion(id: string, fields: QuestionEdit, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.editQuestion(this.#records, id, fields, options));
  }

  linkNamedEvidence(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.linkNamedEvidence(this.#records, id, options));
  }

  moveQuestion(id: string, arc: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(async () => {
      const question = await liveRecord(this.#records, id, ["question"]);
      const closed = async (to: string): Promise<boolean> => (await this.arcView(to))?.state === "closed";
      const moved = await questions.moveQuestion(this.#records, closed, id, arc, reason, options);
      if (question !== null && moved !== null) await this.#clearAfter(() => this.#clearIfClosed(question.fields.arc, options));
      return moved;
    });
  }

  predictQuestion(id: string, answer: WouldBeAnswer, options?: WriteOptions): Promise<SchemaRecord<"prediction"> | null> {
    return this.#serially(() => questions.predictQuestion(this.#records, id, answer, options));
  }

  questionPrediction(id: string): Promise<SchemaRecord<"prediction"> | null> {
    return questions.questionPrediction(this.#records, id);
  }

  scoreQuestion(id: string, score: Score, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.scoreQuestion(this.#records, id, score, options));
  }

  prepQuestion(id: string, prep: Prep, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#serially(() => questions.prepQuestion(this.#records, id, prep, options));
  }

  questionDeviation(since: Date): Promise<QuestionDeviation> {
    return questions.questionDeviation(this.#records, since);
  }

  lapsedQuestions(at: Date = new Date()): Promise<SchemaRecord<"question">[]> {
    return questions.lapsedQuestions(this.#records, at);
  }

  settleQuestion(id: string, settlement: Settlement, options?: WriteOptions): Promise<SettledQuestion | null> {
    return this.#serially(async () => {
      const settled = await questions.settleQuestion(this.#records, id, settlement, options);
      if (settled === null) return null;
      const heldBy = await waitWrites.releaseHolders(this.#records, id, options);
      await this.#clearAfter(() => this.#clearIfClosed(settled.fields.arc, options));
      const released = heldBy.filter((increment) => increment.fields.status !== "closed").map(({ id: held, fields }) => ({ id: held, title: fields.title }));
      return { ...settled, released };
    });
  }

  async questions(arcId: string): Promise<SchemaRecord<"question">[]> {
    return (await this.#records.list("question", { where: { arc: arcId } })).sort(byCreation);
  }

  heldOnQuestion(incrementId: string): Promise<string[]> {
    return questions.heldOnQuestion(this.#records, incrementId);
  }

  retireQuestion(id: string, reason: string, options?: WriteOptions): Promise<string[] | null> {
    return this.#serially(async () => {
      const question = await liveRecord(this.#records, id, ["question"]);
      if (question === null) return null;
      const heldBy = await waitWrites.releaseHolders(this.#records, id, options);
      await this.#records.retire(id, reason, options);
      await this.#clearAfter(() => this.#clearIfClosed(question.fields.arc, options));
      return heldBy.map((increment) => increment.id);
    });
  }

  retire(id: string, reason: string, options?: WriteOptions): Promise<void> {
    return this.#serially(() => this.#retire(id, reason, options));
  }

  readonly #retireOne: pending.Retire = (id, reason, options) => this.#retire(id, reason, options);

  async #retire(id: string, reason: string, options?: WriteOptions): Promise<void> {
    const record = await liveRecord(this.#records, id, ["question", "capability"]);
    if (record?.type === "question") await questions.refuseRetiringHeld(this.#records, id);
    if (record?.type === "capability") {
      const capabilities = await this.#records.select("capability", ["dependsOn"]);
      const live = new Set(capabilities.map((capability) => capability.id));
      const byEdge = (await this.#records.list("edge")).filter((edge) => edge.fields.to === id && live.has(edge.fields.from)).map((edge) => edge.fields.from);
      const dependents = [...new Set([...capabilities.filter((capability) => capability.fields.dependsOn?.includes(id) === true).map((capability) => capability.id), ...byEdge])];
      if (dependents.length > 0) throw new questions.RetireRefusedError(id, dependents, "dependsOn");
    }
    await this.#records.retire(id, reason, options);
  }


  createArc(arc: NewArc, options?: WriteOptions & { readonly id?: string; readonly onlyIfNew?: boolean }): Promise<SchemaRecord<"arc">> {
    return this.#serially(async () => {
      await checkReferences(this.#records, "stories", arc.stories, "story");
      return this.#records.create("arc", arc, options);
    });
  }

  editArc(id: string, fields: ArcEdit, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["arc"])) === null) return null;
      await checkReferences(this.#records, "stories", fields.stories, "story");
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"arc"> | null;
    });
  }

  async arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]> {
    const arcs = await this.#records.list("arc");
    return arcs.filter((arc) => arc.fields.stories?.includes(storyId) === true).sort(byCreation);
  }

  parkArc(id: string, options?: ParkOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#setParked(id, true, options);
  }

  unparkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#setParked(id, undefined, options);
  }

  async arcView(id: string, at: Date = new Date()): Promise<ArcView | null> {
    const arc = await liveRecord(this.#records, id, ["arc"]);
    if (arc === null) return null;
    const increments = (await this.#records.list("increment", { where: { arc: id } })).sort(byCreation);
    const questions = await this.questions(id);
    return arcViewOf(arc, increments, questions, at);
  }

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

  async workSurvey(at: Date = new Date(), { also = [], closedTitles = false, empty }: SurveyOptions = {}): Promise<WorkSurvey> {
    const work = await this.#snapshot(SURVEY_INCREMENT_FIELDS);
    const open = [...work.increments.values()] as unknown as SurveyIncrement[];
    const arcs = [...work.arcs.values()].sort(byCreation);
    const blockers = [...new Set(open.flatMap(({ fields }) => (fields.waits ?? []).map(({ on }) => on)))].filter((id) => !work.increments.has(id));
    const named = [...new Set(open.flatMap(({ fields }) => fields.heldOn ?? []))];
    const bare = arcs.filter((arc) => !isParked(arc, at) && work.openIncrementsOf(arc.id).length === 0 && work.questionsOf(arc.id).length === 0).map(({ id }) => id);
    const [closedBlockers, heldOnQuestions, followed, none] = await Promise.all([
      blockers.length === 0 ? [] : this.#records.select("increment", FACT_FIELDS, { ids: blockers, where: { status: "closed" } }),
      named.length === 0 ? [] : this.#records.select("question", ["arc", "lifecycle"], { ids: named }),
      also.length === 0 ? [] : this.#records.select("increment", SURVEY_INCREMENT_FIELDS, { ids: also, where: { status: "closed" } }),
      bare.length === 0 ? new Set<string>() : (empty ?? ((ids) => this.#empty(ids)))(bare),
    ]);
    const states = new Map(arcs.map((arc) => {
      const increments = [...work.openIncrementsOf(arc.id), ...closedBlockers.filter(({ fields }) => fields.arc === arc.id)].sort(byCreation);
      const asked = [...work.questionsOf(arc.id), ...heldOnQuestions.filter(({ fields }) => fields.arc === arc.id && fields.lifecycle !== "open")];
      const state = arcState(arc, increments, asked, at, !none.has(arc.id));
      const wakes = state !== "parked" ? undefined : isParked(arc, at) ? arc.fields.parkedUntil : asleepUntil(arc, increments, asked, at);
      return [arc.id, { state, wakes, openQuestions: work.questionsOf(arc.id).length }] as const;
    }));
    const titled = arcs.filter(({ id }) => closedTitles || states.get(id)?.state !== "closed").map(({ id }) => id);
    const titles = new Map((titled.length === 0 ? [] : await this.#records.select("arc", ["title", "priority"], { ids: titled })).map(({ id, fields }) => [id, fields]));
    return {
      arcs: arcs.map(({ id, createdAt }): SurveyArc => {
        const { state, wakes, openQuestions } = states.get(id)!;
        const { title, priority } = titles.get(id) ?? {};
        return { id, createdAt, state, ...(wakes === undefined ? {} : { wakes }), ...(title === undefined ? {} : { title }), ...(priority === undefined ? {} : { priority }), openQuestions };
      }),
      increments: [...open, ...followed].sort(byCreation),
      holds: (reading = {}) => holdsIn(work, at, reading),
    };
  }

  async #empty(arcs: readonly string[]): Promise<ReadonlySet<string>> {
    const held = await Promise.all(arcs.map(async (arc) => [arc, (await this.#records.select("increment", [], { where: { arc }, limit: 1 })).length > 0] as const));
    return new Set(held.filter(([, any]) => !any).map(([arc]) => arc));
  }

  boardArcs(closed: DayWindow, at: Date = new Date()): Promise<BoardArcView[]> {
    return this.#boardArcs(closed, true, at);
  }

  closedArcs(window: DayWindow, at: Date = new Date()): Promise<BoardArcView[]> {
    return this.#boardArcs(window, false, at);
  }

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

  async #snapshot(fields: readonly IncrementField[] = FACT_FIELDS): Promise<Snapshot> {
    const [arcs, increments, questions] = await Promise.all([
      this.#records.select("arc", ["waits", "parked", "parkedUntil"]),
      this.#records.select("increment", fields, { not: { status: "closed" } }),
      this.#records.select("question", ["arc", "lifecycle"], { where: { lifecycle: "open" } }),
    ]);
    const hasIncrements = new Set(increments.map(({ fields }) => fields.arc));
    const arcIds = new Set(arcs.map(({ id }) => id));
    const namedArcs = new Set(arcs.flatMap(({ fields }) => (fields.waits ?? []).map(({ on }) => on)));
    const needsExistence = [...namedArcs].filter((id) => arcIds.has(id) && !hasIncrements.has(id));
    const blockerIds = [...new Set(increments.flatMap(({ fields }) => (fields.waits ?? []).map(({ on }) => on)))];
    const claimIds = blockerIds.filter((on) => onClaim({ on, reason: "" }));
    const [landed, capabilities] = await Promise.all([
      blockerIds.length === 0 ? [] : this.#records.select("increment", [], { ids: blockerIds, where: { status: "closed", "outcome.disposition": "landed" } }),
      claimIds.length === 0 ? [] : this.#records.select("capability", ["title"], { ids: claimIds }),
      ...needsExistence.map(async (arc) => {
        if ((await this.#records.select("increment", [], { where: { arc }, limit: 1 })).length > 0) hasIncrements.add(arc);
      }),
    ]);
    const titles = new Map(capabilities.map(({ id, fields }) => [id, fields.title]));
    return new Snapshot(arcs, increments, questions, hasIncrements, new Set(landed.map(({ id }) => id)), titles);
  }


  async #clearIfClosed(id: string, options?: WriteOptions): Promise<void> {
    if ((await this.arcView(id))?.state === "closed") await waitWrites.clearWaitsOn(this.#records, "arc", id, `its blocker ${id} closed, so the wait on it is cleared`, options);
  }

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
    const undoing = landedBefore ? stampOf(increment.id, previous?.pr) : undefined;
    for (const id of remedies) {
      await this.#knowledge.settleRemedy(id, close.disposition === "landed" ? { landed: true, stamp } : { landed: false, undoing, remediedElsewhere: elsewhere.has(id) }, write);
    }
  }

  async #clearAfter(clear: () => Promise<unknown>): Promise<void> {
    try {
      await clear();
    } catch {
    }
  }

  #setParked(id: string, parked: true | undefined, options?: ParkOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#serially(async () => {
      if ((await liveRecord(this.#records, id, ["arc"])) === null) return null;
      const parkedUntil = parked === undefined ? undefined : options?.until;
      return (await this.#records.edit(id, { parked, parkedUntil }, options)) as SchemaRecord<"arc"> | null;
    });
  }

  async #checkNames(fields: { readonly capabilities?: unknown; readonly links?: unknown; readonly remedies?: unknown; readonly heldOn?: unknown; readonly escape?: Escape | undefined; readonly risk?: RiskLine | undefined }, recordedStory?: string): Promise<void> {
    await checkReferences(this.#records, "capabilities", fields.capabilities, "capability");
    await checkReferences(this.#records, "links", fields.links, "record");
    await checkReferences(this.#records, "remedies", fields.remedies, "friction");
    await checkReferences(this.#records, "heldOn", fields.heldOn, "question");
    const escape = fields.escape === "none" ? undefined : fields.escape;
    if (escape?.causedBy.startsWith("increment_") === true) await checkReference(this.#records, "escape.causedBy", escape.causedBy, "increment");
    else if (escape !== undefined && escape.commit === undefined) {
      throw new SchemaError("increment", [{ field: "escape", problem: `field "escape" names pull request ${escape.causedBy} without its merge commit: give the commit too, since pull-request numbers restarted at #2 on 2026-10-26` }]);
    }
    if (escape?.story !== recordedStory) await checkReference(this.#records, "escape.story", escape?.story, "story");
    await checkReferences(this.#records, "risk.stories", fields.risk?.stories, "story");
  }

  #serially<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#lastWrite.then(() => write());
    this.#lastWrite = result.catch(() => undefined);
    return result;
  }
}

type ArcFacts = Omit<SchemaRecord<"arc">, "fields"> & { fields: Pick<FieldsOf<"arc">, "waits" | "parked" | "parkedUntil"> };
const FACT_FIELDS = ["arc", "status", "waits", "waitsFor", "heldOn", "outcome"] as const;
type IncrementField = (typeof FACT_FIELDS)[number] | (typeof SURVEY_INCREMENT_FIELDS)[number];
type IncrementFacts = Omit<SchemaRecord<"increment">, "fields"> & { fields: Pick<FieldsOf<"increment">, (typeof FACT_FIELDS)[number]> };
type QuestionFacts = Omit<SchemaRecord<"question">, "fields"> & { fields: Pick<FieldsOf<"question">, "arc" | "lifecycle"> };

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
    readonly capabilityTitles: ReadonlyMap<string, string>,
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

  waitHolds(record: ArcFacts | IncrementFacts, claimed?: ReadonlySet<string>): Hold[] {
    if (record.type === "arc") return holdsOf(record.fields.waits, (wait) => this.arcWaitHold(wait));
    const increment = record as IncrementFacts;
    if (increment.fields.status === "closed") return [];
    return [
      ...holdsOf(increment.fields.waits, (wait) => (onClaim(wait) ? claimHold(wait, claimed, this.capabilityTitles.get(wait.on)) : this.incrementHold(wait))),
      ...holdsOf(this.arcs.get(increment.fields.arc)?.fields.waits, (wait) => this.arcWaitHold(wait)),
    ];
  }

  questionsOf(arc: string): QuestionFacts[] {
    return this.#questionsByArc.get(arc) ?? [];
  }

  heldOn(increment: IncrementFacts): string[] {
    return increment.fields.status === "closed" ? [] : heldOnOpen(increment, this.#questions);
  }

  openIncrementsOf(arc: string): IncrementFacts[] {
    return (this.#byArc.get(arc) ?? []).filter((increment) => increment.fields.status !== "closed");
  }

  arcHold(wait: Wait): Hold | undefined {
    const arc = this.arcs.get(wait.on);
    const closed = arc === undefined
      ? undefined
      : arcState(arc, this.#byArc.get(arc.id) ?? [], this.#questionsByArc.get(arc.id) ?? [], new Date(), this.hasIncrements.has(arc.id)) === "closed";
    return arcHold(wait, closed);
  }

  arcWaitHold(wait: Wait): Hold | undefined {
    return this.arcs.has(wait.on) ? this.arcHold(wait) : this.incrementHold(wait);
  }

  incrementHold(wait: Wait): Hold | undefined {
    return incrementHold(wait, this.landed.has(wait.on), this.increments.has(wait.on));
  }
}

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

function holdsIn(work: Snapshot, at: Date, { claimed }: ClaimReading): Holds {
  const live = [...work.arcs.values(), ...work.increments.values()];
  const open = [...work.increments.values()];
  return {
    waits: Object.fromEntries(live.map((record) => [record.id, work.waitHolds(record, claimed)])),
    heldOn: Object.fromEntries(open.map((increment) => [increment.id, work.heldOn(increment)])),
    waitsFor: Object.fromEntries(open.map((increment) => [increment.id, noteWaits(increment.fields.waitsFor, at)])),
  };
}

function arcViewOf(arc: SchemaRecord<"arc">, increments: SchemaRecord<"increment">[], questions: SchemaRecord<"question">[], at: Date): ArcView {
  const state = arcState(arc, increments, questions, at);
  const wakes = state !== "parked" ? undefined : isParked(arc, at) ? arc.fields.parkedUntil : asleepUntil(arc, increments, questions, at);
  return { arc, state, ...(wakes === undefined ? {} : { wakes }), increments, questions };
}

function asleepUntil(arc: ArcFacts, increments: readonly IncrementFacts[], questions: readonly QuestionFacts[], at: Date): string | undefined {
  if ((arc.fields.waits ?? []).length > 0 || questions.some((question) => question.fields.lifecycle === "open")) return undefined;
  const settled = new Set(questions.filter((question) => question.fields.lifecycle !== "open").map(({ id }) => id));
  const byId = new Map(increments.map((increment) => [increment.id, increment]));
  const days = new Map<string, string | undefined>();
  const until = (increment: IncrementFacts): string | undefined => {
    if (days.has(increment.id)) return days.get(increment.id);
    days.set(increment.id, undefined);
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

function isParked(arc: ArcFacts, at: Date = new Date()): boolean {
  const { parked, parkedUntil } = arc.fields;
  return parked === true && (parkedUntil === undefined || at.getTime() < Date.parse(`${parkedUntil}T00:00:00Z`));
}

function rank(status: string): number {
  return (INCREMENT_STATUSES as readonly string[]).indexOf(status);
}

function stampOf(increment: string, pr: string | undefined): string {
  if (pr === undefined) return increment;
  return /^\d+$/.test(pr) ? `#${pr}` : pr;
}

function escapeAnswer(escape: Escape | undefined, close: CloseInput): { escape?: Escape } {
  return close.disposition === "landed" && escape === undefined ? { escape: "none" } : {};
}

function outcomeOf(close: CloseInput): NonNullable<FieldsOf<"increment">["outcome"]> {
  return {
    date: close.date ?? new Date().toISOString().slice(0, 10),
    ...(close.pr === undefined ? {} : { pr: close.pr }),
    ...(close.note === undefined ? {} : { note: close.note }),
    disposition: close.disposition,
  };
}
