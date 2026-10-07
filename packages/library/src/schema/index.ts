/** Capability 3 · Data schema. */
export { MissingUpgradeError, NewerSchemaError, SchemaError, UnknownTypeError } from "./errors.js";
export type { FieldProblem } from "./errors.js";
export { SchemaRecords } from "./records.js";
export type { CreateOptions, FieldEdit, SchemaRecord, WriteOptions } from "./records.js";
export { RECORD_SCHEMAS, SCHEMA_VERSIONS } from "./types.js";
export type { FieldsOf, KnowledgeKind, LibrarySchema, RecordType, UpgradeStep } from "./types.js";
export { LIBRARY_SCHEMA, UPGRADES } from "./upgrades.js";
