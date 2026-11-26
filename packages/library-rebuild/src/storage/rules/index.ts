// Capability 3 · Data schema
export { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError, type FieldProblem } from "./errors.js";
export { SchemaRecords, type CreateOptions, type EditOptions, type SchemaRecord, type WriteOptions } from "./records.js";
export { checkReferences, MissingReferenceError, type Reference } from "./references.js";
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
