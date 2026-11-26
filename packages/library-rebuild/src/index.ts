// Capability 2 · Library transactions
import type { Pool } from "pg";

import type { WorkModel } from "./plan/index.js";
import { connect as connectServer, type ConnectOptions, type OwnDatabaseOptions, type ProjectSnapshot } from "./projects/open/index.js";
import type { HistoryEntry, HistoryFilter } from "./storage/store/index.js";
import type { RecordType, SchemaRecord } from "./storage/rules/index.js";

export { MissingUpgradeError, NewerSchemaError, pluginSchema, SchemaError, UnknownTypeError } from "./storage/rules/index.js";
export type { FieldsOf, PluginRecordKind, PluginUpgradeStep, RecordType, SchemaRecord, WriteOptions } from "./storage/rules/index.js";
export type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./storage/store/index.js";
export type { ConnectOptions, ProjectSnapshot } from "./projects/open/index.js";
export { ConnectionError, connectionString } from "./projects/shared/index.js";

export interface Library extends Pick<WorkModel, "addStory" | "projectTree"> {
  readonly name: string;
  get(id: string): Promise<SchemaRecord | null>;
  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
  history(filter?: HistoryFilter): Promise<HistoryEntry[]>;
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
      const { records, work, close } = await server.openProject(name);
      return {
        name,
        addStory: (story, options) => work.addStory(story, options),
        projectTree: () => work.projectTree(),
        get: (id) => records.get(id),
        list: (kind) => records.list(kind),
        history: (filter) => records.history(filter),
        close,
      };
    },
    listProjects: () => server.listProjects(),
    snapshot: (name) => server.snapshot(name),
    ownDatabase: (name, options) => server.ownDatabase(name, options),
    close: () => server.close(),
  };
}
