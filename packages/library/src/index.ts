// Capability 7 · Library API. @storytree/library: the project library every later storytree story reads and writes, and the
// only way to reach it (capability 7 · Library API, the library story). At run time this entry
// exports connect(), the errors a caller may need to catch by class, the name a seed's
// connection carries while it writes (SEED_CONNECTION), and the schema an activity log line is
// checked against (NEW_LINE, ADR-1017 D3). Everything else it exports
// is a type, and none of them reaches a connection pool, a store or a table, but for one: a
// connection's own database beside the projects (contract 7.7). The package exports
// nothing but this entry, so the internals behind it cannot be imported at all.
export { connect } from "./api/index.js";
export type { Change, Changes, Library, Storytree } from "./api/index.js";
export type { CloudSqlConfig, ConnectionProblem, ConnectOptions, FactoryLink, OpenOptions, OwnDatabaseOptions, ProjectSnapshot, SnapshotEvent, SnapshotRecord } from "./project/index.js";

export { ConnectionError, ProjectGoneError, ProjectNameError, RestoreRefusedError, SEED_CONNECTION } from "./project/index.js";
export { knowledgeGuidance, LinkLoopError, SupersessionLoopError } from "./knowledge/index.js";
export { DependencyLoopError, MissingReferenceError } from "./references.js";
export { NumberTakenError } from "./transactions/index.js";
export { CONTRACT_DEFINITION, LifecycleError, LONG_CONTRACT_TITLE, planGuidance, RetireRefusedError, WaitLoopError } from "./work/index.js";
export { MissingUpgradeError, NewerSchemaError, NEW_LINE, SchemaError, UnknownTypeError } from "./schema/index.js";

export type { Agent, CodeEdge, EdgeFile, FieldsOf, FileImport, KnowledgeKind, Line, LineKind, LinesSince, NewLine, RecordType, SchemaRecord, StorySurvey, SurveyedFile, SurveyedTest, WriteOptions } from "./schema/index.js";
export type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./transactions/index.js";
export type {
  ArcEdit,
  ArcNode,
  ArcState,
  ArcView,
  CapabilityEdit,
  CloseInput,
  ContractEdit,
  ContractWriteOptions,
  Disposition,
  Hold,
  Holds,
  NewQuestion,
  NoteWait,
  WaitFor,
  QuestionLease,
  Settlement,
  IncrementEdit,
  IncrementStatus,
  NewArc,
  ParkedOn,
  NewCapability,
  NewContract,
  NewIncrement,
  MappedPackage,
  MappedStories,
  NewStory,
  Pended,
  PendingChange,
  PlanChange,
  StoryEdit,
} from "./work/index.js";
export type {
  AnnotatedCapability,
  AnnotatedContract,
  AnnotatedStory,
  AnnotatedTree,
  CapabilityStatus,
  CapabilityWhy,
  HealthWorkItem,
  ChangedOnMain,
  NamedOnMain,
  PendingRun,
  EarlierVerdict,
  HealthColumn,
  HealthColumnName,
  HealthEntry,
  HealthOptions,
  HealthReason,
  HealthState,
  NodeHealth,
  SkipKind,
} from "./health/index.js";
export { heldBack, NOT_VERIFIED, wordAndWhy } from "./health/index.js";
export type { DecisionNumberPlan, DecisionStatus, DecisionView, NewDecision, NewDefinition, NewKnowledge, Note, NoteEdit, NoteType, PhraseKind, PhraseOptions, PhrasePage, Ranked, RankOptions, Related, RelatedHit, RelatedOptions } from "./knowledge/index.js";
