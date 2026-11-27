// Capability 7 · Library API
import type { Pool } from "pg";

import { libraryOf, type Library } from "./library.js";
import type { FieldsOf, NewLine } from "./storage/rules/index.js";
import { connect as connectServer, type ConnectOptions, type OpenOptions, type OwnDatabaseOptions, type ProjectSnapshot } from "./projects/open/index.js";

export { NOT_VERIFIED, heldBack, wordAndWhy } from "./health/index.js";
export { SupersessionLoopError } from "./knowledge/decisions/index.js";
export { knowledgeGuidance, LinkLoopError, OWNER_TIME_ZONE, parseSchedule, referenceEdgesOf } from "./knowledge/notes/index.js";
export {
  ANCHOR_ID,
  anchorGaps,
  beforeCutover,
  CONTRACT_DEFINITION,
  CONTRACT_PLACEMENT,
  CONTRACT_PROOFS,
  LONG_CONTRACT_TITLE,
  planGuidance,
  pullSaid,
  STORE_LINK_DIRECTIONS,
} from "./plan/index.js";
export { ProjectGoneError, ProjectNameError, RestoreRefusedError } from "./projects/open/index.js";
export { CONNECT_TIMEOUT_MS, ConnectionError, connectionString, explainConnectTimeout } from "./projects/shared/index.js";
export {
  DependencyLoopError,
  MissingReferenceError,
  MissingUpgradeError,
  NEW_LINE,
  NewerSchemaError,
  pluginSchema,
  SchemaError,
  UnknownTypeError,
} from "./storage/rules/index.js";
export { NumberTakenError, SEED_CONNECTION } from "./storage/store/index.js";
export { LifecycleError, listedNotice, listedSaid, WaitLoopError } from "./work/arcs/index.js";
export { RetireRefusedError } from "./work/inbox/index.js";

export type { AttachedMedia, MediaEntry, MediaFile, NewMedia } from "./commands/index.js";
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
export type { ClauseSupersession, DecisionNumberPlan, DecisionStatus, DecisionView, NewDecision } from "./knowledge/decisions/index.js";
export type { KnowledgeKind, NewDefinition, NewKnowledge, Note, NoteEdit, NoteType, Precheck, Related, RelatedHit, RelatedOptions, ScheduleRule } from "./knowledge/notes/index.js";
export type { Change, Changes, ChangesFilter, Counts, DormantKind, FyiNote, KindCount, Library, PluginRecords, RecentChange, TitleHit } from "./library.js";
export type { NarrowingDecision, PhraseKind, PhraseOptions, PhrasePage, Ranked, RankOptions } from "./knowledge/search/index.js";
export type {
  Anchor,
  AnchorEdit,
  AnchorGaps,
  ArcNode,
  CapabilityEdit,
  CodeEdge,
  ContractEdit,
  ContractWriteOptions,
  EdgeEdit,
  EdgeFile,
  EdgeNode,
  FileImport,
  ImportedPluginPlan,
  MappedPackage,
  MappedStories,
  MovedToEdges,
  NewCapability,
  NewContract,
  NewEdge,
  NewStory,
  PartClash,
  PinNote,
  PluginPlan,
  PluginPlanCapability,
  PluginPlanHeld,
  PrCutover,
  SharedStore,
  StoreLink,
  StoreTable,
  StoryEdit,
  StorySurvey,
  SurveyedFile,
  SurveyedPart,
  SurveyedParts,
  SurveyedTest,
} from "./plan/index.js";
export type { ConnectOptions, ConnectionProblem, FactoryLink, OpenOptions, OwnDatabaseOptions, ProjectSnapshot, Reached, SnapshotEvent, SnapshotMedia, SnapshotRecord } from "./projects/open/index.js";
export type { FieldsOf, Line, LineKind, LinesSince, NewLine, PluginRecordKind, PluginUpgradeStep, RecordType, SchemaRecord, WriteOptions } from "./storage/rules/index.js";
export type { HistoryEntry, HistoryFilter, RecordEnvelope } from "./storage/store/index.js";
export type {
  ArcEdit,
  ArcState,
  ArcView,
  BoardArcView,
  BoardIncrement,
  CloseInput,
  DayWindow,
  Disposition,
  Hold,
  Holds,
  IncrementEdit,
  IncrementStatus,
  NewArc,
  NewIncrement,
  NoteWait,
  OpenListing,
  ParkedOn,
  Pended,
  PlanChange,
  WaitFor,
} from "./work/arcs/index.js";
export type { FeedbackNote, FeedbackRoute, NewQuestion, QuestionLease, Settlement } from "./work/inbox/index.js";

export type Agent = Extract<NewLine, { kind: "tool-requested" }>["agent"];

export type PendingChange = NonNullable<FieldsOf<"increment">["pending"]>[number];

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

export async function connect(options: ConnectOptions): Promise<Storytree> {
  const server = await connectServer(options);
  return {
    openProject: async (name, open = {}) => libraryOf(await server.openProject(name, open), open.kinds),
    listProjects: () => server.listProjects(),
    projectIdentities: () => server.projectIdentities(),
    snapshot: (name) => server.snapshot(name),
    restore: (name, snapshot) => server.restore(name, snapshot),
    dropProject: (name) => server.dropProject(name),
    ownDatabase: (name, own) => server.ownDatabase(name, own),
    close: () => server.close(),
  };
}
