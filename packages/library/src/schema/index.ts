// Capability 3 · Data schema
export { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError } from "./errors.js";
export type { FieldProblem } from "./errors.js";
export { SchemaRecords, unstorable } from "./records.js";
export { isPluginKind, pluginSchema } from "./plugin-kinds.js";
export type { PluginRecordKind, PluginUpgradeStep } from "./plugin-kinds.js";
export type { CreateOptions, FieldEdit, SchemaRecord, WriteOptions } from "./records.js";
export { CONTRACT_PROOFS, FRESHNESS, FRICTION_STATES, INCREMENT_STATUSES, judgedState, PIN_ICONS, PIN_LABEL_LIMIT, RECORD_SCHEMAS, SCHEMA_VERSIONS, STORE_LINK_DIRECTIONS, VERDICTS } from "./types.js";
export type { FieldsOf, FrictionState, KnowledgeKind, LibrarySchema, RecordType, UpgradeStep } from "./types.js";
export { LIBRARY_SCHEMA, UPGRADES } from "./upgrades.js";
export { isTimeZone, OWNER_TIME_ZONE, parseSchedule, PRECHECKS } from "./schedule.js";
export type { Precheck, ScheduleRule } from "./schedule.js";
export { NEW_LINE } from "./activity-line.js";
export type { Agent, Line, LineKind, LinesSince, NewLine } from "./activity-line.js";
export type { CodeEdge, EdgeFile, FileImport, PartClash, SharedStore, StoreTable, StorySurvey, SurveyedFile, SurveyedPart, SurveyedParts, SurveyedTest } from "./story-survey.js";
