// Capability 7 · Library API
import type { Pool } from "pg";

import { attachMedia, media, mediaFile, type AttachedMedia, type MediaEntry, type MediaFile, type NewMedia } from "./commands/index.js";
import type { ChangedOnMain, HealthRecord, HealthWorkItem, NamedOnMain } from "./health/index.js";
import type { Knowledge } from "./knowledge/decisions/index.js";
import { recordPin, type PinNote, type WorkModel } from "./plan/index.js";
import type { ProjectLineage, ProjectRecords, Reached } from "./projects/open/index.js";
import type { Project } from "./projects/open/index.js";
import { RECORD_SCHEMAS, UnknownTypeError, type PluginRecordKind, type RecordType, type SchemaRecord, type WriteOptions } from "./storage/rules/index.js";
import type { HistoryEntry, RecordEnvelope } from "./storage/store/index.js";
import type { SurveyOptions, WorkInFlight, WorkSurvey } from "./work/arcs/index.js";
import { feedbackScreenshot, markFyisHeard, recordFyi, routeFeedback, sendFeedback, unheardFyis, type FeedbackNote, type FeedbackPictures, type FeedbackRoute, type NewFyi } from "./work/inbox/index.js";

const FROM_RECORDS = ["get", "history", "revert", "revertWrites"] as const;

const FROM_WORK = [
  "addStory", "editStory", "mapStories", "importPluginPlan", "addCapability", "editCapability", "setProposed", "addContract", "editContract",
  "addEdge", "editEdge", "dependsOn", "moveDependsOnToEdges", "anchor", "setAnchor", "prCutover", "setPrCutover",
] as const;

const FROM_FLIGHT = [
  "addIncrement", "advanceIncrement", "returnIncrement", "closeIncrement", "correctIncrementClosure", "moveIncrement", "editIncrement",
  "pendChange", "stalePending", "applyPending", "dropPending", "settleClosedPending", "openListing", "createArc", "editArc", "arcsFor",
  "parkArc", "unparkArc", "arcView", "arcViews", "boardArcs", "closedArcs", "addWait", "removeWait", "waitHolds", "addWaitFor",
  "removeWaitFor", "waitsFor", "holds", "raiseQuestion", "settleQuestion", "questions", "heldOnQuestion", "checkQuestion", "renewQuestion",
  "editQuestion", "linkNamedEvidence", "moveQuestion", "lapsedQuestions", "predictQuestion", "questionPrediction", "scoreQuestion",
  "prepQuestion", "questionDeviation",
] as const;

const FROM_HEALTH = [
  "reportHealth", "recordVerified", "recordVerifiedAll", "recordObserved", "recordUnclaimed", "markVerifiedPending", "tellUntold",
  "investigateFlake", "health", "healthHistory",
] as const;

const FROM_KNOWLEDGE = [
  "recordDecision", "numberDecision", "decisionNumberPlan", "numberDecisionsFromFullRecord", "setDecisionNumberFloor",
  "numberFoundingDecisions", "writeKnowledge", "defineTerm", "editNote", "search", "searchEach", "rank", "rankAll", "findPhrase",
  "relatedNotes", "related", "relatedEach", "definitions", "measures", "frontCovers", "decision", "decisions", "composeStatement", "refile",
] as const;

const FROM_LINEAGE = ["factory", "markFactory", "recordFactory"] as const;

const LATER = [
  "writtenBy", "moveNarrowsToClauses", "supersessionPairs", "decisionLinkBacklog", "decisionLinkChanges", "archivedLinks", "pruneLink",
  "restoreLink", "counts", "latestChanges", "findByTitle", "decisionNumbered",
] as const;

const ACTIONS: readonly HistoryEntry["action"][] = ["created", "updated", "retired"];

const LIBRARY_KINDS = Object.keys(RECORD_SCHEMAS).filter((kind) => kind !== "health") as RecordType[];

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

export interface PluginRecords {
  readonly plugin: string;
  readonly kinds: readonly { readonly kind: string; readonly count: number; readonly ids: readonly string[] }[];
}

export interface DormantKind {
  readonly kind: string;
  readonly count: number;
}

export interface KindCount {
  readonly kind: string;
  readonly count: number;
  readonly statuses: readonly { readonly status: string; readonly count: number }[];
}

export interface Counts {
  readonly kinds: readonly KindCount[];
  readonly openByArc: readonly { readonly arc: string; readonly title: string | null; readonly open: number }[];
}

export interface RecentChange {
  readonly seq: number;
  readonly at: string;
  readonly action: string;
  readonly type: string;
  readonly id: string;
  readonly title: string | null;
}

export interface TitleHit {
  readonly id: string;
  readonly type: string;
  readonly title: string | null;
}

export type FyiNote = Omit<NewFyi, "by"> & { readonly by: string };

type NotYetBuilt = { readonly [K in (typeof LATER)[number]]: (...args: unknown[]) => Promise<never> };

export interface Library
  extends Pick<ProjectRecords, (typeof FROM_RECORDS)[number]>,
    Pick<WorkModel, (typeof FROM_WORK)[number]>,
    Pick<WorkInFlight, (typeof FROM_FLIGHT)[number]>,
    Pick<HealthRecord, (typeof FROM_HEALTH)[number]>,
    Pick<Knowledge, (typeof FROM_KNOWLEDGE)[number]>,
    Pick<ProjectLineage, (typeof FROM_LINEAGE)[number]>,
    NotYetBuilt {
  readonly name: string;
  readonly identity: string;
  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
  inherited(): Promise<SchemaRecord[]>;
  naming(id: string): Promise<SchemaRecord[]>;
  linkingIn(id: string): Promise<SchemaRecord[]>;
  factoryLibrary(): Library | undefined;
  reach(name: string): Promise<Library>;
  reachAll(): Promise<Reached<Library>[]>;
  workSurvey(at?: Date, options?: SurveyOptions): Promise<WorkSurvey>;
  projectTree(options?: { readonly pendingOf?: string | undefined }): ReturnType<HealthRecord["annotate"]>;
  healthWorklist(options?: { readonly changed?: ReadonlyMap<string, ChangedOnMain>; readonly named?: NamedOnMain }): Promise<HealthWorkItem[]>;
  retireQuestion(id: string, reason: string, options?: WriteOptions): Promise<string[] | null>;
  retire(id: string, reason: string, options?: WriteOptions): Promise<void>;
  inOneWrite<T>(work: () => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T>;
  changesSince(cursor: number, filter?: ChangesFilter): Promise<Changes>;
  sendFeedback(note: FeedbackNote, options?: WriteOptions & FeedbackPictures): Promise<SchemaRecord<"feedback">>;
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

function delegate<T extends object, K extends keyof T>(target: T, names: readonly K[]): Pick<T, K> {
  return Object.fromEntries(names.map((name) => [name, (target[name] as (...args: unknown[]) => unknown).bind(target)])) as Pick<T, K>;
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function cursorOf(cursor: unknown): number {
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) throw new RangeError(`a cursor is a whole number from 0, not ${String(cursor)}`);
  return cursor;
}

function picked(fields: Readonly<Record<string, unknown>>, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.filter((name) => Object.hasOwn(fields, name)).map((name) => [name, fields[name]]));
}

async function pluginListing(pool: Pool, plugin: string): Promise<PluginRecords> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(plugin)) throw new RangeError(`${JSON.stringify(plugin)} is not a plugin's name`);
  const { rows } = await pool.query<{ type: string; id: string }>(
    `SELECT type, id FROM record WHERE left(type, length($1) + 1) = $1 || '.' ORDER BY type COLLATE "C", id COLLATE "C"`,
    [plugin],
  );
  const kinds = new Map<string, string[]>();
  for (const { type, id } of rows) kinds.set(type, [...(kinds.get(type) ?? []), id]);
  return { plugin, kinds: [...kinds].map(([kind, ids]) => ({ kind, count: ids.length, ids })) };
}

export function libraryOf(project: Project, kinds: readonly PluginRecordKind[] = []): Library {
  const { records, work, flight, health, knowledge, lineage, transactions, pool } = project;
  const wrap = (other: Project): Library => libraryOf(other, kinds);
  const declared = new Set(kinds.map(({ kind }) => kind));
  const later = Object.fromEntries(LATER.map((name) => [name, async () => {
    throw new Error(`${name} is not built in this library yet`);
  }])) as unknown as NotYetBuilt;

  const library: Library = {
    name: project.name,
    identity: project.identity,
    ...delegate(records, FROM_RECORDS),
    ...delegate(work, FROM_WORK),
    ...delegate(flight, FROM_FLIGHT),
    ...delegate(health, FROM_HEALTH),
    ...delegate(knowledge, FROM_KNOWLEDGE),
    ...delegate(lineage, FROM_LINEAGE),
    ...later,
    list: (kind) => records.list(kind),
    inherited: () => records.inherited(),
    async naming(id) {
      return (await records.list(LIBRARY_KINDS, { names: id })).sort(byId);
    },
    async linkingIn(id) {
      const named = await records.list(LIBRARY_KINDS, { names: id });
      return named.filter(({ type, fields }) => {
        const held = fields as { readonly links?: unknown; readonly dischargedBy?: unknown };
        return (Array.isArray(held.links) && held.links.includes(id)) || (type === "friction" && held.dischargedBy === id);
      }).sort(byId);
    },
    factoryLibrary: () => (project.factory === undefined ? undefined : wrap(project.factory)),
    reach: async (other) => wrap(await project.reach(other)),
    reachAll: async () => (await project.reachAll()).map((reached) => (reached.opened === undefined ? reached : { project: reached.project, opened: wrap(reached.opened) })),
    workSurvey: (at, options) => flight.workSurvey(at, options),
    async projectTree({ pendingOf } = {}) {
      const plan = await work.projectTree();
      const tree = pendingOf === undefined ? plan : ((await flight.withPending(pendingOf, plan)) ?? plan);
      return await health.annotate(tree, await flight.parkedCapabilities());
    },
    healthWorklist: (options) => health.worklist(options),
    retireQuestion: (id, reason, options) => flight.retireQuestion(id, reason, options),
    retire: (id, reason, options) => flight.retire(id, reason, options),
    inOneWrite: (task, options) => records.inOneWrite(task, options?.signal),
    async changesSince(given, filter = {}) {
      const cursor = cursorOf(given);
      for (const action of filter.actions ?? []) if (!ACTIONS.includes(action)) throw new RangeError(`${JSON.stringify(action)} is no change's action`);
      const entries = await records.history({
        since: cursor,
        ...(filter.types === undefined ? {} : { types: filter.types }),
        ...(filter.actions === undefined ? {} : { actions: filter.actions }),
      });
      const columns = filter.healthColumns;
      const kept = columns === undefined ? entries : entries.filter(({ type, record }) => type !== "health" || columns.includes(String(record.fields["column"])));
      const changes = kept.map(({ seq, recordId, type, action, record }) => ({
        seq,
        recordId,
        type,
        action,
        record: filter.fields === undefined ? record : { ...record, fields: picked(record.fields, filter.fields) },
      }));
      return { changes, cursor: entries.at(-1)?.seq ?? cursor };
    },
    sendFeedback: (note, options) => sendFeedback(records, pool, note, options),
    feedbackScreenshot: (id, options) => feedbackScreenshot(pool, id, options),
    routeFeedback: (id, route, options) => routeFeedback(records, id, route, options),
    recordFyi: (fyi, options) => recordFyi(records, fyi, options),
    unheardFyis: () => unheardFyis(records),
    markFyisHeard: (ids, options) => markFyisHeard(records, ids, options),
    recordPin: (pin, options) => recordPin(records, pin, options),
    async createPluginRecord(kind, fields, options = {}) {
      if (!kind.includes(".")) throw new UnknownTypeError(kind);
      return await records.create(kind as RecordType, fields as never, options);
    },
    async editPluginRecord(id, fields, options = {}) {
      const held = await records.get(id);
      if (held === null) return null;
      if (!held.type.includes(".")) throw new UnknownTypeError(held.type, id);
      return await records.edit(id, fields as never, options);
    },
    pluginRecords: (plugin) => pluginListing(pool, plugin),
    async removePluginRecords(listed, reason, options = {}) {
      return await transactions.inOneWrite(async () => {
        const now = await pluginListing(pool, listed.plugin);
        if (JSON.stringify(now) !== JSON.stringify(listed)) throw new Error(`the records of the plugin ${listed.plugin} changed since they were listed, so nothing was removed`);
        for (const { ids } of listed.kinds) {
          for (const id of ids) await transactions.retire({ id, reason, ...(options.actor === undefined ? {} : { actor: options.actor }) });
        }
        return listed;
      }, options.signal);
    },
    async dormantKinds() {
      const { rows } = await pool.query<{ kind: string; count: number }>(
        `SELECT type AS kind, count(*)::int AS count FROM record WHERE position('.' in type) > 0 GROUP BY type ORDER BY type COLLATE "C"`,
      );
      return rows.filter(({ kind }) => !declared.has(kind));
    },
    attachMedia: (id, file, options) => attachMedia(pool, async (held) => (await records.get(held)) !== null, id, file, options),
    media: (id) => media(pool, id),
    mediaFile: (id, name) => mediaFile(pool, id, name),
    close: () => project.close(),
  };
  return library;
}
