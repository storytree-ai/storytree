// Capability 34 · Projects
export { connectionString, PASSWORD_KEY } from "./shared/address.js";
export { ConnectionError } from "./shared/connection-error.js";
export { InheritedRecords } from "./open/factory.js";
export type { FactoryLink, Reached } from "./open/factory.js";
export { SEED_CONNECTION } from "../records/index.js";
export type { ConnectionProblem } from "./shared/connection-error.js";
export { ProjectGoneError, ProjectNameError } from "./open/names.js";
export { fenceOutsideWriter } from "./shared/outside-writer.js";
export type { OutsideWriter } from "./shared/outside-writer.js";
export { RestoreRefusedError } from "./open/snapshot.js";
export { CONNECT_TIMEOUT_MS, explainConnectTimeout } from "./shared/server.js";
export type { ProjectSnapshot, SnapshotEmbedding, SnapshotEvent, SnapshotMedia, SnapshotRecord } from "./open/snapshot.js";
export { connect } from "./open/storytree.js";
export { LIBRARY_SCHEMA, pluginSchema, RECORD_SCHEMAS, SCHEMA_VERSIONS } from "./open/record-schemas.js";
export { UPGRADES } from "./open/upgrades.js";
export type { ConnectOptions, OpenOptions, OwnDatabaseOptions, Project, Storytree } from "./open/storytree.js";
