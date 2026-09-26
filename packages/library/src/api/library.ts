/**
 * Capability 7 · Library API (stories/library.md): one small, fixed list of functions is the only
 * way anything outside the library reads or writes it. The agent link, the arc surface, the forest
 * and the desktop app all call these, and changesSince lets them see what just changed without
 * re-reading everything.
 *
 * connect() reaches a Postgres server, and openProject() hands back a Library: the public face of
 * one project. It composes the internals (the project's transactions, typed records, work model,
 * knowledge and health) without exposing any of them, and everything it returns is data.
 */
import type { AnnotatedTree, HealthEntry, HealthOptions, HealthState, NodeHealth } from "../health/index.js";
import type { DecisionView, NewDecision, NewDefinition, NewKnowledge, NewMemory, Note, NoteEdit } from "../knowledge/index.js";
import { connect as connectServer, type ConnectOptions, type Project, type Storytree as Server } from "../project/index.js";
import { couldBeId } from "../references.js";
import type { SchemaRecord } from "../schema/index.js";
import type { KnowledgeKind } from "../schema/types.js";
import type { HistoryEntry, RecordEnvelope } from "../transactions/index.js";
import type {
  ArcEdit,
  ArcView,
  CapabilityEdit,
  CloseInput,
  ContractEdit,
  Hold,
  NewQuestion,
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
  /** Close this connection and every library opened through it. */
  close(): Promise<void>;
}

/** One project's library, as everything outside the library reaches it. */
export interface Library {
  /** The project's name. */
  readonly name: string;

  /** Add a story to the project, under an id the library makes. */
  addStory(story: NewStory): Promise<SchemaRecord<"story">>;
  /**
   * Change only the named fields of a story, merged onto what is stored now. Null, with nothing
   * written, if `id` is not a live story.
   */
  editStory(id: string, fields: StoryEdit): Promise<SchemaRecord<"story"> | null>;
  /**
   * Create an arc, with its intent and end state. Every story it lists must be a live story
   * (MissingReferenceError otherwise); it may list none.
   */
  createArc(arc: NewArc): Promise<SchemaRecord<"arc">>;
  /**
   * Change only the named fields of an arc. Every story a new `stories` lists must be a live story
   * (MissingReferenceError otherwise). Null, with nothing written, if `id` is not a live arc.
   */
  editArc(id: string, fields: ArcEdit): Promise<SchemaRecord<"arc"> | null>;
  /** Add a capability to a story. The story, and every capability it depends on, must be live. */
  addCapability(capability: NewCapability): Promise<SchemaRecord<"capability">>;
  /**
   * Change only the named fields of a capability. A dependency that would close a loop is refused
   * (DependencyLoopError). Null, with nothing written, if `id` is not a live capability.
   */
  editCapability(id: string, fields: CapabilityEdit): Promise<SchemaRecord<"capability"> | null>;
  /** Add a contract to a capability, which must be a live capability. */
  addContract(contract: NewContract): Promise<SchemaRecord<"contract">>;
  /**
   * Change only the named fields of a contract. A new `capability` must be a live capability
   * (MissingReferenceError otherwise). Null, with nothing written, if `id` is not a live contract.
   */
  editContract(id: string, fields: ContractEdit): Promise<SchemaRecord<"contract"> | null>;
  /** The plan as it is now, story › capability › contract with every node's health, and the arcs: what the forest reads. */
  projectTree(): Promise<AnnotatedTree>;
  /** The live arcs listing story `storyId`, in creation order. */
  arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]>;

  /**
   * Add an increment to a live arc: a proposal, stamped with when it was parked, or, given an
   * `outcome`, born closed. Everything it touches or remedies must be live.
   */
  addIncrement(increment: NewIncrement): Promise<SchemaRecord<"increment">>;
  /** Move an increment on, to ready or active, only forward (LifecycleError otherwise). Null if `id` is not a live increment. */
  advanceIncrement(id: string, to: "ready" | "active"): Promise<SchemaRecord<"increment"> | null>;
  /**
   * Close an increment with its pull request, note and what the close meant; a close with no pull
   * request needs a note. Null if `id` is not a live increment.
   */
  closeIncrement(id: string, close: CloseInput): Promise<SchemaRecord<"increment"> | null>;
  /** Change an increment's title, objective, body, or what it touches and remedies. Null if `id` is not a live increment. */
  editIncrement(id: string, fields: IncrementEdit): Promise<SchemaRecord<"increment"> | null>;
  /** Park an arc: it reads parked until unparked. Null if `id` is not a live arc. */
  parkArc(id: string): Promise<SchemaRecord<"arc"> | null>;
  /** Unpark an arc. Null if `id` is not a live arc. */
  unparkArc(id: string): Promise<SchemaRecord<"arc"> | null>;
  /** An arc whole: its state (worked out on every read, or parked) and its increments, oldest first. Null if `id` is not a live arc. */
  arcView(id: string): Promise<ArcView | null>;

  /**
   * Make an arc wait on an arc, or an increment on an increment on any arc, with a reason. A wait
   * that would close a loop across arcs and increments is refused (WaitLoopError). Null if `waiter`
   * is not a live arc or increment.
   */
  addWait(waiter: string, blocker: string, reason: string): Promise<SchemaRecord<"arc" | "increment"> | null>;
  /** Stop `waiter` waiting on `blocker`. Null if `waiter` is not a live arc or increment. */
  removeWait(waiter: string, blocker: string): Promise<SchemaRecord<"arc" | "increment"> | null>;
  /**
   * The blockers still holding `id`, an arc or an increment, each with its reason and whether it can
   * never release: the one answer to whether a wait holds.
   */
  waitHolds(id: string): Promise<Hold[]>;

  /** Raise a question for the owner on a live arc: it is open. */
  raiseQuestion(question: NewQuestion): Promise<SchemaRecord<"question">>;
  /**
   * Settle a question with the owner's answer, and the live decision that carried it, if one did.
   * Null if `id` is not a live question.
   */
  settleQuestion(id: string, settlement: Settlement): Promise<SchemaRecord<"question"> | null>;
  /** The questions on arc `arcId`, open and settled, oldest first. */
  questions(arcId: string): Promise<SchemaRecord<"question">[]>;
  /** The open questions an open increment is held on: the one answer to whether it waits on the owner. */
  heldOnQuestion(incrementId: string): Promise<string[]>;

  /** Write what the agent reported about a contract. Health is written on contracts only: anything else is refused. */
  reportHealth(contractId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry>;
  /** Write what storytree verified about a contract, by seeing it for itself. */
  recordVerified(contractId: string, state: HealthState, options?: HealthOptions): Promise<HealthEntry>;
  /** A story's, capability's or contract's health: the reported and the verified column side by side. */
  health(nodeId: string): Promise<NodeHealth>;
  /** Every health entry of a contract, both columns, in the order written. */
  healthHistory(contractId: string): Promise<HealthEntry[]>;

  /** Write a memory note. Every link must name a live note: notes link only to notes. */
  writeMemory(memory: NewMemory): Promise<SchemaRecord<"memory">>;
  /**
   * Record a decision, with its status. Every link must name a live note, `frontCoverOf`, if given,
   * the one live story or capability the decision is a front cover of, and each decision it
   * supersedes a live decision. It is numbered one past the highest number any decision has held,
   * unless it is brought in under its own, which no other may have held (NumberTakenError).
   */
  recordDecision(decision: NewDecision): Promise<SchemaRecord<"decision">>;
  /**
   * Write a principle, guardrail, pattern, process, agent role, friction, re-steer or tech stack,
   * with its kind's fields. Every link, and an agent role's or process's other references, must name
   * a live note.
   */
  writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>): Promise<SchemaRecord<K>>;
  /** Define a term. Every link must name a live note. */
  defineTerm(definition: NewDefinition): Promise<SchemaRecord<"definition">>;
  /** Change only the named fields of a note, keeping its old wording in history. Null if `id` is not a live note. */
  editNote(id: string, fields: NoteEdit): Promise<Note | null>;
  /** The live notes holding every word of `query`, ignoring case, in creation order. */
  search(query: string): Promise<Note[]>;
  /** The live notes linking to note `noteId`, in creation order. */
  relatedNotes(noteId: string): Promise<Note[]>;
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
  composeStatement(id: string, statement: string): Promise<SchemaRecord<"decision"> | null>;

  /**
   * Retire a record: it is gone from every read, and its history keeps it and `reason`. Retiring
   * a missing or already retired record is a harmless no-op. A question an increment is held on is
   * refused (RetireRefusedError): take it off the increment's heldOn first, or settle it instead.
   */
  retire(id: string, reason: string): Promise<void>;
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

  addStory(story: NewStory): Promise<SchemaRecord<"story">> {
    return this.#project.work.addStory(story);
  }

  editStory(id: string, fields: StoryEdit): Promise<SchemaRecord<"story"> | null> {
    return this.#project.work.editStory(id, fields);
  }

  createArc(arc: NewArc): Promise<SchemaRecord<"arc">> {
    return this.#project.work.createArc(arc);
  }

  editArc(id: string, fields: ArcEdit): Promise<SchemaRecord<"arc"> | null> {
    return this.#project.work.editArc(id, fields);
  }

  addCapability(capability: NewCapability): Promise<SchemaRecord<"capability">> {
    return this.#project.work.addCapability(capability);
  }

  editCapability(id: string, fields: CapabilityEdit): Promise<SchemaRecord<"capability"> | null> {
    return this.#project.work.editCapability(id, fields);
  }

  addContract(contract: NewContract): Promise<SchemaRecord<"contract">> {
    return this.#project.work.addContract(contract);
  }

  editContract(id: string, fields: ContractEdit): Promise<SchemaRecord<"contract"> | null> {
    return this.#project.work.editContract(id, fields);
  }

  /** The work model's tree, annotated with health (capability 5 reads the plan through capability 4). */
  projectTree(): Promise<AnnotatedTree> {
    return this.#project.health.annotate();
  }

  arcsFor(storyId: string): Promise<SchemaRecord<"arc">[]> {
    return this.#project.work.arcsFor(storyId);
  }

  addIncrement(increment: NewIncrement): Promise<SchemaRecord<"increment">> {
    return this.#project.flight.addIncrement(increment);
  }

  advanceIncrement(id: string, to: "ready" | "active"): Promise<SchemaRecord<"increment"> | null> {
    return this.#project.flight.advanceIncrement(id, to);
  }

  closeIncrement(id: string, close: CloseInput): Promise<SchemaRecord<"increment"> | null> {
    return this.#project.flight.closeIncrement(id, close);
  }

  editIncrement(id: string, fields: IncrementEdit): Promise<SchemaRecord<"increment"> | null> {
    return this.#project.flight.editIncrement(id, fields);
  }

  parkArc(id: string): Promise<SchemaRecord<"arc"> | null> {
    return this.#project.flight.parkArc(id);
  }

  unparkArc(id: string): Promise<SchemaRecord<"arc"> | null> {
    return this.#project.flight.unparkArc(id);
  }

  arcView(id: string): Promise<ArcView | null> {
    return this.#project.flight.arcView(id);
  }

  addWait(waiter: string, blocker: string, reason: string): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#project.flight.addWait(waiter, blocker, reason);
  }

  removeWait(waiter: string, blocker: string): Promise<SchemaRecord<"arc" | "increment"> | null> {
    return this.#project.flight.removeWait(waiter, blocker);
  }

  waitHolds(id: string): Promise<Hold[]> {
    return this.#project.flight.waitHolds(id);
  }

  raiseQuestion(question: NewQuestion): Promise<SchemaRecord<"question">> {
    return this.#project.flight.raiseQuestion(question);
  }

  settleQuestion(id: string, settlement: Settlement): Promise<SchemaRecord<"question"> | null> {
    return this.#project.flight.settleQuestion(id, settlement);
  }

  questions(arcId: string): Promise<SchemaRecord<"question">[]> {
    return this.#project.flight.questions(arcId);
  }

  heldOnQuestion(incrementId: string): Promise<string[]> {
    return this.#project.flight.heldOnQuestion(incrementId);
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

  writeMemory(memory: NewMemory): Promise<SchemaRecord<"memory">> {
    return this.#project.knowledge.writeMemory(memory);
  }

  recordDecision(decision: NewDecision): Promise<SchemaRecord<"decision">> {
    return this.#project.knowledge.recordDecision(decision);
  }

  writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>): Promise<SchemaRecord<K>> {
    return this.#project.knowledge.writeKnowledge(kind, fields);
  }

  defineTerm(definition: NewDefinition): Promise<SchemaRecord<"definition">> {
    return this.#project.knowledge.defineTerm(definition);
  }

  editNote(id: string, fields: NoteEdit): Promise<Note | null> {
    return this.#project.knowledge.editNote(id, fields);
  }

  search(query: string): Promise<Note[]> {
    return this.#project.knowledge.search(query);
  }

  relatedNotes(noteId: string): Promise<Note[]> {
    return this.#project.knowledge.relatedNotes(noteId);
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

  composeStatement(id: string, statement: string): Promise<SchemaRecord<"decision"> | null> {
    return this.#project.knowledge.composeStatement(id, statement);
  }

  /**
   * Capability 2's retire. An id holding text the library cannot store names no record, so
   * retiring it is the same harmless no-op as retiring a missing one; it is never looked up, since
   * Postgres cannot even be asked for one.
   */
  async retire(id: string, reason: string): Promise<void> {
    if (!couldBeId(id)) return;
    await this.#project.flight.retire(id, reason);
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
