# Test changes: the librarian and Rounds (increment_e78e1099730d)

Changes beyond re-pointed imports, for the blind reviewer. Every copied title, contract number and assertion is
unchanged.

1. Copied, each whole under its own name: `librarian/librarian.test.ts` (35.1) to `knowledge/librarian/librarian.test.ts`;
   `librarian/links/links.test.ts` (21.1–21.5), `librarian/catalogue/catalogue.test.ts` (23.1–23.3) and
   `librarian/graduation/graduation.test.ts` (24.1–24.4) to `knowledge/librarian/links.test.ts`, `catalogue.test.ts`
   and `graduation.test.ts`, flattened into the librarian's folder, because the tree folds Links, Catalogue and
   Graduation into the librarian (`tree.json`, node `r1-know-librarian`: each old entry exported every name behind it,
   so its boundary failed the deletion test); `librarian/rounds/rounds.test.ts` (26.1, 26.2, 26.5–26.10, 26.12) to
   `knowledge/librarian/rounds/rounds.test.ts`, Rounds staying a nested part (`r1-know-rounds`). And, in part,
   `decisions/supersede.test.ts`'s one tool test to `knowledge/librarian/supersede.test.ts` (item 6).
2. The leading `// Capability …` line is dropped from all six files (ADR-1369, no comments).
3. Imports re-pointed in the flattened files: `../testing/pg.js` (the librarian's test helper) to `./testing/pg.js`;
   `./index.js` (each old sub-entry: links, catalogue, graduation) stays `./index.js`, now the librarian's entry;
   `../../index.js` (the `Library` and `SchemaRecord` types, in `links`) is unchanged and is the package root.
   - `links.test.ts`: `worklist`, from `../rounds/index.js`, comes from the librarian entry, `./index.js`, which
     declares it (`interface/librarian.d.ts`); the two lines importing from `./index.js` are merged into one,
     `brokenEdges, link, unrestedDecisions, worklist`.
   - `catalogue.test.ts`: `../rounds/rounds.js` to `./rounds/rounds.js`, since `worklistView` is in no interface
     bundle and the rounds test imports it from that same module.
4. `rounds/rounds.test.ts`: `../../testing/pg.js` (the shared helper) to `../../../testing/pg.js`, one folder deeper.
   `../testing/pg.js`, `../index.js` (the librarian entry), `./host.js`, `./rounds.js` and `./tools.js` keep their
   text, the folders keeping their relative places.
5. `rounds/rounds.test.ts`, 26.5: the URL of the subagent definition, `../../../../../.claude/agents/librarian-curator.md`,
   gains one `../` (`../../../../../../.claude/agents/librarian-curator.md`) so it still reaches the repository's
   `.claude/agents/librarian-curator.md` from the file's new depth; after integration moves `library-rebuild/src` to
   `library/src`, the depth is the same. The assertions are unchanged.
6. `supersede.test.ts` (new, in `knowledge/librarian/`): only the frozen file's 13.12 test "supersede accepts an existing
   successor through the tool, preserving its history and links without making a duplicate", which the decisions
   increment left for this one (its ledger, item 5), with the helpers `shelf` and `textsOf` verbatim (the test uses
   both). Its imports: `assert`, `test`, `type Library` from the package root `../../index.js`, `withLibrary` from the
   shared helper `../../testing/pg.js` (as in the frozen file, not the librarian's), and `librarianTools`,
   `type ToolAnswer` and `type ToolCall` from the librarian entry, `./index.js` (old `../librarian/index.js`). Left out,
   as only the other tests (carried by the decisions and commands increments) used them: `mkdtempSync`, `readFileSync`,
   `writeFileSync`, `tmpdir`, `path`, `LIBRARY_FAMILIES`, `type LibraryVerbContext`, `type DoorWords`,
   `type VerbContext`, `ADR_FAMILY` and `supersede`.
7. No test helper was added: `knowledge/librarian/testing/pg.ts` and `testing/pg.ts` (copied by storage) offer every
   helper these files use (`withLibrary`, `withCountedLibrary`, `healthHistory`, `withTestClient`).

## Modules and what each must export, for the builder

| Module | Names the tests import | From |
|---|---|---|
| `knowledge/librarian/index.ts` (the `./librarian` export path) | `LibrarianRefusal`, `link`, `retire` | librarian.test.ts |
| | `brokenEdges`, `link`, `unrestedDecisions`, `worklist` | links.test.ts |
| | `newNotes`, `retire` | catalogue.test.ts |
| | `graduate`, `memoryWorklist`, `park`, `processGaps` | graduation.test.ts |
| | `roundDue`, `worklist` | rounds/rounds.test.ts |
| | `librarianTools`, `type ToolAnswer`, `type ToolCall` | supersede.test.ts |
| `knowledge/librarian/rounds/rounds.ts` | `worklist`, `worklistView`, `type WorklistView` | catalogue.test.ts, rounds/rounds.test.ts |
| `knowledge/librarian/rounds/host.ts` | `type ToolAnswer`, `type ToolCall` | rounds/rounds.test.ts |
| `knowledge/librarian/rounds/tools.ts` | `librarianTools` | rounds/rounds.test.ts |

The entry must also offer every other name `interface/librarian.d.ts` declares (`librarianToolParts`, `CURATED`,
`PARK_DAYS`, `claudeCodeMemoryFolder`, `relatedUnlinked` and the types), and the rebuild's `package.json` gains the
`./librarian` export key pointing at `./src/knowledge/librarian/index.ts`. The tests also call `Library` methods through
the front door (`packages/library-rebuild/src/index.ts`).
