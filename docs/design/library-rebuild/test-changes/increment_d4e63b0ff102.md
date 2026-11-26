# Test changes: work › owner's inbox (increment_d4e63b0ff102)

Changes beyond re-pointed imports, for the blind reviewer. Every title, contract number and assertion is unchanged.

1. `work/inbox/owner-questions.test.ts` (from `work/owner-questions.test.ts`): only the import block changed.
   `Knowledge` comes from `../../knowledge/notes/index.js`; `connect` from `../../projects/open/index.js`;
   `MissingReferenceError`, `SchemaError` and `SchemaRecords` from `../../storage/rules/index.js` (one line where
   there were two); `dropTestDatabases`, `testServerUrl`, `uniqueProjectName` from `../../testing/pg.js`;
   `MemoryTransactions` and `Transactions` from `../../storage/store/index.js`; the old `./index.js` line is three:
   `WorkModel` from `../../plan/index.js`, `WorkInFlight` from `../arcs/index.js`, `RetireRefusedError` from the
   inbox entry `./index.js`. Its postgres backend reads `work` and `flight` off the opened project unchanged:
   the rebuild's opened project now carries a `WorkInFlight`.
2. `work/question-seal.test.ts` (12.14) is not copied here: it drives the library family's `read` verb and the
   `open` note tool through the command kit, which the commands increment (increment_53ff8e067dfa) builds. It is
   handed there on that increment's body, to be copied into `work/inbox/`.
