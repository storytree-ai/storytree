# Test changes: the plan (increment_b87e6a0f2d97)

Changes beyond re-pointed imports, for the blind reviewer.

1. `plan/work-model.test.ts` (from `work/work-model.test.ts`, whole): the postgres backend's setup read the work model
   off the opened project (`project.work`). The rebuild's `connect` (`projects/open/index.js`) opens a project with
   `records`, `transactions` and `close` and no `work`, so the setup builds it as the memory backend does,
   `new WorkModel(project.records)`; cleanup still closes the server and drops the database. Every title and
   assertion is unchanged. The imports from the old `../references.js` (`DependencyLoopError`,
   `MissingReferenceError`) and `../schema/index.js` now come from `../storage/rules/index.js`, merged into one
   import line; `../transactions/index.js` is now `../storage/store/index.js`.
2. `plan/data-schema.test.ts` (from `schema/data-schema.test.ts`): only the tests of 3.11, 3.21, 3.22 and 3.14 are
   carried, in the frozen file's order, with the two backends, `MINIMAL` (and its `TableType`), `untyped` and
   `schemaError`, unchanged. The rest of the file is storage's (`storage/rules/data-schema.test.ts`) or the notes
   increment's (3.10, 3.12, 3.13, 3.19), so `FULL`, `EMPTIEST`, `TYPES`, `pick`, `STORY_V2`, `STORY_V3`,
   `VOICE_NOTE`, `VOICE_NOTE_V2`, `plugin`, `unknownType`, `newerVersion`, `missingUpgrade` and the imports only
   they used (`isDeepStrictEqual`, `z`, `withCountedProject`, `RecordEnvelope`, `MissingUpgradeError`,
   `NewerSchemaError`, `OWNER_TIME_ZONE`, `parseSchedule`, `pluginSchema`, `RECORD_SCHEMAS`, `SCHEMA_VERSIONS`,
   `UnknownTypeError`, `LibrarySchema`, `PluginRecordKind`, `RecordType`) are left out.
3. Each file's leading comment (`// Capability 4 · Work model`, `// Capability 3 · Data schema`) is dropped
   (ADR-1369), in all three files.
4. `api/library-api.test.ts`'s "4.9 · retiring a capability refuses live dependents without writing, then succeeds
   once their links are gone" is not copied here: it drives the front door's `Library` (`lib.retire`,
   `lib.changesSince`), so the front door increment carries it.
