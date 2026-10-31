/**
 * Capability 7 · Library API (the library story): one small, fixed list of functions is the only
 * way anything outside the library reads or writes it. Session management, the arc surface, the forest
 * and the desktop app all call these, and changesSince lets them see what just changed without
 * re-reading everything.
 *
 * connect() reaches a Postgres server, and openProject() hands back a Library: the public face of
 * one project. It composes the internals (the project's transactions, typed records, work model,
 * knowledge and health) without exposing any of them, and everything it returns is data.
 */
import type { AnnotatedTree, ChangedOnMain, HealthWorkItem, NamedOnMain } from "../health/index.js";
import { connect as connectServer, type ConnectOptions, type OpenOptions, type OwnDatabaseOptions, type Project, type ProjectSnapshot, type Storytree as Server } from "../project/index.js";
import type { Pool } from "pg";
import { InheritedRecords } from "../project/factory.js";
import { DataQuestions } from "../data/data-questions.js";
import { couldBeId } from "../references.js";
import { randomUUID } from "node:crypto";

import { isPluginKind, UnknownTypeError, type FieldEdit, type FieldsOf, type RecordType, type SchemaRecord, type WriteOptions } from "../schema/index.js";
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
   * Handed its `tables`, the library sets it up (ADR-0973): it runs those the database has not yet
   * applied, in one transaction under the database's own lock, so callers setting it up at once take
   * turns and a database already set up runs no DDL. A
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
const FROM_RECORDS = ["get", "history", "revert", "revertWrites", "writtenBy"] as const satisfies readonly (keyof Project["records"])[];
const FROM_WORK = [
  "addStory", "editStory", "mapStories", "importPluginPlan", "createArc", "editArc", "addCapability", "editCapability", "setProposed", "addContract", "editContract", "arcsFor", "anchor", "setAnchor", "prCutover", "setPrCutover",
] as const satisfies readonly (keyof Project["work"])[];
const FROM_FLIGHT = [
  "addIncrement", "advanceIncrement", "returnIncrement", "closeIncrement", "correctIncrementClosure", "moveIncrement", "editIncrement", "pendChange", "stalePending", "applyPending", "dropPending", "settleClosedPending",
  "parkArc", "unparkArc", "arcView", "arcViews", "boardArcs", "closedArcs",
  "addWait", "removeWait", "waitHolds", "addWaitFor", "removeWaitFor", "waitsFor", "holds",
  "raiseQuestion", "settleQuestion", "questions", "heldOnQuestion", "checkQuestion", "renewQuestion", "editQuestion", "moveQuestion", "lapsedQuestions",
] as const satisfies readonly (keyof Project["flight"])[];
const FROM_HEALTH = ["reportHealth", "recordVerified", "markVerifiedPending", "health", "healthHistory"] as const satisfies readonly (keyof Project["health"])[];
const FROM_KNOWLEDGE = [
  "recordDecision", "numberDecision", "decisionNumberPlan", "numberDecisionsFromFullRecord", "setDecisionNumberFloor", "numberFoundingDecisions",
  "writeKnowledge", "defineTerm", "editNote", "search", "searchEach", "rank", "rankAll", "findPhrase",
  "relatedNotes", "related", "relatedEach", "definitions", "frontCovers", "decision", "decisions", "composeStatement", "refile",
] as const satisfies readonly (keyof Project["knowledge"])[];
const FROM_LINEAGE = ["factory", "markFactory", "recordFactory"] as const satisfies readonly (keyof Project["lineage"])[];
const FROM_DATA = ["counts", "latestChanges", "findByTitle", "decisionNumbered"] as const satisfies readonly (keyof DataQuestions)[];

/**
 * One project's library, as everything outside the library reaches it. Every write accepts
 * optional { actor } metadata, kept on its history entry rather than in the record's fields.
 *
 * Most of its operations are its parts' own (FROM_RECORDS and the lists beside it name them), each
 * documented on its method: records in schema/records.ts, the plan in work/work-model.ts, work in
 * flight in work/work-in-flight.ts, health in health/health-record.ts, knowledge in
 * knowledge/knowledge.ts, the project's factory in project/factory.ts and the fixed data questions in data/data-questions.ts. An editor shows that doc comment on the Library's method too.
 */
export interface Library
  extends Pick<Project["records"], (typeof FROM_RECORDS)[number]>,
    Pick<Project["work"], (typeof FROM_WORK)[number]>,
    Pick<Project["flight"], (typeof FROM_FLIGHT)[number]>,
    Pick<Project["health"], (typeof FROM_HEALTH)[number]>,
    Pick<Project["knowledge"], (typeof FROM_KNOWLEDGE)[number]>,
    Pick<Project["lineage"], (typeof FROM_LINEAGE)[number]>,
    Pick<DataQuestions, (typeof FROM_DATA)[number]> {
  /** The project's name. */
  readonly name: string;
  /** The identity of the project's database, as Storytree.projectIdentities() gives it. */
  readonly identity: string;
  /** Every live record of this kind, upgraded, in id order. An unknown kind is refused. */
  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
  /**
   * The system records a product project reads from its factory and holds none of its own for (1.19), in id order: what
   * its globe draws beside its own history. A project with no factory inherits none.
   */
  inherited(): Promise<SchemaRecord[]>;
  /**
   * The plan as it is now, story › capability › contract with every node's health, and the arcs: what the forest reads.
   * Given `pendingOf`, an increment, it is the plan that increment's branch reads (ADR-0966 D3): the live plan with
   * the increment's pending changes laid over (withPending). An id that is not a live increment lays nothing over.
   */
  projectTree(options?: { readonly pendingOf?: string | undefined }): Promise<AnnotatedTree>;
  /**
   * The health worklist (ADR-0825 D4): every capability that is not healthy, with its reason, who
   * moves it and since when, oldest first, leaving off one an increment not yet closed lists among its capabilities.
   * Given `changed`, by story id the newest commit on main that changed the story's code, a capability
   * its own-health run has not recorded since waits on that commit. Given `named`, the contracts main's
   * tests name, one whose every contract never recorded a test there names waits on a run, not a test.
   */
  healthWorklist(options?: { readonly changed?: ReadonlyMap<string, ChangedOnMain>; readonly named?: NamedOnMain }): Promise<HealthWorkItem[]>;
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
  /**
   * Keep a note sent from the desktop app's feedback corner as a new `feedback` record, its status new, with
   * `screenshot`, a JPEG of the window, and `crop`, one cut to the element it points at, kept beside it rather than in
   * its fields (Surface feedback 3.2, 3.3); a crop is kept only with its window picture. Fields that do not fit the type
   * are refused (SchemaError) and nothing is written, the pictures included.
   */
  sendFeedback(note: FeedbackNote, options?: WriteOptions & { readonly screenshot?: Uint8Array | undefined; readonly crop?: Uint8Array | undefined }): Promise<SchemaRecord<"feedback">>;
  /**
   * The JPEG a feedback note was sent with, or with `element`, the one cut to its element; null for a note sent without
   * one or no note at all.
   */
  feedbackScreenshot(id: string, options?: { readonly element?: boolean }): Promise<Uint8Array | null>;
  /**
   * Mark a new feedback note routed (Surface feedback 4.2): where it went, the increment or question it went to, and why.
   * Null, with nothing written, when `id` is no live feedback note; a note already routed is refused, as is a route the
   * type refuses (SchemaError), with nothing written.
   */
  routeFeedback(id: string, route: FeedbackRoute, options?: WriteOptions): Promise<SchemaRecord<"feedback"> | null>;
  /**
   * Keep an FYI (ADR-1184 D3): something the owner should know after the fact, as a new `fyi` record still to tell him.
   * Left out, `at` is now. Fields that do not fit the type are refused (SchemaError) and nothing is written.
   */
  recordFyi(fyi: FyiNote, options?: WriteOptions): Promise<SchemaRecord<"fyi">>;
  /** The FYIs the owner has not heard yet, oldest first (by `at`, then id). */
  unheardFyis(): Promise<SchemaRecord<"fyi">[]>;
  /**
   * Mark the FYIs `ids` names heard, now, so unheardFyis offers them no more; they stay in every other read and in history.
   * The ids it marked, in the order given; one already heard is left as it was. An id that is no live FYI is refused,
   * naming it, with nothing written.
   */
  markFyisHeard(ids: readonly string[], options?: WriteOptions): Promise<string[]>;
  /**
   * Save a new record of a plugin's own kind (`<plugin>.<kind>`, ADR-1178 D3), as the plugin's work hands it: only a kind
   * the project was opened with is written (OpenOptions' `kinds`), and fields that do not fit its declared shape are
   * refused (SchemaError). A core kind is refused, since each has its own write; so is a kind no mounted plugin declares
   * (UnknownTypeError), whose records read dormant. Either way nothing is written.
   */
  createPluginRecord(kind: string, fields: Record<string, unknown>, options?: WriteOptions): Promise<SchemaRecord>;
  /**
   * Change the named fields of a record of a plugin's own kind, merged onto what is stored now, as the plugin's work hands
   * them. `checkCurrent` is handed the record as it stands inside the write and refuses the edit by throwing, so a mark
   * that may be made only once is made once even when two writers race. A core kind's record is refused, since each has
   * its own edit, and so is a kind the project was not opened with (UnknownTypeError); fields that leave it outside its
   * declared shape are refused (SchemaError). Either way nothing is written. Null, with nothing written, when `id` is no
   * live record.
   */
  editPluginRecord(id: string, fields: Record<string, unknown>, options?: WriteOptions & { readonly checkCurrent?: (record: SchemaRecord) => void }): Promise<SchemaRecord | null>;
  /**
   * A plugin's records (ADR-1178 D4): every live record of a kind named under `plugin` (`<plugin>.<kind>`), by kind in
   * name order, each with how many and their ids in id order. What removePluginRecords is handed to remove them. A
   * name that is not a plugin's (lower-case letters, digits and dashes) is refused.
   */
  pluginRecords(plugin: string): Promise<PluginRecords>;
  /**
   * Remove `listed`, what pluginRecords gave: retire every record it names, with `reason`, and return it. Only that is
   * removed, so a listing that no longer matches the library's records of that plugin (one written or removed since) is
   * refused, removing nothing. Whether the plugin is switched off is its caller's to check: switching off removes nothing.
   */
  removePluginRecords(listed: PluginRecords, reason: string, options?: WriteOptions): Promise<PluginRecords>;
  /**
   * The plugin kinds this library holds live records of that the project was not opened with (ADR-1178 D3), each with
   * how many, in name order: what reads dormant here, which a list leaves out.
   */
  dormantKinds(): Promise<readonly DormantKind[]>;
  /** Close this library's connections. */
  close(): Promise<void>;
}

/** A plugin's records, as pluginRecords lists them. */
export interface PluginRecords {
  readonly plugin: string;
  readonly kinds: readonly { readonly kind: string; readonly count: number; readonly ids: readonly string[] }[];
}

/** A plugin kind whose records read dormant here, and how many live records of it the library holds. */
export interface DormantKind {
  readonly kind: string;
  readonly count: number;
}

/** A feedback note as the corner sends it: its record's fields but those the library sets. */
export type FeedbackNote = Omit<FieldsOf<"feedback">, "status" | "screenshot" | "crop" | keyof FeedbackRoute>;
/** An FYI as its writer hands it: its record's fields but `heardAt`, and `at` now when left out. */
export type FyiNote = Omit<FieldsOf<"fyi">, "at" | "heardAt"> & { readonly at?: string | undefined };
/** Where a feedback note was routed, and why. */
export interface FeedbackRoute {
  readonly route: NonNullable<FieldsOf<"feedback">["route"]>;
  readonly routedTo?: string;
  readonly routeReason: string;
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
    ...take(project.lineage, FROM_LINEAGE),
    ...take(new DataQuestions(project.pool), FROM_DATA),
    list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]> {
      return project.records.list(kind);
    },
    inherited: async () => (project.records instanceof InheritedRecords ? project.records.inherited() : []),
    /** The work model's tree, annotated with health (capability 5 reads the plan through capability 4). */
    async projectTree(options) {
      const parked = await project.flight.parkedCapabilities();
      if (options?.pendingOf === undefined || !couldBeId(options.pendingOf)) return project.health.annotate(undefined, parked);
      const tree = await project.work.projectTree();
      return project.health.annotate((await project.flight.withPending(options.pendingOf, tree)) ?? tree, parked);
    },
    healthWorklist: (options) => project.health.worklist({ ...(options?.changed === undefined ? {} : { changed: options.changed }), ...(options?.named === undefined ? {} : { named: options.named }) }),
    async createPluginRecord(kind, fields, options = {}) {
      if (!isPluginKind(kind)) throw new UnknownTypeError(kind);
      // A plugin's kind is no RecordType: the schema the project was opened with knows it, or refuses it.
      return project.records.create(kind as RecordType, fields as FieldsOf<RecordType>, options);
    },
    async editPluginRecord(id, fields, options = {}) {
      if (!couldBeId(id)) return null;
      const { checkCurrent, ...write } = options;
      return project.records.edit(id, fields as FieldEdit, {
        ...write,
        checkCurrent: (current) => {
          if (!isPluginKind(current.type)) throw new UnknownTypeError(current.type);
          checkCurrent?.(current);
        },
      });
    },
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
    /**
     * The picture is stored first, under the id the record is then saved with, so a record saying it has one never
     * lacks it; a record the schema refuses takes its picture away again.
     */
    async sendFeedback(note, options = {}) {
      const { screenshot, crop, ...write } = options;
      if (crop !== undefined && screenshot === undefined) throw new Error("a feedback note's crop is kept only with its window picture");
      const id = `feedback_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const fields: FieldsOf<"feedback"> = { ...note, status: "new", screenshot: screenshot !== undefined, ...(crop === undefined ? {} : { crop: true }) };
      project.records.check("feedback", fields);
      if (screenshot !== undefined) {
        await project.pool.query("INSERT INTO feedback_screenshot (record_id, jpeg, element_jpeg) VALUES ($1, $2, $3)", [id, Buffer.from(screenshot), crop === undefined ? null : Buffer.from(crop)]);
      }
      try {
        return await project.records.create("feedback", fields, { ...write, id, onlyIfNew: true });
      } catch (error) {
        if (screenshot !== undefined) await project.pool.query("DELETE FROM feedback_screenshot WHERE record_id = $1", [id]);
        throw error;
      }
    },
    async feedbackScreenshot(id, { element = false } = {}) {
      if (!couldBeId(id)) return null;
      const { rows } = await project.pool.query<{ jpeg: Buffer | null }>(`SELECT ${element ? "element_jpeg" : "jpeg"} AS jpeg FROM feedback_screenshot WHERE record_id = $1`, [id]);
      return rows[0]?.jpeg == null ? null : new Uint8Array(rows[0].jpeg);
    },
    async routeFeedback(id, route, options = {}) {
      const note = couldBeId(id) ? await project.records.get(id) : null;
      if (note?.type !== "feedback") return null;
      const routed = await project.records.edit(id, { ...route, status: "routed" }, {
        ...options,
        checkCurrent: (current) => {
          const { status, route: to, routedTo } = current.fields as FieldsOf<"feedback">;
          if (status !== "new") throw new Error(`feedback ${id} is already routed (${to ?? "somewhere"}${routedTo === undefined ? "" : ` to ${routedTo}`})`);
        },
      });
      return routed as SchemaRecord<"feedback"> | null;
    },
    async recordFyi({ at, ...fyi }, options = {}) {
      return project.records.create("fyi", { ...fyi, at: at ?? new Date().toISOString() }, options);
    },
    async unheardFyis() {
      // list gives id order and the sort is stable, so FYIs of the same moment stay in id order.
      const unheard = (await project.records.list("fyi")).filter(({ fields }) => fields.heardAt === undefined);
      return unheard.sort((one, other) => one.fields.at.localeCompare(other.fields.at));
    },
    async markFyisHeard(ids, options = {}) {
      const found = await Promise.all(ids.map(async (id) => (couldBeId(id) ? await project.records.get(id) : null)));
      const missing = ids.filter((_, at) => found[at]?.type !== "fyi");
      if (missing.length > 0) throw new Error(`no FYI ${missing.join(", ")}; nothing was marked heard`);
      const heardAt = new Date().toISOString();
      const marked: string[] = [];
      for (const record of found) {
        if ((record!.fields as FieldsOf<"fyi">).heardAt !== undefined || marked.includes(record!.id)) continue;
        await project.records.edit(record!.id, { heardAt }, options);
        marked.push(record!.id);
      }
      return marked;
    },
    pluginRecords: (plugin) => pluginRecordsOf(project.pool, plugin),
    async removePluginRecords(listed, reason, options) {
      const now = await pluginRecordsOf(project.pool, listed.plugin);
      if (JSON.stringify(now) !== JSON.stringify({ plugin: listed.plugin, kinds: listed.kinds })) {
        throw new Error(`${listed.plugin}'s records have changed since they were listed; nothing was removed. List them again.`);
      }
      for (const { ids } of now.kinds) for (const id of ids) await project.flight.retire(id, reason, options);
      return now;
    },
    async dormantKinds() {
      const { rows } = await project.pool.query<{ type: string; count: string }>("SELECT type, count(*) AS count FROM record WHERE strpos(type, '.') > 0 GROUP BY type ORDER BY type");
      return rows.filter(({ type }) => project.records.isDormant(type)).map(({ type, count }) => ({ kind: type, count: Number(count) }));
    },
    close: () => project.close(),
  };
}

/** The live records of `plugin`'s kinds, by kind. */
async function pluginRecordsOf(pool: Pool, plugin: string): Promise<PluginRecords> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin)) throw new Error(`${JSON.stringify(plugin)} is not a plugin's name: lower-case letters, digits and dashes`);
  const { rows } = await pool.query<{ type: string; id: string }>("SELECT type, id FROM record WHERE starts_with(type, $1) ORDER BY type, id", [`${plugin}.`]);
  const kinds = new Map<string, string[]>();
  for (const { type, id } of rows) kinds.set(type, [...(kinds.get(type) ?? []), id]);
  return { plugin, kinds: [...kinds].map(([kind, ids]) => ({ kind, count: ids.length, ids })) };
}

/** The methods `names` of `part`, each bound to it, so calling one through the face is calling it on the part. */
function take<Part extends object, Name extends keyof Part>(part: Part, names: readonly Name[]): Pick<Part, Name> {
  return Object.fromEntries(names.map((name) => [name, (part[name] as (...args: never[]) => unknown).bind(part)])) as Pick<Part, Name>;
}
