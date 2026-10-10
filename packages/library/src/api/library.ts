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
import type { AnnotatedTree, HealthWorkItem } from "../health/index.js";
import { connect as connectServer, type ConnectOptions, type OpenOptions, type OwnDatabaseOptions, type Project, type ProjectSnapshot, type Storytree as Server } from "../project/index.js";
import type { Pool } from "pg";
import { couldBeId } from "../references.js";
import type { RecordType, SchemaRecord, WriteOptions } from "../schema/index.js";
import type { HistoryEntry, RecordEnvelope } from "../transactions/index.js";

/** A connection to one Postgres server and the storytree projects on it. */
export interface Storytree {
  /**
   * Open the library of the project called `name`, creating its database the first time, or, with
   * `create: false`, only if its database is there: a project deleted from the library is refused
   * (ProjectGoneError), never made again by being opened, and so is one made again since under the
   * same name when `identity` names the database the caller knew. A name
   * that breaks the project-name rule is refused (ProjectNameError) before anything touches the
   * server. A server user that may not create databases borrows a role granted to it that may;
   * with none to borrow, it is refused (ConnectionError) with the two lines that grant one.
   */
  openProject(name: string, options?: OpenOptions): Promise<Library>;
  /** The names of the storytree projects on the server, sorted. No other database is listed. */
  listProjects(): Promise<string[]>;
  /**
   * Each project's name and the identity of its database. A project deleted and made again under
   * the same name has a new identity: the database is the project (ADR-0831).
   */
  projectIdentities(): Promise<Record<string, string>>;
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
  /**
   * Delete the project called `name`: its database, with every record and all its history, for
   * every machine using this server (ADR-0831). Others' connections to it are ended. There is no
   * undo: a snapshot taken first is the only way back. An unknown project is refused.
   */
  dropProject(name: string): Promise<void>;
  /**
   * A database of the caller's own called `name`, beside the projects on the same server, local or
   * Cloud SQL (contract 7.7, ADR-0735 D3): created the first time as a project's is, borrowing a
   * creator role where the user may not create databases; never listed as a project; closed with
   * this connection. The one pool the library hands out, and never to a project's database: the
   * agent activity log keeps its lines here, so it reaches the cloud wherever the library does.
   * Handed its `tables`, the library sets it up (ADR-0973): it runs them once per connection, in one
   * transaction under the database's own lock, so callers setting it up at once take turns. A
   * caller that only reads may leave them out.
   */
  ownDatabase(name: string, options?: OwnDatabaseOptions): Promise<Pool>;
  /** Close this connection, every library opened through it, and its own databases. */
  close(): Promise<void>;
}

/**
 * The operations a Library takes as they are from each part of a project. An operation is written
 * once, as a method of the part that owns it, and that method's doc comment is its contract; naming
 * it here is all it takes to put it on the face. What the face adds of its own is written out in
 * Library below.
 */
const FROM_RECORDS = ["get", "history"] as const satisfies readonly (keyof Project["records"])[];
const FROM_WORK = [
  "addStory", "editStory", "createArc", "editArc", "addCapability", "editCapability", "setProposed", "addContract", "editContract", "arcsFor",
] as const satisfies readonly (keyof Project["work"])[];
const FROM_FLIGHT = [
  "addIncrement", "advanceIncrement", "returnIncrement", "closeIncrement", "correctIncrementClosure", "moveIncrement", "editIncrement",
  "parkArc", "unparkArc", "arcView", "arcViews",
  "addWait", "removeWait", "waitHolds", "addWaitFor", "removeWaitFor", "waitsFor", "holds",
  "raiseQuestion", "settleQuestion", "questions", "heldOnQuestion", "checkQuestion", "renewQuestion", "editQuestion", "lapsedQuestions",
] as const satisfies readonly (keyof Project["flight"])[];
const FROM_HEALTH = ["reportHealth", "recordVerified", "health", "healthHistory"] as const satisfies readonly (keyof Project["health"])[];
const FROM_KNOWLEDGE = [
  "recordDecision", "numberDecision", "decisionNumberPlan", "numberDecisionsFromFullRecord", "setDecisionNumberFloor", "numberFoundingDecisions",
  "writeKnowledge", "defineTerm", "editNote", "search", "searchEach", "rank", "rankAll", "findPhrase",
  "relatedNotes", "related", "relatedEach", "definitions", "frontCovers", "decision", "decisions", "composeStatement",
] as const satisfies readonly (keyof Project["knowledge"])[];

/**
 * One project's library, as everything outside the library reaches it. Every write accepts
 * optional { actor } metadata, kept on its history entry rather than in the record's fields.
 *
 * Most of its operations are its parts' own (FROM_RECORDS and the lists beside it name them), each
 * documented on its method: records in schema/records.ts, the plan in work/work-model.ts, work in
 * flight in work/work-in-flight.ts, health in health/health-record.ts and knowledge in
 * knowledge/knowledge.ts. An editor shows that doc comment on the Library's method too.
 */
export interface Library
  extends Pick<Project["records"], (typeof FROM_RECORDS)[number]>,
    Pick<Project["work"], (typeof FROM_WORK)[number]>,
    Pick<Project["flight"], (typeof FROM_FLIGHT)[number]>,
    Pick<Project["health"], (typeof FROM_HEALTH)[number]>,
    Pick<Project["knowledge"], (typeof FROM_KNOWLEDGE)[number]> {
  /** The project's name. */
  readonly name: string;
  /** The identity of the project's database, as Storytree.projectIdentities() gives it. */
  readonly identity: string;
  /** Every live record of this kind, upgraded, in id order. An unknown kind is refused. */
  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
  /** The plan as it is now, story › capability › contract with every node's health, and the arcs: what the forest reads. */
  projectTree(): Promise<AnnotatedTree>;
  /**
   * The health worklist (ADR-0825 D4): every capability that is not healthy, with its reason, who
   * moves it and since when, oldest first, leaving off one an increment not yet closed lists among its capabilities.
   */
  healthWorklist(): Promise<HealthWorkItem[]>;
  /**
   * Retire a question that was wrong to ask, taking it off the heldOn of every increment held on it,
   * open or closed, in the same step. The increments released, oldest first; null, with nothing
   * written, if `id` is not a live question.
   */
  retireQuestion(id: string, reason: string, options?: WriteOptions): Promise<string[] | null>;
  /**
   * Retire a record: it is gone from every read, and its history keeps it and `reason`. Retiring
   * a missing or already retired record is a harmless no-op. A question an increment is held on is
   * refused (RetireRefusedError): take it off the increment's heldOn first, or settle it instead.
   * A capability with live dependents is also refused, naming every dependent: remove it from
   * their dependsOn first. Refusals write nothing.
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
 * Connect to a Postgres server: `{ url }` for one at a postgres:// URL, `{ cloudSql: { instance,
 * user } }` for a Cloud SQL instance, signed in to as your own Google account (capability 8), or
 * `{ address }` for any Postgres by address, its password the `postgres` key (capability 15).
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

  async openProject(name: string, options?: OpenOptions): Promise<Library> {
    return libraryOf(await this.#server.openProject(name, options));
  }

  listProjects(): Promise<string[]> {
    return this.#server.listProjects();
  }

  projectIdentities(): Promise<Record<string, string>> {
    return this.#server.projectIdentities();
  }

  snapshot(name: string): Promise<ProjectSnapshot> {
    return this.#server.snapshot(name);
  }

  restore(name: string, snapshot: ProjectSnapshot): Promise<void> {
    return this.#server.restore(name, snapshot);
  }

  dropProject(name: string): Promise<void> {
    return this.#server.dropProject(name);
  }

  ownDatabase(name: string, options?: OwnDatabaseOptions): Promise<Pool> {
    return this.#server.ownDatabase(name, options);
  }

  close(): Promise<void> {
    return this.#server.close();
  }
}

/**
 * A Library over one project's internals. It keeps the project in a closure, so nothing reaches
 * them through it: each part's operations are bound to that part, and the rest are written here.
 */
function libraryOf(project: Project): Library {
  return {
    name: project.name,
    identity: project.identity,
    ...take(project.records, FROM_RECORDS),
    ...take(project.work, FROM_WORK),
    ...take(project.flight, FROM_FLIGHT),
    ...take(project.health, FROM_HEALTH),
    ...take(project.knowledge, FROM_KNOWLEDGE),
    list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]> {
      return project.records.list(kind);
    },
    /** The work model's tree, annotated with health (capability 5 reads the plan through capability 4). */
    projectTree: () => project.health.annotate(),
    healthWorklist: () => project.health.worklist(),
    async retireQuestion(id, reason, options) {
      if (!couldBeId(id)) return null;
      return project.flight.retireQuestion(id, reason, options);
    },
    /**
     * Capability 2's retire. An id holding text the library cannot store names no record, so
     * retiring it is the same harmless no-op as retiring a missing one; it is never looked up, since
     * Postgres cannot even be asked for one.
     */
    async retire(id, reason, options) {
      if (!couldBeId(id)) return;
      await project.flight.retire(id, reason, options);
    },
    /**
     * The history entries after `cursor`, each as { seq, recordId, type, action, record }. The
     * history's seq order is the order its changes committed (capability 2), so a reader passing
     * back each cursor it is handed never misses a change or sees one twice.
     */
    async changesSince(cursor) {
      if (!Number.isSafeInteger(cursor) || cursor < 0) {
        throw new RangeError(
          `changesSince takes a cursor: 0 to read from the start, or a cursor an earlier call handed back ` +
            `(a whole number, 0 or more), not ${typeof cursor === "string" ? JSON.stringify(cursor) : String(cursor)}`,
        );
      }
      const entries = await project.records.history({ since: cursor });
      return {
        changes: entries.map(({ seq, recordId, type, action, record }) => ({ seq, recordId, type, action, record })),
        cursor: entries.at(-1)?.seq ?? cursor,
      };
    },
    close: () => project.close(),
  };
}

/** The methods `names` of `part`, each bound to it, so calling one through the face is calling it on the part. */
function take<Part extends object, Name extends keyof Part>(part: Part, names: readonly Name[]): Pick<Part, Name> {
  return Object.fromEntries(names.map((name) => [name, (part[name] as (...args: never[]) => unknown).bind(part)])) as Pick<Part, Name>;
}
