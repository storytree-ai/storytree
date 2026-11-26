// Capability 3 · Record rules
import { withPluginKinds, type LibrarySchema, type PluginRecordKind } from "../records/index.js";
import { LIBRARY_SCHEMA } from "./upgrades.js";

export { FRICTION_STATES, INCREMENT_STATUSES, judgedState, RECORD_SCHEMAS, SCHEMA_VERSIONS, VERDICTS } from "./types.js";
export type { FrictionState, KnowledgeKind } from "./types.js";
export { LIBRARY_SCHEMA, UPGRADES } from "./upgrades.js";

export function pluginSchema(kinds: readonly PluginRecordKind[], base: LibrarySchema = LIBRARY_SCHEMA): LibrarySchema {
  return withPluginKinds(base, kinds);
}
