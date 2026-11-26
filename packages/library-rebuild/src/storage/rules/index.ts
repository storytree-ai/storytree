// Capability 3 · Data schema
export { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError, type FieldProblem } from "./errors.js";
export { SchemaRecords, type CreateOptions, type SchemaRecord, type WriteOptions } from "./records.js";
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
