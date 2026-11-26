// Capability 7 · Library API
import type { AnnotatedTree, ChangedOnMain, HealthWorkItem, NamedOnMain, PluginOnMain } from "../health/index.js";
import { connect as connectServer, InheritedRecords, type ConnectOptions, type OpenOptions, type OwnDatabaseOptions, type Project, type ProjectSnapshot, type Reached, type Storytree as Server } from "../project/index.js";
import type { Pool } from "pg";
import { DataQuestions } from "../data/data-questions.js";
import { couldBeId, type FieldEdit, type FieldsOf, type HistoryEntry, isPluginKind, type RecordEnvelope, type RecordType, type SchemaRecord, UnknownTypeError, type WriteOptions } from "../records/index.js";
import { SCHEMA_VERSIONS } from "../schema/index.js";
import { createHash, randomUUID } from "node:crypto";

import type { SurveyOptions, WorkSurvey } from "../work/index.js";

export interface Storytree {
  openProject(name: string, options?: OpenOptions): Promise<Library>;
  listProjects(): Promise<string[]>;
  projectIdentities(): Promise<Record<string, string>>;
  snapshot(name: string): Promise<ProjectSnapshot>;
  restore(name: string, snapshot: ProjectSnapshot): Promise<void>;
  dropProject(name: string): Promise<void>;
  ownDatabase(name: string, options?: OwnDatabaseOptions): Promise<Pool>;
  close(): Promise<void>;
}

const FROM_RECORDS = ["get", "history", "revert", "revertWrites", "writtenBy"] as const satisfies readonly (keyof Project["records"])[];
const FROM_WORK = [
  "addStory", "editStory", "mapStories", "importPluginPlan", "addCapability", "editCapability", "setProposed", "addContract", "editContract", "addEdge", "editEdge", "dependsOn", "moveDependsOnToEdges", "anchor", "setAnchor", "prCutover", "setPrCutover",
] as const satisfies readonly (keyof Project["work"])[];
const FROM_FLIGHT = [
  "addIncrement", "advanceIncrement", "returnIncrement", "closeIncrement", "correctIncrementClosure", "moveIncrement", "editIncrement", "pendChange", "stalePending", "applyPending", "dropPending", "settleClosedPending", "openListing",
  "createArc", "editArc", "arcsFor", "parkArc", "unparkArc", "arcView", "arcViews", "boardArcs", "closedArcs",
  "addWait", "removeWait", "waitHolds", "addWaitFor", "removeWaitFor", "waitsFor", "holds",
  "raiseQuestion", "settleQuestion", "questions", "heldOnQuestion", "checkQuestion", "renewQuestion", "editQuestion", "linkNamedEvidence", "moveQuestion", "lapsedQuestions",
  "predictQuestion", "questionPrediction", "scoreQuestion", "prepQuestion", "questionDeviation",
] as const satisfies readonly (keyof Project["flight"])[];
const FROM_HEALTH = ["reportHealth", "recordVerified", "recordVerifiedAll", "recordObserved", "recordUnclaimed", "markVerifiedPending", "tellUntold", "investigateFlake", "health", "healthHistory"] as const satisfies readonly (keyof Project["health"])[];
const FROM_KNOWLEDGE = [
  "recordDecision", "numberDecision", "decisionNumberPlan", "numberDecisionsFromFullRecord", "setDecisionNumberFloor", "numberFoundingDecisions",
  "writeKnowledge", "defineTerm", "editNote", "search", "searchEach", "rank", "rankAll", "findPhrase",
  "relatedNotes", "related", "relatedEach", "definitions", "measures", "frontCovers", "decision", "decisions", "composeStatement", "moveNarrowsToClauses", "supersessionPairs", "decisionLinkBacklog", "decisionLinkChanges", "archivedLinks", "pruneLink", "restoreLink", "refile",
] as const satisfies readonly (keyof Project["knowledge"])[];
const FROM_LINEAGE = ["factory", "markFactory", "recordFactory"] as const satisfies readonly (keyof Project["lineage"])[];
const FROM_DATA = ["counts", "latestChanges", "findByTitle", "decisionNumbered"] as const satisfies readonly (keyof DataQuestions)[];

export interface Library
  extends Pick<Project["records"], (typeof FROM_RECORDS)[number]>,
    Pick<Project["work"], (typeof FROM_WORK)[number]>,
    Pick<Project["flight"], (typeof FROM_FLIGHT)[number]>,
    Pick<Project["health"], (typeof FROM_HEALTH)[number]>,
    Pick<Project["knowledge"], (typeof FROM_KNOWLEDGE)[number]>,
    Pick<Project["lineage"], (typeof FROM_LINEAGE)[number]>,
    Pick<DataQuestions, (typeof FROM_DATA)[number]> {
  readonly name: string;
  readonly identity: string;
  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
  inherited(): Promise<SchemaRecord[]>;
  naming(id: string): Promise<SchemaRecord[]>;
  linkingIn(id: string): Promise<SchemaRecord[]>;
  factoryLibrary(): Library | undefined;
  reach(name: string): Promise<Library>;
  reachAll(): Promise<Reached<Library>[]>;
  workSurvey(at?: Date, options?: Omit<SurveyOptions, "empty">): Promise<WorkSurvey>;
  projectTree(options?: { readonly pendingOf?: string | undefined }): Promise<AnnotatedTree>;
  healthWorklist(options?: { readonly changed?: ReadonlyMap<string, ChangedOnMain>; readonly named?: NamedOnMain; readonly plugins?: ReadonlyMap<string, PluginOnMain> }): Promise<HealthWorkItem[]>;
  retireQuestion(id: string, reason: string, options?: WriteOptions): Promise<string[] | null>;
  retire(id: string, reason: string, options?: WriteOptions): Promise<void>;
  inOneWrite<T>(work: () => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T>;
  changesSince(cursor: number, filter?: ChangesFilter): Promise<Changes>;
  sendFeedback(note: FeedbackNote, options?: WriteOptions & { readonly screenshot?: Uint8Array | undefined; readonly crop?: Uint8Array | undefined }): Promise<SchemaRecord<"feedback">>;
  feedbackScreenshot(id: string, options?: { readonly element?: boolean }): Promise<Uint8Array | null>;
  routeFeedback(id: string, route: FeedbackRoute, options?: WriteOptions): Promise<SchemaRecord<"feedback"> | null>;
  recordFyi(fyi: FyiNote, options?: WriteOptions): Promise<SchemaRecord<"fyi">>;
  unheardFyis(): Promise<SchemaRecord<"fyi">[]>;
  markFyisHeard(ids: readonly string[], options?: WriteOptions): Promise<string[]>;
  recordPin(pin: PinNote, options?: WriteOptions): Promise<SchemaRecord<"pin">>;
  createPluginRecord(kind: string, fields: Record<string, unknown>, options?: WriteOptions): Promise<SchemaRecord>;
  editPluginRecord(id: string, fields: Record<string, unknown>, options?: WriteOptions & { readonly checkCurrent?: (record: SchemaRecord) => void }): Promise<SchemaRecord | null>;
  pluginRecords(plugin: string): Promise<PluginRecords>;
  removePluginRecords(listed: PluginRecords, reason: string, options?: WriteOptions): Promise<PluginRecords>;
  dormantKinds(): Promise<readonly DormantKind[]>;
  attachMedia(id: string, file: NewMedia, options?: WriteOptions & { readonly replace?: boolean }): Promise<AttachedMedia>;
  media(id: string): Promise<MediaEntry[]>;
  mediaFile(id: string, name: string): Promise<MediaFile | null>;
  close(): Promise<void>;
}

export interface NewMedia {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

export interface MediaEntry {
  readonly recordId: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly sha256: string;
  readonly addedAt: string;
  readonly addedBy?: string;
}

export interface MediaFile extends MediaEntry {
  readonly bytes: Uint8Array;
}

export interface AttachedMedia extends MediaEntry {
  readonly outcome: "added" | "same" | "replaced";
}

const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const MEDIA_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const MEDIA_TYPE = /^[a-z]+\/[a-z0-9][a-z0-9.+-]*$/i;
const MEDIA_COLUMNS = "record_id, name, type, size, sha256, to_json(added_at) #>> '{}' AS added_at, added_by";

interface MediaRow {
  record_id: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  added_at: string;
  added_by: string | null;
  bytes?: Buffer;
}

function mediaEntryOf(row: MediaRow): MediaEntry {
  return { recordId: row.record_id, name: row.name, type: row.type, size: row.size, sha256: row.sha256, addedAt: row.added_at, ...(row.added_by === null ? {} : { addedBy: row.added_by }) };
}

export interface PluginRecords {
  readonly plugin: string;
  readonly kinds: readonly { readonly kind: string; readonly count: number; readonly ids: readonly string[] }[];
}

export interface DormantKind {
  readonly kind: string;
  readonly count: number;
}

export type FeedbackNote = Omit<FieldsOf<"feedback">, "status" | "screenshot" | "crop" | keyof FeedbackRoute>;
export type FyiNote = Omit<FieldsOf<"fyi">, "at" | "heardAt"> & { readonly at?: string | undefined };
export type PinNote = Omit<FieldsOf<"pin">, "at"> & { readonly at?: string | undefined };
export interface FeedbackRoute {
  readonly route: NonNullable<FieldsOf<"feedback">["route"]>;
  readonly routedTo?: string;
  readonly routeReason: string;
}

export interface Change {
  seq: number;
  recordId: string;
  type: string;
  action: HistoryEntry["action"];
  record: RecordEnvelope;
}

export interface ChangesFilter {
  readonly types?: readonly string[];
  readonly actions?: readonly HistoryEntry["action"][];
  readonly fields?: readonly string[];
  readonly healthColumns?: readonly string[];
}

export interface Changes {
  changes: Change[];
  cursor: number;
}

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

async function emptyArcs(pool: Project["pool"], arcs: readonly string[]): Promise<ReadonlySet<string>> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT a.id FROM unnest($1::text[]) AS a(id) WHERE NOT EXISTS (SELECT 1 FROM record WHERE type = 'increment' AND fields->>'arc' = a.id)",
    [arcs],
  );
  return new Set(rows.map(({ id }) => id));
}

function libraryOf(project: Project): Library {
  let factory: Library | undefined;
  const reached = new Map<Project, Library>();
  const other = (opened: Project): Library => {
    if (opened === project) return library;
    let found = reached.get(opened);
    if (found === undefined) reached.set(opened, (found = { ...libraryOf(opened), close: async () => undefined }));
    return found;
  };
  const library: Library = {
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
    naming: (id) => project.records.list((Object.keys(SCHEMA_VERSIONS) as RecordType[]).filter((kind) => kind !== "health"), { names: id }),
    linkingIn: async (id) => (await library.naming(id)).filter((record) => {
      const fields = record.fields as { readonly links?: unknown; readonly dischargedBy?: unknown };
      return (Array.isArray(fields.links) && fields.links.includes(id)) || (record.type === "friction" && fields.dischargedBy === id);
    }),
    inherited: async () => (project.records instanceof InheritedRecords ? project.records.inherited() : []),
    factoryLibrary: () => (project.factory === undefined ? undefined : (factory ??= { ...libraryOf(project.factory), close: async () => undefined })),
    reach: async (name) => other(await project.reach(name)),
    reachAll: async () => (await project.reachAll()).map((each) => (each.opened === undefined ? each : { project: each.project, opened: other(each.opened) })),
    workSurvey: (at, options) => project.flight.workSurvey(at, { ...options, empty: (arcs) => emptyArcs(project.pool, arcs) }),
    async projectTree(options) {
      const parked = await project.flight.parkedCapabilities();
      if (options?.pendingOf === undefined || !couldBeId(options.pendingOf)) return project.health.annotate(undefined, parked);
      const tree = await project.work.projectTree();
      return project.health.annotate((await project.flight.withPending(options.pendingOf, tree)) ?? tree, parked);
    },
    healthWorklist: (options) => project.health.worklist({ ...(options?.changed === undefined ? {} : { changed: options.changed }), ...(options?.named === undefined ? {} : { named: options.named }), ...(options?.plugins === undefined ? {} : { plugins: options.plugins }) }),
    async createPluginRecord(kind, fields, options = {}) {
      if (!isPluginKind(kind)) throw new UnknownTypeError(kind, Object.keys(SCHEMA_VERSIONS));
      return project.records.create(kind as RecordType, fields as FieldsOf<RecordType>, options);
    },
    async editPluginRecord(id, fields, options = {}) {
      if (!couldBeId(id)) return null;
      const { checkCurrent, ...write } = options;
      return project.records.edit(id, fields as FieldEdit, {
        ...write,
        checkCurrent: (current) => {
          if (!isPluginKind(current.type)) throw new UnknownTypeError(current.type, Object.keys(SCHEMA_VERSIONS));
          checkCurrent?.(current);
        },
      });
    },
    inOneWrite: (work, options) => project.transactions.inOneWrite(work, options?.signal),
    async retireQuestion(id, reason, options) {
      if (!couldBeId(id)) return null;
      return project.flight.retireQuestion(id, reason, options);
    },
    async retire(id, reason, options) {
      if (!couldBeId(id)) return;
      await project.flight.retire(id, reason, options);
    },
    async changesSince(cursor, { types, actions, fields, healthColumns } = {}) {
      if (!Number.isSafeInteger(cursor) || cursor < 0) {
        throw new RangeError(
          `changesSince takes a cursor: 0 to read from the start, or a cursor an earlier call handed back ` +
            `(a whole number, 0 or more), not ${typeof cursor === "string" ? JSON.stringify(cursor) : String(cursor)}`,
        );
      }
      const upTo = healthColumns === undefined ? undefined : (await project.records.history({ since: cursor, newest: 1, fields: [] })).at(-1)?.seq ?? cursor;
      const entries = await project.records.history({
        since: cursor,
        ...(types === undefined ? {} : { types }),
        ...(actions === undefined ? {} : { actions }),
        ...(fields === undefined ? {} : { fields }),
        ...(healthColumns === undefined ? {} : { healthColumns, upTo: upTo! }),
      });
      return {
        changes: entries.map(({ seq, recordId, type, action, record }) => ({ seq, recordId, type, action, record })),
        cursor: upTo ?? entries.at(-1)?.seq ?? cursor,
      };
    },
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
    async recordPin({ at, ...pin }, options = {}) {
      return project.records.create("pin", { ...pin, at: at ?? new Date().toISOString() }, options);
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
    async attachMedia(id, { name, type, bytes }, { replace = false, ...write } = {}) {
      if (typeof name !== "string" || !MEDIA_NAME.test(name)) {
        throw new Error(`${JSON.stringify(name)} is not a file name media is kept under: letters, digits, dots, dashes and underscores, starting with a letter or digit, at most 200 characters`);
      }
      if (typeof type !== "string" || !MEDIA_TYPE.test(type)) throw new Error(`${JSON.stringify(type)} is not a media type, such as image/png or video/mp4`);
      if (!(bytes instanceof Uint8Array)) throw new Error(`${name}'s bytes are not bytes`);
      if (bytes.length > MEDIA_MAX_BYTES) throw new Error(`${name} is ${bytes.length.toLocaleString("en")} bytes; a file kept in the library is at most 10 MB (${MEDIA_MAX_BYTES.toLocaleString("en")} bytes)`);
      const live = couldBeId(id) && (await project.pool.query("SELECT 1 FROM record WHERE id = $1", [id])).rowCount === 1;
      if (!live) throw new Error(`no live record ${id}: a file is kept only beside a live record`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const held = (await project.pool.query<MediaRow>(`SELECT ${MEDIA_COLUMNS} FROM media WHERE record_id = $1 AND name = $2`, [id, name])).rows[0];
      if (held?.sha256 === sha256) return { ...mediaEntryOf(held), outcome: "same" };
      if (held !== undefined && !replace) {
        throw new Error(`${id} already holds other bytes as ${name} (sha256 ${held.sha256.slice(0, 12)}…); attach these with replace to keep them instead`);
      }
      const values = [id, name, type, bytes.length, sha256, Buffer.from(bytes), write.actor ?? null];
      const { rows } = held === undefined
        ? await project.pool.query<MediaRow>(`INSERT INTO media (record_id, name, type, size, sha256, bytes, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (record_id, name) DO NOTHING RETURNING ${MEDIA_COLUMNS}`, values)
        : await project.pool.query<MediaRow>(`UPDATE media SET type = $3, size = $4, sha256 = $5, bytes = $6, added_by = $7, added_at = now() WHERE record_id = $1 AND name = $2 RETURNING ${MEDIA_COLUMNS}`, values);
      if (rows[0] === undefined) throw new Error(`${name} was attached to ${id} by another writer meanwhile; nothing was written. List its media and try again.`);
      return { ...mediaEntryOf(rows[0]), outcome: held === undefined ? "added" : "replaced" };
    },
    async media(id) {
      if (!couldBeId(id)) return [];
      const { rows } = await project.pool.query<MediaRow>(`SELECT ${MEDIA_COLUMNS} FROM media WHERE record_id = $1 ORDER BY name COLLATE "C"`, [id]);
      return rows.map(mediaEntryOf);
    },
    async mediaFile(id, name) {
      if (!couldBeId(id)) return null;
      const { rows } = await project.pool.query<MediaRow>(`SELECT ${MEDIA_COLUMNS}, bytes FROM media WHERE record_id = $1 AND name = $2`, [id, name]);
      return rows[0] === undefined ? null : { ...mediaEntryOf(rows[0]), bytes: new Uint8Array(rows[0].bytes!) };
    },
    close: () => project.close(),
  };
  return library;
}

async function pluginRecordsOf(pool: Pool, plugin: string): Promise<PluginRecords> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin)) throw new Error(`${JSON.stringify(plugin)} is not a plugin's name: lower-case letters, digits and dashes`);
  const { rows } = await pool.query<{ type: string; id: string }>("SELECT type, id FROM record WHERE starts_with(type, $1) ORDER BY type, id", [`${plugin}.`]);
  const kinds = new Map<string, string[]>();
  for (const { type, id } of rows) kinds.set(type, [...(kinds.get(type) ?? []), id]);
  return { plugin, kinds: [...kinds].map(([kind, ids]) => ({ kind, count: ids.length, ids })) };
}

function take<Part extends object, Name extends keyof Part>(part: Part, names: readonly Name[]): Pick<Part, Name> {
  return Object.fromEntries(names.map((name) => [name, (part[name] as (...args: never[]) => unknown).bind(part)])) as Pick<Part, Name>;
}
