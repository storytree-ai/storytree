// Capability 3 · Data schema
export { NEW_LINE, type Line, type LineKind, type LinesSince, type NewLine } from "./activity-line.js";
export { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError, type FieldProblem } from "./errors.js";
export { checkReferences, DependencyLoopError, findLoop, liveOf, liveRecord, MissingReferenceError, referTo, type Reference } from "./references.js";
export { SchemaRecords, unstorable, type CreateOptions, type EditOptions, type SchemaRecord, type WriteOptions } from "./records.js";
export {
  LIBRARY_SCHEMA,
  pluginSchema,
  RECORD_SCHEMAS,
  SCHEMA_VERSIONS,
  type FieldsOf,
  type LibrarySchema,
  type PluginRecordKind,
  type PluginUpgradeStep,
  type RecordType,
  type UpgradeStep,
} from "./schema.js";
