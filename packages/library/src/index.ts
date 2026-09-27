// @storytree/library: the project library every later storytree story reads and writes, and the
// only way to reach it (capability 7 · Library API, stories/library.md). At run time this entry
// exports connect() and the errors a caller may need to catch by class. Everything else it exports
// is a type, and none of them reaches a connection pool, a store or a table. The package exports
// nothing but this entry, so the internals behind it cannot be imported at all.
export { connect } from "./api/index.js";
export type { Change, Changes, Library, Storytree } from "./api/index.js";
export type { CloudSqlConfig, ConnectionProblem, ConnectOptions, ProjectSnapshot, SnapshotEvent, SnapshotRecord } from "./project/index.js";

export { ConnectionError, ProjectNameError, RestoreRefusedError } from "./project/index.js";
export { LinkLoopError, SupersessionLoopError } from "./knowledge/index.js";
export { DependencyLoopError, MissingReferenceError } from "./references.js";
export { NumberTakenError } from "./transactions/index.js";
export { LifecycleError, RetireRefusedError, WaitLoopError } from "./work/index.js";
export { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError } from "./schema/index.js";

export type { FieldsOf, KnowledgeKind, RecordType, SchemaRecord, WriteOptions } from "./schema/index.js";
export type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./transactions/index.js";
export type {
  ArcEdit,
  ArcNode,
  ArcState,
  ArcView,
  CapabilityEdit,
  CloseInput,
  ContractEdit,
  Disposition,
  Hold,
  NewQuestion,
  Settlement,
  IncrementEdit,
  IncrementStatus,
  NewArc,
  NewCapability,
  NewContract,
  NewIncrement,
  NewStory,
  StoryEdit,
} from "./work/index.js";
export type {
  AnnotatedCapability,
  AnnotatedContract,
  AnnotatedStory,
  AnnotatedTree,
  HealthColumn,
  HealthColumnName,
  HealthEntry,
  HealthOptions,
  HealthState,
  NodeHealth,
} from "./health/index.js";
export type { DecisionStatus, DecisionView, NewDecision, NewDefinition, NewKnowledge, NewMemory, Note, NoteEdit, NoteType } from "./knowledge/index.js";
