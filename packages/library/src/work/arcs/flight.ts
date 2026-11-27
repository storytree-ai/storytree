// Capability 10 · Work in flight
import { isDeepStrictEqual } from "node:util";

import { WorkModel, type ProjectTree } from "../../plan/index.js";
import { liveOf, MissingReferenceError, referTo, SchemaError, type FieldsOf, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../storage/rules/index.js";
import {
  checkQuestion,
  editQuestion,
  lapsedQuestions,
  linkNamedEvidence,
  moveQuestion,
  openQuestions,
  predictQuestion,
  prepQuestion,
  questionDeviation,
  questionPrediction,
  raiseQuestion,
  recordFyi,
  renewQuestion,
  retireQuestion,
  retireUnheld,
  RetireRefusedError,
  scoreQuestion,
  settleQuestion,
  type NewQuestion,
  type Prep,
  type QuestionDeviation,
  type QuestionEdit,
  type QuestionLease,
  type Score,
  type SettledQuestion,
  type Settlement,
  type WouldBeAnswer,
} from "../inbox/index.js";
import { LifecycleError, WaitLoopError, type IncrementStatus } from "./errors.js";
import {
  applyPending,
  droppedSaid,
  dropPending,
  pendChange,
  prSaid,
  settleClosedPending,
  stalePending,
  withPending,
  type AppliedPending,
  type Pended,
  type PlanChange,
  type SettledPending,
  type StalePending,
} from "./pending.js";
import {
  arcReading,
  byCreation,
  dayOf,
  holdOf,
  isOpen,
  noteWaits,
  OPEN_STATUSES,
  parkedNow,
  type ArcState,
  type Blocker,
  type ClaimReading,
  type Hold,
  type Holds,
  type IncrementFields,
  type NoteWait,
  type Wait,
  type WaitFor,
} from "./state.js";

export type Disposition = NonNullable<IncrementFields["outcome"]>["disposition"];
type Escape = NonNullable<IncrementFields["escape"]>;
type RiskLine = NonNullable<IncrementFields["risk"]>;

export interface CloseInput {
  readonly pr?: string;
  readonly note?: string;
  readonly disposition: Disposition;
  readonly date?: string;
}

export type WaitWrite = Omit<WaitFor, "note" | "reviewed" | "merged"> & { readonly note?: string };

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

export type NewArc = Omit<FieldsOf<"arc">, "parked">;
export type ArcEdit = { [F in keyof NewArc]?: NewArc[F] | undefined };
export type ClearOptions = WriteOptions & { readonly reason?: string };

interface ParkOptions extends WriteOptions {
  readonly until?: string;
}

export interface ParkedOn {
  readonly arc: string;
  readonly title: string;
}

export interface ArcView {
  readonly arc: SchemaRecord<"arc">;
  readonly state: ArcState;
  readonly wakes?: string;
  readonly increments: SchemaRecord<"increment">[];
  readonly questions: SchemaRecord<"question">[];
}

const BOARD_INCREMENT_FIELDS = ["arc", "title", "objective", "status", "parked", "capabilities", "links", "waits", "waitsFor", "heldOn", "outcome", "machine"] as const;
const SURVEY_INCREMENT_FIELDS = ["arc", "title", "status", "parked", "capabilities", "machine", "waits", "waitsFor", "heldOn", "outcome"] as const;

export type BoardIncrement = Omit<SchemaRecord<"increment">, "fields"> & { fields: Pick<IncrementFields, (typeof BOARD_INCREMENT_FIELDS)[number]> };
type SurveyIncrement = Omit<SchemaRecord<"increment">, "fields"> & { fields: Pick<IncrementFields, (typeof SURVEY_INCREMENT_FIELDS)[number]> };

export interface BoardArcView {
  readonly arc: SchemaRecord<"arc">;
  readonly state: ArcState;
  readonly wakes?: string;
  readonly closed?: string;
  readonly increments: BoardIncrement[];
  readonly questions: SchemaRecord<"question">[];
}

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

export interface OpenListing {
  readonly increment: string;
  readonly title: string;
  readonly arc: string;
  readonly capabilities: readonly string[];
}

interface HoldsData {
  readonly arcs: SchemaRecord<"arc">[];
  readonly open: SurveyIncrement[];
  readonly questions: SchemaRecord<"question">[];
  readonly blockers: Map<string, Blocker>;
}

const DISPOSITIONS: readonly string[] = ["landed", "failed", "withdrawn"];
const ANSWERED = /\b(?:voice\.note_[0-9a-f]{12}|question_[0-9a-f]{12})\b/g;
const ASKS = /\bquestion_[0-9a-f]{12}\b/g;

export function listedSaid(other: OpenListing): string {
  return `${other.increment} ("${other.title}", on arc ${other.arc}) already lists ${other.capabilities.join(", ")}`;
}

export function listedNotice(other: OpenListing): string {
  return `Another open increment shares its capabilities: ${listedSaid(other)}`;
}

export class WorkInFlight {
  readonly #records: SchemaRecords;
  readonly #work: WorkModel;

  constructor(records: SchemaRecords, work: WorkModel = new WorkModel(records)) {
    this.#records = records;
    this.#work = work;
  }

  async addIncrement(increment: NewIncrement, options: WriteOptions = {}): Promise<SchemaRecord<"increment">> {
    const { outcome, waitsFor, ...rest } = increment;
    const fields: Record<string, unknown> = { ...rest };
    if (outcome !== undefined) {
      checkClose(outcome);
      if ((waitsFor ?? []).length > 0) throw new RangeError("a closed increment waits for nothing: work born closed takes no wait");
      fields["status"] = "closed";
      fields["outcome"] = outcomeOf(outcome, undefined);
      if (outcome.disposition === "landed" && fields["escape"] === undefined) fields["escape"] = "none";
    } else {
      fields["status"] = "proposal";
      fields["parked"] = new Date().toISOString();
    }
    if (waitsFor !== undefined && waitsFor.length > 0) {
      const releasers = waitsFor.map(({ releaser }) => releaser);
      if (new Set(releasers).size !== releasers.length) throw new RangeError("an increment waits once per releaser: one owner wait and one event wait at most");
      fields["waitsFor"] = waitsFor.map((wait) => shapeWait(wait, undefined));
    }
    this.#records.check("increment", fields);
    await referTo(this.#records, "arc", increment.arc, "arc");
    await this.#checkReferences(increment, undefined);
    for (const wait of increment.waits ?? []) await this.#blocker("increment", wait.on);
    if (outcome === undefined && (increment.capabilities ?? []).length > 0) await this.#refuseListed(increment.capabilities!, increment.waits ?? []);
    const created = await this.#records.create("increment", fields as FieldsOf<"increment">, options);
    if (outcome !== undefined) await this.#afterClose(created, undefined, options, true, true);
    return created;
  }

  async openListing(capabilities: readonly string[], except?: string): Promise<OpenListing[]> {
    if (capabilities.length === 0) return [];
    const open = await this.#openWork(["arc", "title", "status", "capabilities"]);
    return open.flatMap((other) => {
      const shared = (other.fields.capabilities ?? []).filter((capability) => capabilities.includes(capability));
      if (other.id === except || shared.length === 0) return [];
      return [{ increment: other.id, title: other.fields.title, arc: other.fields.arc, capabilities: shared }];
    });
  }

  async advanceIncrement(id: string, to: "active", options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
    return await this.#records.inOneWrite(async () => {
      const increment = await this.#increment(id);
      if (increment === null) return null;
      if (to !== "active" || increment.fields.status !== "proposal") throw new LifecycleError(id, increment.fields.status, to as IncrementStatus);
      return (await this.#records.edit(id, { status: "active" }, options)) as SchemaRecord<"increment">;
    }, options.signal);
  }

  async returnIncrement(id: string, options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
    return await this.#records.inOneWrite(async () => {
      const increment = await this.#increment(id);
      if (increment === null) return null;
      if (increment.fields.status !== "active") throw new LifecycleError(id, increment.fields.status, "proposal");
      return (await this.#records.edit(id, { status: "proposal" }, options)) as SchemaRecord<"increment">;
    }, options.signal);
  }

  async closeIncrement(id: string, close: CloseInput, options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
    let increment = await this.#increment(id);
    if (increment === null) return null;
    if (increment.fields.status === "closed") throw new LifecycleError(id, "closed", "closed");
    checkClose(close);
    const landed = close.disposition === "landed";
    const pending = increment.fields.pending ?? [];
    if (landed && pending.length > 0) {
      await this.applyPending(id, close.pr, options);
      increment = (await this.#increment(id))!;
    }
    const escape = landed && increment.fields.escape === undefined ? "none" : increment.fields.escape;
    const reason = !landed && pending.length > 0 ? droppedSaid(pending.length) : undefined;
    const closed = (await this.#records.edit(id, { status: "closed", outcome: outcomeOf(close, undefined), pending: undefined, escape }, { ...options, ...(reason === undefined ? {} : { reason }) })) as SchemaRecord<"increment">;
    await this.#afterClose(closed, undefined, options);
    return closed;
  }

  async correctIncrementClosure(id: string, close: CloseInput, reason: string, options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
    const increment = await this.#increment(id);
    if (increment === null) return null;
    if (increment.fields.status !== "closed") throw new Error(`${id} is ${increment.fields.status}: an increment must be closed before its closure is corrected`);
    if (typeof reason !== "string" || reason.trim() === "") throw new Error("a corrected closure needs a reason, kept in its history");
    checkClose(close);
    const was = increment.fields.outcome!;
    const landed = close.disposition === "landed";
    const named = increment.fields.escape;
    const escape = landed ? named ?? "none" : named === "none" ? undefined : named;
    const corrected = (await this.#records.edit(id, { outcome: outcomeOf(close, was.date), escape }, { ...options, reason })) as SchemaRecord<"increment">;
    if (was.disposition !== "landed" && landed) await this.#afterClose(corrected, undefined, options, false);
    if (was.disposition === "landed" && !landed) await this.#afterClose(corrected, stampOf(was, id), options, false);
    return corrected;
  }

  async moveIncrement(id: string, arc: string, reason: string, options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
    const increment = await this.#increment(id);
    if (increment === null) return null;
    await referTo(this.#records, "arc", arc, "arc");
    if (isOpen(increment) && (await this.arcView(arc))?.state === "closed") {
      throw new RangeError(`${arc} is closed, so open work does not move onto it: park it first (arc park ${arc}), move the work, then unpark it (arc unpark ${arc})`);
    }
    const moved = (await this.#records.edit(id, { arc }, { ...options, reason })) as SchemaRecord<"increment">;
    await this.#release([], [increment.fields.arc], options);
    return moved;
  }

  async editIncrement(id: string, fields: IncrementEdit, options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
    return await this.#records.inOneWrite(async () => {
      const increment = await this.#increment(id);
      if (increment === null) return null;
      this.#records.check("increment", present({ ...increment.fields, ...fields }));
      await this.#checkReferences(fields, increment.fields);
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"increment">;
    }, options.signal);
  }

  async pendChange(id: string, change: PlanChange, options: WriteOptions = {}): Promise<Pended | null> {
    return await pendChange(this.#records, this.#work, id, change, options);
  }

  async withPending(id: string, tree: ProjectTree): Promise<ProjectTree | null> {
    return await withPending(this.#records, id, tree);
  }

  async stalePending(id: string): Promise<StalePending[] | null> {
    return await stalePending(this.#records, id);
  }

  async applyPending(id: string, pr?: string, options: WriteOptions = {}): Promise<AppliedPending | null> {
    return await applyPending(this.#records, this.#work, id, pr, options);
  }

  async dropPending(id: string, record: string, reason: string, options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
    return await dropPending(this.#records, id, record, reason, options);
  }

  async settleClosedPending(options: WriteOptions = {}): Promise<SettledPending[]> {
    return await settleClosedPending(this.#records, this.#work, options);
  }

  async addWait(waiter: string, blocker: string, reason: string, options: WriteOptions = {}): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return await this.#records.inOneWrite(async () => {
      const record = await this.#records.get(waiter);
      if (record === null || (record.type !== "arc" && record.type !== "increment")) return null;
      const target = await this.#blocker(record.type, blocker);
      if (target.type !== "capability") {
        const loop = await this.#loop(record as SchemaRecord<"arc" | "increment">, blocker);
        if (loop !== undefined) throw new WaitLoopError(loop);
      }
      const waits = record.fields.waits ?? [];
      const at = waits.findIndex(({ on }) => on === blocker);
      const next = at < 0 ? [...waits, { on: blocker, reason }] : waits.map((wait, index) => (index === at ? { on: blocker, reason } : wait));
      return (await this.#records.edit(waiter, { waits: next }, options)) as SchemaRecord<"arc" | "increment">;
    }, options.signal);
  }

  async removeWait(waiter: string, blocker: string, options: ClearOptions = {}): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return await this.#records.inOneWrite(async () => {
      const record = await this.#records.get(waiter);
      if (record === null || (record.type !== "arc" && record.type !== "increment")) return null;
      const left = (record.fields.waits ?? []).filter(({ on }) => on !== blocker);
      return (await this.#records.edit(waiter, { waits: left.length === 0 ? undefined : left }, options)) as SchemaRecord<"arc" | "increment">;
    }, options.signal);
  }

  async releaseOnVerdict(contract: string, capability: string | undefined, verdict: string, options: WriteOptions = {}, asOf?: number): Promise<string[]> {
    const open = await this.#openWork(["arc", "status", "links", "capabilities", "waitsFor"]);
    const about = open.filter((increment) =>
      (increment.fields.waitsFor ?? []).some(({ releaser }) => releaser === "event")
      && ((increment.fields.links ?? []).includes(contract) || (capability !== undefined && (increment.fields.capabilities ?? []).includes(capability))));
    const released: string[] = [];
    for (const { id } of about) {
      if (asOf !== undefined && !(await this.#stood(id, asOf))) continue;
      const increment = (await this.#increment(id))!;
      const waits = increment.fields.waitsFor ?? [];
      const events = waits.filter(({ releaser }) => releaser === "event");
      const left = waits.filter(({ releaser }) => releaser !== "event");
      const said = `${verdict} Its wait for ${events.map(({ note }) => JSON.stringify(note)).join(" and ")} is released.\n\n`;
      await this.#records.edit(id, { waitsFor: left.length === 0 ? undefined : left, body: `${said}${increment.fields.body}` }, { ...options, reason: `released by a failing verdict on ${contract}` });
      released.push(id);
    }
    return released;
  }

  async addWaitFor(id: string, wait: WaitWrite, options: WriteOptions = {}): Promise<SchemaRecord<"increment"> | null> {
    return await this.#records.inOneWrite(async () => {
      const increment = await this.#increment(id);
      if (increment === null) return null;
      if (increment.fields.status === "closed") throw new RangeError(`${id} is closed: a closed increment waits for nothing`);
      const waits = increment.fields.waitsFor ?? [];
      const at = waits.findIndex(({ releaser }) => releaser === wait.releaser);
      const next = shapeWait(wait, at < 0 ? undefined : waits[at]);
      const list = at < 0 ? [...waits, next] : waits.map((one, index) => (index === at ? next : one));
      return (await this.#records.edit(id, { waitsFor: list }, options)) as SchemaRecord<"increment">;
    }, options.signal);
  }

  async removeWaitFor(id: string, releaser: WaitFor["releaser"], options: ClearOptions = {}, cleared: { readonly merged?: number } = {}): Promise<SchemaRecord<"increment"> | null> {
    return await this.#records.inOneWrite(async () => {
      const increment = await this.#increment(id);
      if (increment === null) return null;
      let left = (increment.fields.waitsFor ?? []).filter((wait) => wait.releaser !== releaser);
      if (releaser === "event" && cleared.merged !== undefined) left = left.map((wait) => (wait.releaser === "owner" ? { ...wait, merged: cleared.merged! } : wait));
      return (await this.#records.edit(id, { waitsFor: left.length === 0 ? undefined : left }, options)) as SchemaRecord<"increment">;
    }, options.signal);
  }

  async waitsFor(id: string, at: Date = new Date()): Promise<NoteWait[]> {
    const increment = await this.#increment(id);
    return increment === null ? [] : noteWaits(increment.fields, at);
  }

  async waitHolds(id: string, { claimed }: ClaimReading = {}): Promise<Hold[]> {
    const record = await this.#records.get(id);
    let waits: Wait[];
    if (record?.type === "arc") waits = record.fields.waits ?? [];
    else if (record?.type === "increment" && isOpen(record)) {
      const arc = await liveOf(this.#records, "arc", record.fields.arc);
      waits = [...(record.fields.waits ?? []), ...(arc?.fields.waits ?? [])];
    } else return [];
    const blockers = await this.#blockers(waits.map(({ on }) => on), new Date());
    return waits.flatMap((wait) => holdOf(wait, blockers.get(wait.on), { ...(claimed === undefined ? {} : { claimed }) }) ?? []);
  }

  async holds(at: Date = new Date(), reading: ClaimReading = {}): Promise<Holds> {
    return holdsOf(await this.#holdsData(at), at, reading);
  }

  async raiseQuestion(question: NewQuestion, options: WriteOptions = {}): Promise<SchemaRecord<"question">> {
    return await raiseQuestion(this.#records, question, options, (arc) => {
      if (parkedNow(arc.fields, new Date())) throw new RangeError(`${arc.id} is parked, so it takes no question: unpark it (arc unpark ${arc.id}) or raise it on an active arc`);
    });
  }

  async checkQuestion(id: string, at: Date = new Date()): Promise<QuestionLease | null> {
    return await checkQuestion(this.#records, id, at);
  }

  async renewQuestion(id: string, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
    return await renewQuestion(this.#records, id, options);
  }

  async editQuestion(id: string, fields: QuestionEdit, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
    return await editQuestion(this.#records, id, fields, options);
  }

  async linkNamedEvidence(id: string, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
    return await linkNamedEvidence(this.#records, id, options);
  }

  async moveQuestion(id: string, arc: string, reason: string, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
    const question = await liveOf(this.#records, "question", id);
    const moved = await moveQuestion(this.#records, id, arc, reason, options, async (to) => (await this.arcView(to))?.state);
    if (moved !== null && question !== null) await this.#release([], [question.fields.arc], options);
    return moved;
  }

  async predictQuestion(id: string, answer: WouldBeAnswer, options: WriteOptions = {}): Promise<SchemaRecord<"prediction"> | null> {
    return await predictQuestion(this.#records, id, answer, options);
  }

  async questionPrediction(id: string): Promise<SchemaRecord<"prediction"> | null> {
    return await questionPrediction(this.#records, id);
  }

  async scoreQuestion(id: string, score: Score, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
    return await scoreQuestion(this.#records, id, score, options);
  }

  async prepQuestion(id: string, prep: Prep, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
    return await prepQuestion(this.#records, id, prep, options);
  }

  async questionDeviation(since: Date): Promise<QuestionDeviation> {
    return await questionDeviation(this.#records, since);
  }

  async lapsedQuestions(at: Date = new Date()): Promise<SchemaRecord<"question">[]> {
    return await lapsedQuestions(this.#records, at);
  }

  async settleQuestion(id: string, settlement: Settlement, options: WriteOptions = {}): Promise<SettledQuestion | null> {
    const settled = await settleQuestion(this.#records, id, settlement, options);
    if (settled !== null) await this.#release([], [settled.fields.arc], options);
    return settled;
  }

  async questions(arcId: string): Promise<SchemaRecord<"question">[]> {
    return byCreation(await this.#records.list("question", { where: { arc: arcId } }));
  }

  async heldOnQuestion(incrementId: string): Promise<string[]> {
    const increment = await this.#increment(incrementId);
    if (increment === null || !isOpen(increment)) return [];
    const heldOn = increment.fields.heldOn ?? [];
    const open = new Set((await openQuestions(this.#records, heldOn)).map(({ id }) => id));
    return heldOn.filter((question) => open.has(question));
  }

  async retireQuestion(id: string, reason: string, options: WriteOptions = {}): Promise<string[] | null> {
    const question = await liveOf(this.#records, "question", id);
    const released = await retireQuestion(this.#records, id, reason, options);
    if (released !== null && question !== null) await this.#release([], [question.fields.arc], options);
    return released;
  }

  async retire(id: string, reason: string, options: WriteOptions = {}): Promise<void> {
    await this.#records.inOneWrite(async () => {
      if ((await liveOf(this.#records, "capability", id)) !== null) {
        const dependents = await this.#work.dependents(id);
        if (dependents.length > 0) throw new RetireRefusedError(id, dependents, "dependsOn");
      }
      await retireUnheld(this.#records, id, reason, options);
    }, options.signal);
  }

  async createArc(arc: NewArc, options: WriteOptions & { readonly id?: string; readonly onlyIfNew?: boolean } = {}): Promise<SchemaRecord<"arc">> {
    this.#records.check("arc", arc as Record<string, unknown>);
    await this.#refuseStories(arc.stories);
    return await this.#records.create("arc", arc, options);
  }

  async editArc(id: string, fields: ArcEdit, options: WriteOptions = {}): Promise<SchemaRecord<"arc"> | null> {
    return await this.#records.inOneWrite(async () => {
      if ((await liveOf(this.#records, "arc", id)) === null) return null;
      if ("stories" in fields) await this.#refuseStories(fields.stories);
      return (await this.#records.edit(id, fields, options)) as SchemaRecord<"arc">;
    }, options.signal);
  }

  async arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]> {
    return byCreation((await this.#records.list("arc")).filter((arc) => (arc.fields.stories ?? []).includes(storyId)));
  }

  async parkArc(id: string, { until, ...options }: ParkOptions = {}): Promise<SchemaRecord<"arc"> | null> {
    return await this.#records.inOneWrite(async () => {
      if ((await liveOf(this.#records, "arc", id)) === null) return null;
      return (await this.#records.edit(id, { parked: true, parkedUntil: until }, options)) as SchemaRecord<"arc">;
    }, options.signal);
  }

  async unparkArc(id: string, options: WriteOptions = {}): Promise<SchemaRecord<"arc"> | null> {
    return await this.#records.inOneWrite(async () => {
      if ((await liveOf(this.#records, "arc", id)) === null) return null;
      return (await this.#records.edit(id, { parked: undefined, parkedUntil: undefined }, options)) as SchemaRecord<"arc">;
    }, options.signal);
  }

  async arcView(id: string, at: Date = new Date()): Promise<ArcView | null> {
    const arc = await liveOf(this.#records, "arc", id);
    if (arc === null) return null;
    const increments = byCreation(await this.#records.list("increment", { where: { arc: id } }));
    const questions = byCreation(await this.#records.list("question", { where: { arc: id } }));
    const open = increments.filter(isOpen);
    const held = await openQuestions(this.#records, [...new Set(open.flatMap(({ fields }) => fields.heldOn ?? []))]);
    const reading = arcReading(arc, open, questions.some(asking), increments.length > 0, new Set(held.map(({ id: question }) => question)), at);
    return { arc, ...reading, increments, questions };
  }

  async arcViews(at: Date = new Date()): Promise<ArcView[]> {
    const arcs = byCreation(await this.#records.list("arc"));
    const increments = byCreation(await this.#records.list("increment"));
    const questions = byCreation(await this.#records.list("question"));
    const open = new Set(questions.filter(asking).map(({ id }) => id));
    return arcs.map((arc) => {
      const own = increments.filter((increment) => increment.fields.arc === arc.id);
      const asked = questions.filter((question) => question.fields.arc === arc.id);
      return { arc, ...arcReading(arc, own.filter(isOpen), asked.some(asking), own.length > 0, open, at), increments: own, questions: asked };
    });
  }

  async workSurvey(at: Date = new Date(), { also = [], closedTitles = false }: SurveyOptions = {}): Promise<WorkSurvey> {
    const data = await this.#holdsData(at);
    const seen = new Set(data.open.map(({ id }) => id));
    const followed = also.length === 0 ? [] : (await this.#records.select("increment", SURVEY_INCREMENT_FIELDS, { ids: also })).filter(({ id }) => !seen.has(id));
    const open = new Set(data.questions.map(({ id }) => id));
    const arcs: SurveyArc[] = [];
    for (const arc of byCreation(data.arcs)) {
      const own = data.open.filter((increment) => increment.fields.arc === arc.id);
      const asked = data.questions.filter((question) => question.fields.arc === arc.id).length;
      const populated = own.length > 0 || (await this.#populated(arc.id));
      const reading = arcReading(arc, own, asked > 0, populated, open, at);
      const titled = reading.state !== "closed" || closedTitles;
      arcs.push({
        id: arc.id,
        createdAt: arc.createdAt,
        ...reading,
        ...(titled ? { title: arc.fields.title } : {}),
        ...(arc.fields.priority === undefined ? {} : { priority: arc.fields.priority }),
        openQuestions: asked,
      });
    }
    return { arcs, increments: [...data.open, ...(followed as SurveyIncrement[])], holds: (reading: ClaimReading = {}) => holdsOf(data, at, reading) };
  }

  async boardArcs(closed: DayWindow, at: Date = new Date()): Promise<BoardArcView[]> {
    return (await this.#board(at)).filter((view) => view.state !== "closed" || within(view.closed, closed));
  }

  async closedArcs(window: DayWindow, at: Date = new Date()): Promise<BoardArcView[]> {
    return (await this.#board(at)).filter((view) => view.state === "closed" && within(view.closed, window));
  }

  async parkedCapabilities(at: Date = new Date()): Promise<Map<string, ParkedOn[]>> {
    const arcs = new Map((await this.#records.list("arc")).map((arc) => [arc.id, arc]));
    const open = await this.#openWork(SURVEY_INCREMENT_FIELDS);
    const questions = await openQuestions(this.#records);
    const asked = new Set(questions.map(({ id }) => id));
    const states = new Map<string, ArcState>();
    const stateOf = (id: string): ArcState | undefined => {
      const arc = arcs.get(id);
      if (arc === undefined) return undefined;
      if (!states.has(id)) {
        const own = open.filter((increment) => increment.fields.arc === id);
        states.set(id, arcReading(arc, own, questions.some((question) => question.fields.arc === id), true, asked, at).state);
      }
      return states.get(id);
    };
    const named = new Map<string, SurveyIncrement[]>();
    for (const increment of open) for (const capability of increment.fields.capabilities ?? []) named.set(capability, [...(named.get(capability) ?? []), increment]);
    const parked = new Map<string, ParkedOn[]>();
    for (const [capability, increments] of named) {
      const asleep = increments.every((increment) =>
        stateOf(increment.fields.arc) === "parked"
        && !(increment.fields.waitsFor ?? []).some(({ releaser }) => releaser === "owner")
        && !(increment.fields.heldOn ?? []).some((question) => asked.has(question)));
      if (!asleep) continue;
      const on = [...new Set(increments.map((increment) => increment.fields.arc))];
      parked.set(capability, on.map((arc) => ({ arc, title: arcs.get(arc)!.fields.title })));
    }
    return parked;
  }

  async #board(at: Date): Promise<BoardArcView[]> {
    const arcs = byCreation(await this.#records.list("arc"));
    const increments = byCreation(await this.#records.select("increment", BOARD_INCREMENT_FIELDS)) as BoardIncrement[];
    const questions = byCreation(await this.#records.list("question"));
    const open = new Set(questions.filter(asking).map(({ id }) => id));
    return arcs.map((arc) => {
      const own = increments.filter((increment) => increment.fields.arc === arc.id);
      const asked = questions.filter((question) => question.fields.arc === arc.id);
      const reading = arcReading(arc, own.filter(isOpen), asked.some(asking), own.length > 0, open, at);
      const days = own.flatMap(({ fields }) => (fields.outcome === undefined ? [] : [fields.outcome.date])).sort();
      return { arc, ...reading, ...(reading.state === "closed" ? { closed: days.at(-1)! } : {}), increments: own, questions: asked };
    });
  }

  async #holdsData(at: Date): Promise<HoldsData> {
    const arcs = await this.#records.list("arc");
    const open = byCreation(await this.#openWork(SURVEY_INCREMENT_FIELDS));
    const questions = await openQuestions(this.#records);
    const ids = [...arcs.flatMap(({ fields }) => fields.waits ?? []), ...open.flatMap(({ fields }) => fields.waits ?? [])].map(({ on }) => on);
    return { arcs, open, questions, blockers: await this.#blockers(ids, at) };
  }

  async #openWork<K extends keyof IncrementFields & string>(fields: readonly K[]): Promise<(Omit<SchemaRecord<"increment">, "fields"> & { fields: Pick<IncrementFields, K> })[]> {
    const wanted = [...new Set<keyof IncrementFields & string>([...fields, "status"])] as K[];
    const lists = [];
    for (const status of OPEN_STATUSES) lists.push(await this.#records.select("increment", wanted, { where: { status } }));
    return byCreation(lists.flat());
  }

  async #blockers(ids: readonly string[], at: Date): Promise<Map<string, Blocker>> {
    const unique = [...new Set(ids)];
    const blockers = new Map<string, Blocker>();
    if (unique.length === 0) return blockers;
    for (const increment of await this.#records.select("increment", ["status", "outcome"], { ids: unique })) {
      blockers.set(increment.id, { kind: "increment", closed: increment.fields.status === "closed", landed: increment.fields.outcome?.disposition === "landed" });
    }
    for (const arc of await this.#records.list("arc", { ids: unique })) blockers.set(arc.id, { kind: "arc", closed: await this.#closed(arc, at) });
    for (const capability of await this.#records.select("capability", ["title"], { ids: unique })) blockers.set(capability.id, { kind: "capability", title: capability.fields.title });
    return blockers;
  }

  async #closed(arc: SchemaRecord<"arc">, at: Date): Promise<boolean> {
    if (parkedNow(arc.fields, at)) return false;
    for (const status of OPEN_STATUSES) {
      if ((await this.#records.select("increment", ["status"], { where: { arc: arc.id, status }, limit: 1 })).length > 0) return false;
    }
    if ((await this.#records.select("question", ["lifecycle"], { where: { arc: arc.id, lifecycle: "open" }, limit: 1 })).length > 0) return false;
    return await this.#populated(arc.id);
  }

  async #populated(arc: string): Promise<boolean> {
    return (await this.#records.select("increment", ["status"], { where: { arc }, limit: 1 })).length > 0;
  }

  async #release(landed: readonly string[], arcs: readonly string[], options: WriteOptions): Promise<void> {
    const cleared = new Map<string, string>(landed.map((id) => [id, `${id} landed`]));
    for (const id of new Set(arcs)) {
      const arc = await liveOf(this.#records, "arc", id);
      if (arc !== null && (await this.#closed(arc, new Date()))) cleared.set(id, `arc ${id} closed`);
    }
    if (cleared.size === 0) return;
    const waiters: { id: string; fields: { waits?: Wait[] | undefined } }[] = [...(await this.#records.list("arc")), ...(await this.#openWork(["waits"]))];
    for (const waiter of waiters) {
      const waits = waiter.fields.waits ?? [];
      const gone = waits.filter(({ on }) => cleared.has(on));
      if (gone.length === 0) continue;
      const left = waits.filter(({ on }) => !cleared.has(on));
      const reason = `cleared the wait on ${gone.map(({ on }) => `${on}: ${cleared.get(on)}`).join("; ")}`;
      await this.#records.edit(waiter.id, { waits: left.length === 0 ? undefined : left }, { ...writer(options), reason });
    }
  }

  async #afterClose(increment: SchemaRecord<"increment">, unlanded: string | undefined, options: WriteOptions, telling = true, born = false): Promise<void> {
    const outcome = increment.fields.outcome!;
    if (unlanded !== undefined) await this.#reopen(increment, (fields) => fields["dischargedBy"] === unlanded, options);
    else if (outcome.disposition === "landed") {
      const stamp = stampOf(outcome, increment.id);
      for (const id of born ? [] : (increment.fields.remedies ?? [])) {
        const friction = await liveOf(this.#records, "friction", id);
        if (friction !== null && friction.fields.dischargedBy === undefined) await this.#records.edit(id, { state: "resolved", dischargedBy: stamp }, writer(options));
      }
      const { title, body, links = [] } = increment.fields;
      const named = new Set([...(body.match(ANSWERED) ?? []), ...links]);
      const answered = [...named].some((id) => new RegExp(`^${ANSWERED.source}$`).test(id));
      const asksAnew = (outcome.note?.match(ASKS) ?? []).some((question) => !named.has(question));
      if (telling && outcome.pr === undefined && outcome.note !== undefined && answered && !asksAnew) {
        await recordFyi(this.#records, { title: `What your answer found: ${title}`, what: outcome.note, about: increment.id }, options);
      }
    } else await this.#reopen(increment, (fields) => fields["state"] === "routed", options);
    await this.#release(outcome.disposition === "landed" ? [increment.id] : [], [increment.fields.arc], options);
  }

  async #reopen(increment: SchemaRecord<"increment">, owed: (fields: Record<string, unknown>) => boolean, options: WriteOptions): Promise<void> {
    const remedies = increment.fields.remedies ?? [];
    if (remedies.length === 0) return;
    const others = new Set((await this.#openWork(["remedies"])).filter(({ id }) => id !== increment.id).flatMap(({ fields }) => fields.remedies ?? []));
    for (const id of remedies) {
      const friction = await liveOf(this.#records, "friction", id);
      if (friction === null || !owed(friction.fields) || others.has(id)) continue;
      await this.#records.edit(id, { state: "open", route: undefined, routeReason: undefined, dischargedBy: undefined }, writer(options));
    }
  }

  async #stood(id: string, asOf: number): Promise<boolean> {
    const entries = await this.#records.history({ id });
    const before = entries.filter(({ seq }) => seq <= asOf).at(-1);
    if (before === undefined) return false;
    let events = eventsOf(before.record.fields);
    for (const entry of entries.filter(({ seq }) => seq > asOf)) {
      const now = eventsOf(entry.record.fields);
      if (!isDeepStrictEqual(now, events)) return false;
      events = now;
    }
    return true;
  }

  async #loop(waiter: SchemaRecord<"arc" | "increment">, blocker: string): Promise<string[] | undefined> {
    const arcs = new Map((await this.#records.list("arc")).map((arc) => [arc.id, arc.fields.waits ?? []]));
    const open = await this.#openWork(["arc", "waits"]);
    const increments = new Map(open.map((increment) => [increment.id, increment.fields]));
    const workOf = (arc: string): string[] => open.filter((increment) => increment.fields.arc === arc).map(({ id }) => id);
    const next = (node: string): string[] => {
      const arc = arcs.get(node);
      if (arc !== undefined) return [...arc.map(({ on }) => on), ...workOf(node)];
      const increment = increments.get(node);
      if (increment === undefined) return [];
      return [...(increment.waits ?? []).map(({ on }) => on), ...(arcs.get(increment.arc) ?? []).map(({ on }) => on)];
    };
    const targets = new Set([waiter.id, ...(waiter.type === "arc" ? workOf(waiter.id) : [])]);
    if (targets.has(blocker)) return [blocker, blocker];
    const seen = new Set([blocker]);
    const walk = (node: string, trail: readonly string[]): string[] | undefined => {
      for (const step of next(node)) {
        if (targets.has(step)) return [step, ...trail, step];
        if (seen.has(step)) continue;
        seen.add(step);
        const found = walk(step, [...trail, step]);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return walk(blocker, [blocker]);
  }

  async #blocker(waiter: "arc" | "increment", blocker: string): Promise<SchemaRecord> {
    const allowed = waiter === "increment" ? ["increment", "capability"] : ["arc", "increment"];
    const record = await this.#records.get(blocker);
    if (record === null || !allowed.includes(record.type)) throw new MissingReferenceError("on", blocker, allowed.join(" or "), record?.type);
    return record;
  }

  async #checkReferences(fields: IncrementEdit, current: Partial<IncrementFields> | undefined): Promise<void> {
    for (const id of fields.capabilities ?? []) await referTo(this.#records, "capabilities", id, "capability");
    for (const id of fields.links ?? []) {
      if ((await this.#records.get(id)) === null) throw new MissingReferenceError("links", id, "record");
    }
    for (const id of fields.remedies ?? []) await referTo(this.#records, "remedies", id, "friction");
    for (const id of fields.heldOn ?? []) await referTo(this.#records, "heldOn", id, "question");
    const escape = fields.escape;
    if (escape !== undefined && escape !== "none") {
      if (escape.causedBy.startsWith("#") && escape.commit === undefined) {
        throw new SchemaError("increment", [{ field: "escape", problem: `"escape": a pull request is named with its merge commit too, so its number names one change` }]);
      }
      if (!escape.causedBy.startsWith("#")) await referTo(this.#records, "escape.causedBy", escape.causedBy, "increment");
      const kept = current?.escape !== undefined && current.escape !== "none" && current.escape.story === escape.story;
      if (!kept) await referTo(this.#records, "escape.story", escape.story, "story");
    }
    for (const id of fields.risk?.stories ?? []) await referTo(this.#records, "risk.stories", id, "story");
  }

  async #refuseListed(capabilities: readonly string[], waits: readonly Wait[]): Promise<void> {
    const on = new Set(waits.map((wait) => wait.on));
    const refused = (await this.openListing(capabilities)).filter((other) => !on.has(other.increment) && !other.capabilities.every((capability) => on.has(capability)));
    if (refused.length === 0) return;
    const claims = [...new Set(refused.flatMap((other) => other.capabilities))].map((capability) => `${capability}'s claim`);
    throw new RangeError(`parking it is refused: ${refused.map(listedSaid).join("; ")}. Park it waiting on that increment, or wait on ${claims.join(" and ")}`);
  }

  async #refuseStories(stories: readonly string[] | undefined): Promise<void> {
    for (const id of stories ?? []) {
      const record = await this.#records.get(id);
      if (record?.type !== "story") throw new MissingReferenceError("stories", id, "story", record?.type);
    }
  }

  async #increment(id: string): Promise<SchemaRecord<"increment"> | null> {
    return await liveOf(this.#records, "increment", id);
  }
}

function holdsOf(data: HoldsData, at: Date, { claimed }: ClaimReading): Holds {
  const reading = claimed === undefined ? {} : { claimed };
  const arcs = new Map(data.arcs.map((arc) => [arc.id, arc]));
  const asked = new Set(data.questions.map(({ id }) => id));
  const resolve = (waits: readonly Wait[]): Hold[] => waits.flatMap((wait) => holdOf(wait, data.blockers.get(wait.on), reading) ?? []);
  const waits: Record<string, Hold[]> = {};
  const heldOn: Record<string, string[]> = {};
  const waitsFor: Record<string, NoteWait[]> = {};
  for (const arc of data.arcs) waits[arc.id] = resolve(arc.fields.waits ?? []);
  for (const increment of data.open) {
    waits[increment.id] = resolve([...(increment.fields.waits ?? []), ...(arcs.get(increment.fields.arc)?.fields.waits ?? [])]);
    heldOn[increment.id] = (increment.fields.heldOn ?? []).filter((question) => asked.has(question));
    const notes = noteWaits(increment.fields, at);
    if (notes.length > 0) waitsFor[increment.id] = notes;
  }
  return { waits, heldOn, waitsFor };
}

function shapeWait(wait: WaitWrite, existing: WaitFor | undefined): WaitFor {
  if (wait.releaser === "event") {
    if (wait.why !== undefined || wait.rank !== undefined) throw new RangeError("only an owner wait takes a why or a rank");
    if (wait.checkBack === undefined) throw new RangeError("an event wait needs a check-back day, when to look again");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wait.checkBack) || Number.isNaN(Date.parse(wait.checkBack))) throw new RangeError(`${JSON.stringify(wait.checkBack)} is not a check-back day`);
    const today = dayOf(new Date());
    if (wait.checkBack < today) throw new RangeError(`its check-back day ${wait.checkBack} is before today, ${today}`);
    const note = wait.note ?? existing?.note;
    if (note === undefined || note.trim() === "") throw new RangeError("an event wait needs a note saying what it waits for");
    return { releaser: "event", note, checkBack: wait.checkBack };
  }
  if (wait.checkBack !== undefined) throw new RangeError("an owner wait takes no check-back day: it holds until the owner's act clears it");
  if (wait.rank !== undefined && !(Number.isInteger(wait.rank) && wait.rank >= 1)) throw new RangeError(`a rank is a whole number, 1 first, not ${wait.rank}`);
  const why = wait.why ?? existing?.why;
  if (why === undefined || why.trim() === "") throw new RangeError("an owner wait needs a why: what it protects or unblocks");
  const note = wait.note ?? existing?.note;
  if (note === undefined || note.trim() === "") throw new RangeError("an owner wait needs a note saying what to do");
  const rank = wait.rank ?? existing?.rank;
  return { releaser: "owner", note, why, ...(rank === undefined ? {} : { rank }), reviewed: new Date().toISOString() };
}

function checkClose(close: CloseInput): void {
  if (!DISPOSITIONS.includes(close.disposition)) {
    throw new SchemaError("increment", [{ field: "outcome", problem: `"outcome": a close names its disposition: landed, failed or withdrawn` }]);
  }
  const said = (text: string | undefined) => text !== undefined && text.trim() !== "";
  if (!said(close.pr) && !said(close.note)) {
    throw new SchemaError("increment", [{ field: "outcome", problem: `"outcome": a close with no pull request needs a "note" saying what happened` }]);
  }
}

function outcomeOf(close: CloseInput, date: string | undefined): NonNullable<IncrementFields["outcome"]> {
  return {
    date: close.date ?? date ?? dayOf(new Date()),
    ...(close.pr === undefined ? {} : { pr: close.pr }),
    ...(close.note === undefined ? {} : { note: close.note }),
    disposition: close.disposition,
  };
}

function stampOf(outcome: NonNullable<IncrementFields["outcome"]>, id: string): string {
  return outcome.pr === undefined ? id : prSaid(outcome.pr);
}

function eventsOf(fields: Record<string, unknown>): unknown[] {
  return ((fields["waitsFor"] ?? []) as WaitFor[]).filter(({ releaser }) => releaser === "event");
}

function asking(question: SchemaRecord<"question">): boolean {
  return question.fields.lifecycle === "open";
}

function within(day: string | undefined, window: DayWindow): boolean {
  return day !== undefined && window.from <= day && day < window.to;
}

function present(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function writer(options: WriteOptions): WriteOptions {
  return options.actor === undefined ? {} : { actor: options.actor };
}
