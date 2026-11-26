// Capability 2 · Library transactions
import type { Knowledge } from "./knowledge/decisions/index.js";
import { WorkModel } from "./plan/index.js";
import { connect as connectServer, type ConnectOptions, type ProjectSnapshot } from "./projects/open/index.js";
import type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./storage/store/index.js";
import type { RecordType, SchemaRecord, WriteOptions } from "./storage/rules/index.js";

export { MissingUpgradeError, NewerSchemaError, pluginSchema, SchemaError, UnknownTypeError } from "./storage/rules/index.js";
export type { FieldsOf, PluginRecordKind, PluginUpgradeStep, RecordType, SchemaRecord, WriteOptions } from "./storage/rules/index.js";
export type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./storage/store/index.js";
export type { ConnectOptions, ProjectSnapshot } from "./projects/open/index.js";

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

export interface Library extends Pick<WorkModel, "addStory" | "addCapability">, Pick<Knowledge, "recordDecision" | "defineTerm" | "decision" | "frontCovers" | "editNote"> {
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
  snapshot(name: string): Promise<ProjectSnapshot>;
  close(): Promise<void>;
}

export async function connect(options: ConnectOptions): Promise<Storytree> {
  const server = await connectServer(options);
  return {
    async openProject(name) {
      const { records, knowledge, close } = await server.openProject(name);
      const plan = new WorkModel(records);
      return {
        name,
        get: (id) => records.get(id),
        list: (kind) => records.list(kind),
        history: (filter) => records.history(filter),
        addStory: (story, options) => plan.addStory(story, options),
        addCapability: (capability, options) => plan.addCapability(capability, options),
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
    snapshot: (name) => server.snapshot(name),
    close: () => server.close(),
  };
}
