// Capability 7 · Library API. @storytree/library: the project library every later storytree story reads and writes, and the
// only way to reach it (capability 7 · Library API, the library story). At run time this entry
// exports connect(), the errors a caller may need to catch by class, the default connect limit and
// the one wording of its refusal (CONNECT_TIMEOUT_MS, explainConnectTimeout, ADR-1163 D1), the name a seed's
// connection carries while it writes (SEED_CONNECTION), and the schema an activity log line is
// checked against (NEW_LINE, ADR-1017 D3), and the one reader of a process's schedule (parseSchedule, OWNER_TIME_ZONE,
// ADR-1105 D1), so what works out what is due reads the words as they were validated, and the one reader of a plugin's
// declared record kinds (pluginSchema, ADR-1178 D3), so the plugin loader checks a manifest's as the library will. Everything else it exports
// is a type, and none of them reaches a connection pool, a store or a table, but for one: a
// connection's own database beside the projects (contract 7.7). The package exports
// nothing but this entry, so the internals behind it cannot be imported at all.
export { connect } from "./api/index.js";
export type { Change, Changes, FeedbackNote, FeedbackRoute, Library, PluginRecords, Storytree } from "./api/index.js";
export type { CloudSqlConfig, ConnectionProblem, ConnectOptions, FactoryLink, OpenOptions, OwnDatabaseOptions, ProjectSnapshot, SnapshotEvent, SnapshotRecord } from "./project/index.js";

export { CONNECT_TIMEOUT_MS, ConnectionError, connectionString, explainConnectTimeout, ProjectGoneError, ProjectNameError, RestoreRefusedError, SEED_CONNECTION } from "./project/index.js";
export { knowledgeGuidance, LinkLoopError, SupersessionLoopError } from "./knowledge/index.js";
export { DependencyLoopError, MissingReferenceError } from "./references.js";
export { NumberTakenError, StaleRevertError } from "./transactions/index.js";
export type { Counts, KindCount, RecentChange, TitleHit } from "./data/data-questions.js";
export { ANCHOR_ID, anchorGaps, beforeCutover, CONTRACT_DEFINITION, LifecycleError, LONG_CONTRACT_TITLE, planGuidance, pullSaid, RetireRefusedError, WaitLoopError } from "./work/index.js";
export { MissingUpgradeError, NewerSchemaError, NEW_LINE, OWNER_TIME_ZONE, parseSchedule, pluginSchema, SchemaError, UnknownTypeError } from "./schema/index.js";

export type { Agent, CodeEdge, EdgeFile, FieldsOf, FileImport, KnowledgeKind, Line, LineKind, LinesSince, NewLine, PluginRecordKind, PluginUpgradeStep, RecordType, ScheduleRule, SchemaRecord, StorySurvey, SurveyedFile, SurveyedTest, WriteOptions } from "./schema/index.js";
export type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./transactions/index.js";
export type {
  ArcEdit,
  ArcNode,
  ArcState,
  ArcView,
  BoardArcView,
  BoardIncrement,
  CapabilityEdit,
  CloseInput,
  DayWindow,
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
  Anchor,
  AnchorEdit,
  PrCutover,
  AnchorGaps,
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
