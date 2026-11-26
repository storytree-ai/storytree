# Test changes: notes (increment_db0d57307978)

Changes beyond re-pointed imports, for the blind reviewer. Every copied title, contract number and assertion is
unchanged.

1. Copied into `knowledge/notes/`: `knowledge/knowledge-kinds.test.ts`, `knowledge/knowledge-memory.test.ts`,
   `knowledge/knowledge.test.ts`, `knowledge/related-unlinked.test.ts`, `knowledge/knowledge-entrances.test.ts` (but
   13.26, item 5) and `project/no-memory-type.test.ts` (moved from the project folder into notes, since its tests are
   6.8's and 6.9's), each whole under its own name; and the tests of 3.10, 3.12, 3.13 and 3.19 from
   `schema/data-schema.test.ts` into `knowledge/notes/data-schema.test.ts` (item 6).
2. The leading `// Capability …` line is dropped from `knowledge-kinds`, `knowledge-memory`, `knowledge`,
   `related-unlinked`, `knowledge-entrances` and `data-schema` (ADR-1369, no comments). `no-memory-type` had none.
3. Imports re-pointed to the domains' entries: `../project/index.js` and `./storytree.js` (in `no-memory-type`) to the
   opening domain's `../../projects/open/index.js`; `../schema/index.js` and `../references.js` to record rules'
   `../../storage/rules/index.js`; `../transactions/index.js` to the store's `../../storage/store/index.js`;
   `../testing/pg.js` to `../../testing/pg.js`. Where `../references.js` and `../schema/index.js` both named record
   rules, the two lines are merged into one (`knowledge-kinds`, `knowledge-memory`, `knowledge-entrances`), and the
   import lines are ordered by path.
4. Names that move domain with the notes' record kinds come from the notes entry, `./index.js`, not record rules:
   `type KnowledgeKind` (in `knowledge-kinds`, old `../schema/index.js`, now on the line importing `Knowledge`) and
   `OWNER_TIME_ZONE` and `parseSchedule` (in `data-schema`, old `./index.js` of the schema folder), because the process
   kind whose schedule they read is a note kind and the tree puts each domain's record kinds in that domain.
   `MissingReferenceError` comes from `../../storage/rules/index.js` (record rules' references).
5. `knowledge-entrances.test.ts`: its 13.26 test ("a front cover naming anything but a live story or capability is
   refused, and nothing is written") is left out, with the code only it used: the constants `NO_STORY` and
   `UNSTORABLE`, the helpers `missingCover` and `schemaError`, and the imports `SchemaError` and `type NewDefinition`.
   13.x belongs to the decisions increment (increment_46e203ea6642), which copies 13.26 with those helpers from the
   frozen file. The file has no unnumbered table test; its 9.1, 9.3 and 6.28 tests are kept whole.
6. `data-schema.test.ts` holds only 3.10, 3.12, 3.13 and 3.19 (storage carried the rest, plan carries 3.11, 3.14, 3.21
   and 3.22), each verbatim, inside the frozen file's own memory and postgres backend loop and `contract` helper. Left
   out, as only the other tests used them: the imports `isDeepStrictEqual`, `z`, `withCountedProject`,
   `type RecordEnvelope`, `MissingUpgradeError`, `NewerSchemaError`, `pluginSchema`, `RECORD_SCHEMAS`,
   `UnknownTypeError`, `type FieldsOf`, `type LibrarySchema`, `type PluginRecordKind` and `type RecordType`; the
   `TableType`, `MINIMAL`, `FULL`, `EMPTIEST` and `TYPES` fixtures; and the helpers `pick`, `plugin`, `unknownType`,
   `newerVersion`, `missingUpgrade` and the `STORY_V2`, `STORY_V3`, `VOICE_NOTE` and `VOICE_NOTE_V2` schemas. The two
   helpers these tests call, `untyped` and `schemaError`, are kept verbatim.
7. No test helper was added: `testing/pg.ts` (copied by storage) already has every helper these files use.
