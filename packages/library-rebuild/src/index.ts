// Capability 2 · Library transactions
import type { Pool } from "pg";

import type { Knowledge } from "./knowledge/decisions/index.js";
import type { WorkModel } from "./plan/index.js";
import { connect as connectServer, type ConnectOptions, type OwnDatabaseOptions, type ProjectSnapshot } from "./projects/open/index.js";
import type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./storage/store/index.js";
import type { RecordType, SchemaRecord, WriteOptions } from "./storage/rules/index.js";

export { MissingUpgradeError, NewerSchemaError, pluginSchema, SchemaError, UnknownTypeError } from "./storage/rules/index.js";
export type { FieldsOf, PluginRecordKind, PluginUpgradeStep, RecordType, SchemaRecord, WriteOptions } from "./storage/rules/index.js";
export type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./storage/store/index.js";
export type { ConnectOptions, ProjectSnapshot } from "./projects/open/index.js";
export { ConnectionError, connectionString } from "./projects/shared/index.js";
export { RetireRefusedError } from "./work/inbox/index.js";
export { NOT_VERIFIED, wordAndWhy } from "./health/index.js";
export type {
  AnnotatedCapability,
  AnnotatedContract,
  AnnotatedEdge,
  AnnotatedStory,
  AnnotatedTree,
  CapabilityStatus,
  CapabilityWhy,
  ChangedOnMain,
  EarlierVerdict,
  FlakeSeen,
  HealthColumn,
  HealthColumnName,
  HealthEntry,
  HealthOptions,
  HealthReason,
  HealthSource,
  HealthState,
  HealthWorkItem,
  NamedOnMain,
  NodeHealth,
  OpenWait,
  PendingRun,
  SkipKind,
  VerifiedVerdict,
} from "./health/index.js";

export interface Change {
  seq: number;
  recordId: string;
  type: string;
  action: HistoryEntry["action"];
  record: RecordEnvelope;
}

export interface Changes {
  changes: Change[];
  cursor: number;
}

export interface Library extends Pick<WorkModel, "addStory" | "addCapability" | "projectTree">, Pick<Knowledge, "recordDecision" | "defineTerm" | "decision" | "frontCovers" | "editNote"> {
  readonly name: string;
  get(id: string): Promise<SchemaRecord | null>;
  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
  history(filter?: HistoryFilter): Promise<HistoryEntry[]>;
  retire(id: string, reason: string, options?: WriteOptions): Promise<void>;
  inOneWrite<T>(work: () => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T>;
  changesSince(cursor: number): Promise<Changes>;
  close(): Promise<void>;
}

export interface Storytree {
  openProject(name: string): Promise<Library>;
  listProjects(): Promise<string[]>;
  snapshot(name: string): Promise<ProjectSnapshot>;
  ownDatabase(name: string, options?: OwnDatabaseOptions): Promise<Pool>;
  close(): Promise<void>;
}

export async function connect(options: ConnectOptions): Promise<Storytree> {
  const server = await connectServer(options);
  return {
    async openProject(name) {
      const { records, work, knowledge, close } = await server.openProject(name);
      return {
        name,
        addStory: (story, options) => work.addStory(story, options),
        addCapability: (capability, options) => work.addCapability(capability, options),
        projectTree: () => work.projectTree(),
        get: (id) => records.get(id),
        list: (kind) => records.list(kind),
        history: (filter) => records.history(filter),
        recordDecision: (decision, options) => knowledge.recordDecision(decision, options),
        defineTerm: (definition, options) => knowledge.defineTerm(definition, options),
        decision: (id) => knowledge.decision(id),
        frontCovers: (nodeId) => knowledge.frontCovers(nodeId),
        editNote: (id, fields, options) => knowledge.editNote(id, fields, options),
        retire: (id, reason, options) => records.retire(id, reason, options),
        inOneWrite: (work, options) => records.inOneWrite(work, options?.signal),
        changesSince: async (cursor) => {
          const entries = await records.history({ since: cursor });
          return { changes: entries.map(({ seq, recordId, type, action, record }) => ({ seq, recordId, type, action, record })), cursor: entries.at(-1)?.seq ?? cursor };
        },
        close,
      };
    },
    listProjects: () => server.listProjects(),
    snapshot: (name) => server.snapshot(name),
    ownDatabase: (name, options) => server.ownDatabase(name, options),
    close: () => server.close(),
  };
}
