// Capability 2 · Library transactions
import { connect as connectServer, type ConnectOptions, type ProjectSnapshot } from "./projects/open/index.js";
import type { HistoryEntry, HistoryFilter } from "./storage/store/index.js";
import type { RecordType, SchemaRecord } from "./storage/rules/index.js";

export { MissingUpgradeError, NewerSchemaError, pluginSchema, SchemaError, UnknownTypeError } from "./storage/rules/index.js";
export type { FieldsOf, PluginRecordKind, PluginUpgradeStep, RecordType, SchemaRecord, WriteOptions } from "./storage/rules/index.js";
export type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./storage/store/index.js";
export type { ConnectOptions, ProjectSnapshot } from "./projects/open/index.js";

export interface Library {
  readonly name: string;
  get(id: string): Promise<SchemaRecord | null>;
  list<K extends RecordType>(kind: K): Promise<SchemaRecord<K>[]>;
  history(filter?: HistoryFilter): Promise<HistoryEntry[]>;
  close(): Promise<void>;
}

export interface Storytree {
  openProject(name: string): Promise<Library>;
  snapshot(name: string): Promise<ProjectSnapshot>;
  close(): Promise<void>;
}

export async function connect(options: ConnectOptions): Promise<Storytree> {
  const server = await connectServer(options);
  return {
    async openProject(name) {
      const { records, close } = await server.openProject(name);
      return {
        name,
        get: (id) => records.get(id),
        list: (kind) => records.list(kind),
        history: (filter) => records.history(filter),
        close,
      };
    },
    snapshot: (name) => server.snapshot(name),
    close: () => server.close(),
  };
}
