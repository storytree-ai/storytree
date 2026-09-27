/**
 * Capability 7 · Library API (the library story): one small, fixed list of functions is the only
 * way anything outside the library reads or writes it. The agent link, the arc surface, the forest
 * and the desktop app all call these, and changesSince lets them see what just changed without
 * re-reading everything.
 *
 * connect() reaches a Postgres server, and openProject() hands back a Library: the public face of
 * one project. It composes the internals (the project's transactions, typed records, work model,
 * knowledge and health) without exposing any of them, and everything it returns is data.
 */
import type { AnnotatedTree, HealthEntry, HealthOptions, HealthState, NodeHealth } from "../health/index.js";
import type { DecisionNumberPlan, DecisionView, NewDecision, NewDefinition, NewKnowledge, Note, NoteEdit, Related, RelatedOptions } from "../knowledge/index.js";
import { connect as connectServer, type ConnectOptions, type Project, type ProjectSnapshot, type Storytree as Server } from "../project/index.js";
import { couldBeId } from "../references.js";
import type { RecordType, SchemaRecord, WriteOptions } from "../schema/index.js";
import type { KnowledgeKind } from "../schema/types.js";
import type { HistoryEntry, HistoryFilter, RecordEnvelope } from "../transactions/index.js";
import type {
  ArcEdit,
  ArcView,
  CapabilityEdit,
  CloseInput,
  ContractEdit,
  Hold,
  NewQuestion,
  QuestionLease,
  Settlement,
  IncrementEdit,
  NewArc,
  NewCapability,
  NewContract,
  NewIncrement,
  NewStory,
  StoryEdit,
} from "../work/index.js";

/** A connection to one Postgres server and the storytree projects on it. */
export interface Storytree {
  /**
   * Open the library of the project called `name`, creating its database the first time. A name
   * that breaks the project-name rule is refused (ProjectNameError) before anything touches the
   * server. A server user that may not create databases borrows a role granted to it that may;
   * with none to borrow, it is refused (ConnectionError) with the two lines that grant one.
   */
  openProject(name: string): Promise<Library>;
  /** The names of the storytree projects on the server, sorted. No other database is listed. */
  listProjects(): Promise<string[]>;
  /**
   * A snapshot of the project called `name`: every record and its whole history, as they stood at
   * one moment, read while writes go on. It is plain data, to be kept as a file (ADR-0641 B1).
   */
  snapshot(name: string): Promise<ProjectSnapshot>;
  /**
   * Restore `snapshot` into the project called `name`, creating it if it is missing. A project that
   * holds any record or any history is refused (RestoreRefusedError) and nothing is written, so a
   * restore can never overwrite live edits.
   */
  restore(name: string, snapshot: ProjectSnapshot): Promise<void>;
  /** Close this connection and every library opened through it. */
  close(): Promise<void>;
}

/**
 * One project's library, as everything outside the library reaches it. Every write accepts
 * optional { actor } metadata, kept on its history entry rather than in the record's fields.
 */
export interface Library {
  /** The project's name. */
  readonly name: string;

  /** The live record whole, upgraded to its current schema, or null if missing or retired. */
  get(id: string): Promise<SchemaRecord | null>;
  /** Every live record of this kind, upgraded, in id order. An unknown kind is refused. */
  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
  /**
   * Every original write, oldest first, including retired records, its optional actor and retirement
   * reason. Filter by record id and/or entries after a sequence number. Records stay as written,
   * on their original schema versions; reading history never upgrades or rewrites them.
   */
  history(filter?: HistoryFilter): Promise<HistoryEntry[]>;

  /** Add a story to the project, under an id the library makes. */
  addStory(story: NewStory, options?: WriteOptions): Promise<SchemaRecord<"story">>;
  /**
   * Change only the named fields of a story, merged onto what is stored now. Null, with nothing
   * written, if `id` is not a live story.
   */
  editStory(id: string, fields: StoryEdit, options?: WriteOptions): Promise<SchemaRecord<"story"> | null>;
  /**
   * Create an arc, with its intent and end state. Every story it lists must be a live story
   * (MissingReferenceError otherwise); it may list none.
   */
  createArc(arc: NewArc, options?: WriteOptions): Promise<SchemaRecord<"arc">>;
  /**
   * Change only the named fields of an arc. Every story a new `stories` lists must be a live story
   * (MissingReferenceError otherwise). Null, with nothing written, if `id` is not a live arc.
   */
  editArc(id: string, fields: ArcEdit, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null>;
  /** Add a capability to a story. The story, and every capability it depends on, must be live. */
  addCapability(capability: NewCapability, options?: WriteOptions): Promise<SchemaRecord<"capability">>;
  /**
   * Change only the named fields of a capability. A dependency that would close a loop is refused
   * (DependencyLoopError). Null, with nothing written, if `id` is not a live capability.
   */
  editCapability(id: string, fields: CapabilityEdit, options?: WriteOptions): Promise<SchemaRecord<"capability"> | null>;
  /** Add a contract to a capability, which must be a live capability. */
  addContract(contract: NewContract, options?: WriteOptions): Promise<SchemaRecord<"contract">>;
  /**
   * Change only the named fields of a contract. A new `capability` must be a live capability
   * (MissingReferenceError otherwise). Null, with nothing written, if `id` is not a live contract.
   */
  editContract(id: string, fields: ContractEdit, options?: WriteOptions): Promise<SchemaRecord<"contract"> | null>;
  /** The plan as it is now, story › capability › contract with every node's health, and the arcs: what the forest reads. */
  projectTree(): Promise<AnnotatedTree>;
  /** The live arcs listing story `storyId`, in creation order. */
  arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]>;

  /**
   * Add an increment to a live arc: a proposal, stamped with when it was parked, or, given an
   * `outcome`, born closed. Everything it touches or remedies must be live.
   */
  addIncrement(increment: NewIncrement, options?: WriteOptions): Promise<SchemaRecord<"increment">>;
  /** Move an increment on, to ready or active, only forward (LifecycleError otherwise). Null if `id` is not a live increment. */
  advanceIncrement(id: string, to: "ready" | "active", options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
  /**
   * Close an increment with its pull request, note and what the close meant; a close with no pull
   * request needs a note. Null if `id` is not a live increment.
   */
  closeIncrement(id: string, close: CloseInput, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
  /** Change an increment's title, objective, body, or what it touches and remedies. Null if `id` is not a live increment. */
  editIncrement(id: string, fields: IncrementEdit, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null>;
  /** Park an arc: it reads parked until unparked. Null if `id` is not a live arc. */
  parkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null>;
  /** Unpark an arc. Null if `id` is not a live arc. */
  unparkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null>;
  /** An arc whole: its state (worked out on every read, or parked) and its increments, oldest first. Null if `id` is not a live arc. */
  arcView(id: string): Promise<ArcView | null>;

  /**
   * Make an arc wait on an arc, or an increment on an increment on any arc, with a reason. A wait
   * that would close a loop across arcs and increments is refused (WaitLoopError). Null if `waiter`
   * is not a live arc or increment.
   */
  addWait(waiter: string, blocker: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null>;
  /** Stop `waiter` waiting on `blocker`. Null if `waiter` is not a live arc or increment. */
  removeWait(waiter: string, blocker: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null>;
  /**
   * The blockers still holding `id`, an arc or an increment, each with its reason and whether it can
   * never release: the one answer to whether a wait holds.
   */
  waitHolds(id: string): Promise<Hold[]>;

  /** Raise a question for the owner on a live arc: it is open. */
  raiseQuestion(question: NewQuestion, options?: WriteOptions): Promise<SchemaRecord<"question">>;
  /**
   * Settle a question with the owner's answer, and the live decision that carried it, if one did.
   * Null if `id` is not a live question.
   */
  settleQuestion(id: string, settlement: Settlement, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
  /** The questions on arc `arcId`, open and settled, oldest first. */
  questions(arcId: string): Promise<SchemaRecord<"question">[]>;
  /** The open questions an open increment is held on: the one answer to whether it waits on the owner. */
  heldOnQuestion(incrementId: string): Promise<string[]>;
  /**
   * A question's review lease at `at` (now, unless given): fresh while it runs, lapsed once it has
   * run out, settled once answered. Null if `id` is not a live question. It writes nothing.
   */
  checkQuestion(id: string, at?: Date): Promise<QuestionLease | null>;
  /**
   * Stamp an open question as checked to still hold, now, starting its lease again. Renewing a
   * settled question is refused (RangeError). Null if `id` is not a live question.
   */
  renewQuestion(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
  /** The open questions whose lease has lapsed at `at` (now, unless given), longest lapsed first. */
  lapsedQuestions(at?: Date): Promise<SchemaRecord<"question">[]>;

  /** Write what the agent reported about a contract. Health is written on contracts only: anything else is refused. */
  reportHealth(contractId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry>;
  /** Write what storytree verified about a contract, by seeing it for itself. */
  recordVerified(contractId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry>;
  /** A story's, capability's or contract's health: the reported and the verified column side by side. */
  health(nodeId: string): Promise<NodeHealth>;
  /** Every health entry of a contract, both columns, in the order written. */
  healthHistory(contractId: string): Promise<HealthEntry[]>;

  /**
   * Record a decision, with its status. Every link must name a live artifact, `frontCoverOf`, if given,
   * the one live story or capability the decision is a front cover of, and each decision it
   * supersedes a live decision. It is numbered one past the highest number any decision has held,
   * unless it is brought in under its own, which no other may have held (NumberTakenError).
   * The storytree project auto-numbers above its stored floor once the ADR-0662 switch is applied.
   */
  recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">>;
  /** One-time storytree repair from its own Full record line; keeps old numbers reserved in history. */
  numberDecision(id: string, number: number, options?: WriteOptions): Promise<SchemaRecord<"decision">>;
  /** Read-only Full record proposals, including reasons any would be refused. */
  decisionNumberPlan(): Promise<DecisionNumberPlan[]>;
  /** One-time N1 bulk move; previews by default, applies only with apply: true, reports each refusal. */
  numberDecisionsFromFullRecord(options?: WriteOptions & { readonly apply?: boolean }): Promise<DecisionNumberPlan[]>;
  /** ADR-0662: preview the project floor, or store it once with apply: true. */
  setDecisionNumberFloor(floor: number, options?: WriteOptions & { readonly apply?: boolean }): Promise<number>;
  /** ADR-0662: preview founding-book numbers above the floor; apply: true writes them once. */
  numberFoundingDecisions(options?: WriteOptions & { readonly apply?: boolean }): Promise<DecisionNumberPlan[]>;
  /**
   * Write a principle, guardrail, pattern, process, agent role, friction, re-steer or tech stack,
   * with its kind's fields. Every link, and an agent role's or process's other references, must name
   * a live artifact.
   */
  writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K>>;
  /** Define a term. Every link must name a live artifact. */
  defineTerm(definition: NewDefinition, options?: WriteOptions): Promise<SchemaRecord<"definition">>;
  /** Change only the named fields of an artifact, keeping its old wording in history. Null if `id` is not a live artifact. */
  editNote(id: string, fields: NoteEdit, options?: WriteOptions): Promise<Note | null>;
  /** The live artifacts holding every word of `query`, ignoring case, in creation order. */
  search(query: string): Promise<Note[]>;
  /** The live artifacts linking to artifact `noteId`, in creation order. */
  relatedNotes(noteId: string): Promise<Note[]>;
  /**
   * The other live artifacts ranked by likeness to artifact `noteId`, each saying whether a link
   * joins them either way; with `unlinked`, only those no link reaches. Null if `noteId` is not a
   * live artifact.
   */
  related(noteId: string, options?: RelatedOptions): Promise<Related | null>;
  /** Every live definition, in creation order. */
  definitions(): Promise<SchemaRecord<"definition">[]>;
  /**
   * A story's or capability's shelf: the live decisions that are its front covers, founding
   * (oldest) first. This is how the work reaches its knowledge.
   */
  frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]>;
  /**
   * A decision as the decision log reads it: its record, full text included; its status, which is
   * superseded exactly when an accepted decision names it in `supersedes`; and its composed
   * statement, marked stale once its text has changed since. Null if `id` is not a live decision.
   */
  decision(id: string): Promise<DecisionView | null>;
  /**
   * Compose a decision's one statement: a maintained paragraph beside its text, never in its place,
   * replacing any before it. Null if `id` is not a live decision.
   */
  composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null>;

  /**
   * Retire a record: it is gone from every read, and its history keeps it and `reason`. Retiring
   * a missing or already retired record is a harmless no-op. A question an increment is held on is
   * refused (RetireRefusedError): take it off the increment's heldOn first, or settle it instead.
   */
  retire(id: string, reason: string, options?: WriteOptions): Promise<void>;
  /**
   * The changes after `cursor`, oldest first, and the cursor to pass next time. Start from 0; pass
   * back each cursor handed out and no change is ever missed or seen twice.
   */
  changesSince(cursor: number): Promise<Changes>;
  /** Close this library's connections. */
  close(): Promise<void>;
}

/** One change to the project's records, as the history keeps it. */
export interface Change {
  /** Where the change sits in the project's history. Passed as a cursor, it reads what came after it. */
  seq: number;
  recordId: string;
  type: string;
  action: HistoryEntry["action"];
  /** The record as the change left it; for `retired`, its last state. */
  record: RecordEnvelope;
}

/** What changesSince returns. */
export interface Changes {
  /** The changes after the cursor given, oldest first. */
  changes: Change[];
  /** The cursor to pass next time: the last change's seq, or the cursor given when there are no changes. */
  cursor: number;
}

/**
 * Connect to a Postgres server: `{ url }` for one at a postgres:// URL, or `{ cloudSql: { instance,
 * user } }` for a Cloud SQL instance, signed in to as your own Google account (capability 8).
 * Nothing touches the server until a call needs it, but a Cloud SQL instance is signed in to and
 * looked up here. Whatever stops storytree reaching or using a server as it is set up is refused
 * with a ConnectionError saying what to fix.
 */
export async function connect(options: ConnectOptions): Promise<Storytree> {
  return new ServerHandle(await connectServer(options));
}

class ServerHandle implements Storytree {
  readonly #server: Server;

  constructor(server: Server) {
    this.#server = server;
  }

  async openProject(name: string): Promise<Library> {
    return new LibraryHandle(await this.#server.openProject(name));
  }

  listProjects(): Promise<string[]> {
    return this.#server.listProjects();
  }

  snapshot(name: string): Promise<ProjectSnapshot> {
    return this.#server.snapshot(name);
  }

  restore(name: string, snapshot: ProjectSnapshot): Promise<void> {
    return this.#server.restore(name, snapshot);
  }

  close(): Promise<void> {
    return this.#server.close();
  }
}

/**
 * A Library over one project's internals. It holds the project in a private field, so nothing
 * reaches them through it, and each method hands a call to the layer that owns it.
 */
class LibraryHandle implements Library {
  readonly name: string;
  readonly #project: Project;

  constructor(project: Project) {
    this.name = project.name;
    this.#project = project;
  }

  get(id: string): Promise<SchemaRecord | null> {
    return this.#project.records.get(id);
  }

  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]> {
    return this.#project.records.list(kind);
  }

  history(filter?: HistoryFilter): Promise<HistoryEntry[]> {
    return this.#project.records.history(filter);
  }

  addStory(story: NewStory, options?: WriteOptions): Promise<SchemaRecord<"story">> {
    return this.#project.work.addStory(story, options);
  }

  editStory(id: string, fields: StoryEdit, options?: WriteOptions): Promise<SchemaRecord<"story"> | null> {
    return this.#project.work.editStory(id, fields, options);
  }

  createArc(arc: NewArc, options?: WriteOptions): Promise<SchemaRecord<"arc">> {
    return this.#project.work.createArc(arc, options);
  }

  editArc(id: string, fields: ArcEdit, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#project.work.editArc(id, fields, options);
  }

  addCapability(capability: NewCapability, options?: WriteOptions): Promise<SchemaRecord<"capability">> {
    return this.#project.work.addCapability(capability, options);
  }

  editCapability(id: string, fields: CapabilityEdit, options?: WriteOptions): Promise<SchemaRecord<"capability"> | null> {
    return this.#project.work.editCapability(id, fields, options);
  }

  addContract(contract: NewContract, options?: WriteOptions): Promise<SchemaRecord<"contract">> {
    return this.#project.work.addContract(contract, options);
  }

  editContract(id: string, fields: ContractEdit, options?: WriteOptions): Promise<SchemaRecord<"contract"> | null> {
    return this.#project.work.editContract(id, fields, options);
  }

  /** The work model's tree, annotated with health (capability 5 reads the plan through capability 4). */
  projectTree(): Promise<AnnotatedTree> {
    return this.#project.health.annotate();
  }

  arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]> {
    return this.#project.work.arcsFor(storyId);
  }

  addIncrement(increment: NewIncrement, options?: WriteOptions): Promise<SchemaRecord<"increment">> {
    return this.#project.flight.addIncrement(increment, options);
  }

  advanceIncrement(id: string, to: "ready" | "active", options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#project.flight.advanceIncrement(id, to, options);
  }

  closeIncrement(id: string, close: CloseInput, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#project.flight.closeIncrement(id, close, options);
  }

  editIncrement(id: string, fields: IncrementEdit, options?: WriteOptions): Promise<SchemaRecord<"increment"> | null> {
    return this.#project.flight.editIncrement(id, fields, options);
  }

  parkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#project.flight.parkArc(id, options);
  }

  unparkArc(id: string, options?: WriteOptions): Promise<SchemaRecord<"arc"> | null> {
    return this.#project.flight.unparkArc(id, options);
  }

  arcView(id: string): Promise<ArcView | null> {
    return this.#project.flight.arcView(id);
  }

  addWait(waiter: string, blocker: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#project.flight.addWait(waiter, blocker, reason, options);
  }

  removeWait(waiter: string, blocker: string, options?: WriteOptions): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#project.flight.removeWait(waiter, blocker, options);
  }

  waitHolds(id: string): Promise<Hold[]> {
    return this.#project.flight.waitHolds(id);
  }

  raiseQuestion(question: NewQuestion, options?: WriteOptions): Promise<SchemaRecord<"question">> {
    return this.#project.flight.raiseQuestion(question, options);
  }

  settleQuestion(id: string, settlement: Settlement, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#project.flight.settleQuestion(id, settlement, options);
  }

  questions(arcId: string): Promise<SchemaRecord<"question">[]> {
    return this.#project.flight.questions(arcId);
  }

  heldOnQuestion(incrementId: string): Promise<string[]> {
    return this.#project.flight.heldOnQuestion(incrementId);
  }

  checkQuestion(id: string, at?: Date): Promise<QuestionLease | null> {
    return this.#project.flight.checkQuestion(id, at);
  }

  renewQuestion(id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
    return this.#project.flight.renewQuestion(id, options);
  }

  lapsedQuestions(at?: Date): Promise<SchemaRecord<"question">[]> {
    return this.#project.flight.lapsedQuestions(at);
  }

  reportHealth(contractId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry> {
    return this.#project.health.reportHealth(contractId, state, options);
  }

  recordVerified(contractId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry> {
    return this.#project.health.recordVerified(contractId, state, options);
  }

  health(nodeId: string): Promise<NodeHealth> {
    return this.#project.health.health(nodeId);
  }

  healthHistory(contractId: string): Promise<HealthEntry[]> {
    return this.#project.health.healthHistory(contractId);
  }


  numberDecision(id: string, number: number, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return this.#project.knowledge.numberDecision(id, number, options);
  }

  decisionNumberPlan(): Promise<DecisionNumberPlan[]> {
    return this.#project.knowledge.decisionNumberPlan();
  }

  numberDecisionsFromFullRecord(options?: WriteOptions & { readonly apply?: boolean }): Promise<DecisionNumberPlan[]> {
    return this.#project.knowledge.numberDecisionsFromFullRecord(options);
  }

  setDecisionNumberFloor(floor: number, options?: WriteOptions & { readonly apply?: boolean }): Promise<number> {
    return this.#project.knowledge.setDecisionNumberFloor(floor, options);
  }

  numberFoundingDecisions(options?: WriteOptions & { readonly apply?: boolean }): Promise<DecisionNumberPlan[]> {
    return this.#project.knowledge.numberFoundingDecisions(options);
  }

  recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return this.#project.knowledge.recordDecision(decision, options);
  }

  writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K>> {
    return this.#project.knowledge.writeKnowledge(kind, fields, options);
  }

  defineTerm(definition: NewDefinition, options?: WriteOptions): Promise<SchemaRecord<"definition">> {
    return this.#project.knowledge.defineTerm(definition, options);
  }

  editNote(id: string, fields: NoteEdit, options?: WriteOptions): Promise<Note | null> {
    return this.#project.knowledge.editNote(id, fields, options);
  }

  search(query: string): Promise<Note[]> {
    return this.#project.knowledge.search(query);
  }

  relatedNotes(noteId: string): Promise<Note[]> {
    return this.#project.knowledge.relatedNotes(noteId);
  }

  related(noteId: string, options?: RelatedOptions): Promise<Related | null> {
    return this.#project.knowledge.related(noteId, options);
  }

  definitions(): Promise<SchemaRecord<"definition">[]> {
    return this.#project.knowledge.definitions();
  }

  frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]> {
    return this.#project.knowledge.frontCovers(nodeId);
  }

  decision(id: string): Promise<DecisionView | null> {
    return this.#project.knowledge.decision(id);
  }

  composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null> {
    return this.#project.knowledge.composeStatement(id, statement, options);
  }

  /**
   * Capability 2's retire. An id holding text the library cannot store names no record, so
   * retiring it is the same harmless no-op as retiring a missing one; it is never looked up, since
   * Postgres cannot even be asked for one.
   */
  async retire(id: string, reason: string, options?: WriteOptions): Promise<void> {
    if (!couldBeId(id)) return;
    await this.#project.flight.retire(id, reason, options);
  }

  /**
   * The history entries after `cursor`, each as { seq, recordId, type, action, record }. The
   * history's seq order is the order its changes committed (capability 2), so a reader passing
   * back each cursor it is handed never misses a change or sees one twice.
   */
  async changesSince(cursor: number): Promise<Changes> {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new RangeError(
        `changesSince takes a cursor: 0 to read from the start, or a cursor an earlier call handed back ` +
          `(a whole number, 0 or more), not ${typeof cursor === "string" ? JSON.stringify(cursor) : String(cursor)}`,
      );
    }
    const entries = await this.#project.records.history({ since: cursor });
    return {
      changes: entries.map(({ seq, recordId, type, action, record }) => ({ seq, recordId, type, action, record })),
      cursor: entries.at(-1)?.seq ?? cursor,
    };
  }

  close(): Promise<void> {
    return this.#project.close();
  }
}
