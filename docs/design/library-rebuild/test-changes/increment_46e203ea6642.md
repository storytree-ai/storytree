# Test changes: decisions (increment_46e203ea6642)

Changes beyond re-pointed imports, for the blind reviewer. Every copied title, contract number and assertion is
unchanged.

1. Copied into `knowledge/decisions/`, each whole under its own name: `decisions/decision-log.test.ts` (13.1–13.9,
   13.11, 13.15, 13.18, 13.19), `decisions/decisions.test.ts` (31.1) and `decisions/corrections.test.ts` (22.2,
   22.3); and, in part, `decisions/supersede.test.ts` (item 5) and `knowledge/knowledge-entrances.test.ts`'s 13.26
   test (item 6).
2. The leading `// Capability …` line is dropped from all five files (ADR-1369, no comments).
3. Imports re-pointed: `../project/index.js` to the opening domain's `../../projects/open/index.js`;
   `../schema/index.js` and `../references.js` to record rules' `../../storage/rules/index.js` (merged into one line
   in `knowledge-entrances`); `../transactions/index.js` to the store's `../../storage/store/index.js`;
   `../testing/pg.js` to `../../testing/pg.js`; `../index.js` (the `Library` type) to the package root,
   `../../index.js`; `../knowledge/index.js` (in `decision-log`) to the decisions entry, `./index.js`, since the
   decisions domain offers the decision log's `Knowledge` and `SupersessionLoopError`. Import lines are ordered by
   path.
4. `decision-log.test.ts`:
   - `byCreation` (old `../creation-order.js`) is exported nowhere in the rebuild and named in no interface bundle,
     so it is imported from the decisions entry, `./index.js`, on the line importing `Knowledge` (13.9 sorts the
     expected decisions by it).
   - `NumberTakenError` keeps its old home's mapping, the store's `../../storage/store/index.js` (the root bundle
     `interface/index.d.ts` declares it).
   - The postgres backend's setup read the decision log off each opened project (`project.knowledge`,
     `again.knowledge`). It now builds both as the memory backend does, `new Knowledge(project.records)` and
     `new Knowledge(again.records)`, with `Knowledge` from the decisions entry: the rebuild's opened project offers
     the notes domain's `Knowledge`, not the decision log's. The two connections, the cleanup and every test are
     unchanged.
   - The file's unnumbered `contract` template (the backend loop) is kept verbatim.
5. `supersede.test.ts`: only the three 13.12 tests that use no tool ("supersede records an accepted successor…",
   "an existing successor keeps its own shelf…", "existing supersession refuses invalid decisions…") and the 13.13
   "a supersede that fails part-way…" test are carried, in the frozen file's order, with the `shelf` and `textsOf`
   helpers verbatim. Left out:
   - 13.12 "supersede accepts an existing successor through the tool, preserving its history and links without
     making a duplicate": it drives `librarianTools()`, so the librarian increment (increment_e78e1099730d) carries
     it.
   - 13.13 "a decision superseded by `adr new --supersedes` leaves `adr list --load-bearing`…", 13.13 "a decision
     superseded through `library new`, `library edit` or `adr push` leaves `adr list --load-bearing`…" and 13.14 "a
     new decision written proposed, through `adr new` or `library new decision`, is refused…": they drive
     `ADR_FAMILY` and `LIBRARY_FAMILIES` verbs through the command kit (`DoorWords`, `VerbContext`,
     `LibraryVerbContext`), so the commands increment (increment_53ff8e067dfa) carries them.
   - The imports only those tests used: `mkdtempSync`, `readFileSync`, `writeFileSync`, `tmpdir`, `path`,
     `LIBRARY_FAMILIES`, `type LibraryVerbContext`, `type DoorWords`, `type VerbContext`, `librarianTools`,
     `type ToolAnswer`, `type ToolCall` and `ADR_FAMILY`.
6. `knowledge-entrances.test.ts` (new, in `knowledge/decisions/`): the frozen file's 13.26 test ("a front cover naming
   anything but a live story or capability is refused, and nothing is written"), which the notes increment left for
   this one (its ledger, item 5), inside the frozen file's own memory and postgres backend loop and `contract`
   helper, verbatim. It keeps the constants `NO_STORY` and `UNSTORABLE` and the helpers `missingCover`,
   `schemaError` and `assertCreated` (13.26 checks its story cover with it), each verbatim, and the imports they
   use. `Knowledge` and `NewDefinition` come from the decisions entry, `./index.js`. Left out, as only the notes
   increment's tests (9.1, 9.3, 6.28, carried by it) used them: `waitUntil`, `NO_CAPABILITY`, `linkLoop`,
   `linkToWork`, `clockPast`, `createInOrder`, `inIdOrder` and `at`. The postgres backend builds its `Knowledge` from
   `project.records`, as in item 4 and for the same reason.
7. Not copied: `decisions/adr.test.ts`, all twelve tests (13.10, 13.11, 13.16, 13.17, 13.20–13.25, 13.27, 13.28).
   Every one drives `ADR_FAMILY` verbs through the command kit (`VerbRefusal`, `DoorWords`, `VerbContext` from
   `verbs/verb.js`) and `LIBRARY_FAMILIES`, which the commands increment (increment_53ff8e067dfa) builds; it carries
   the file, and builds the `adr` family and the decision-log readings only it drives (`moveNarrowsToClauses`,
   `supersessionPairs`, `decisionLinkBacklog`, `decisionLinkChanges`, prune and restore) into `knowledge/decisions/`.
   13.11 is still carried here by `decision-log.test.ts`'s own 13.11 test.
8. No test helper was added: `testing/pg.ts` (copied by storage) already offers `withLibrary` and every other helper
   these files use. The tests that drive `withLibrary` (31.1, 22.2, 22.3, the four from `supersede.test.ts`) need the
   front door's `Library` to offer the methods they call; this increment grows it by those methods alone, delegating
   to the domains, and the front door increment (increment_b683392d4147) composes the rest.
