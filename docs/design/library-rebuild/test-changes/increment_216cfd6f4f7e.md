# Test changes: shared library (increment_216cfd6f4f7e)

Changes beyond re-pointed imports, for the blind reviewer.

1. Nine files are copied whole from `project/` into `projects/shared/`, same names: `address-connection.test.ts`,
   `address-tls.test.ts`, `address-websocket.test.ts`, `connection-error.test.ts`, `local-authentication.test.ts`,
   `outside-writer.test.ts`, `reads.test.ts`, `server-connection.test.ts`, `shared-server.test.ts`. Every title, contract
   number and assertion is unchanged, in the same order. Each file's leading `// Capability N` comment is dropped
   (ADR-1369).
2. `projects/open/project-libraries.test.ts`: the 30.4 test ("30.4 a project opened with a plugin's kinds writes and
   reads them, ...") that the opening increment left out (its ledger, item 1) is put back, unchanged, at its frozen
   position: after the 29.6 test and before the 29.7 one. The file's titles now match the frozen file's, in order.
3. Merged import lines: the shared domain's names (`addressServer`, `connectionString`, `proxyFor`, `localServer`,
   `fenceOutsideWriter`, `fenceProject`, `OutsideWriter`, `ConnectionError`, `isUnreachable`, `LIBRARY_UNREACHABLE`,
   `outageSaidOnce`, `saysUnreachable`, `asReader`, `nameReader`, `scriptReader`, `takeReads`) come from the domain's one
   entry, `./index.js`, in one line per file. `address-tls.test.ts` imported from `./address.js` and
   `./connection-error.js`; `address-websocket.test.ts` from `./address.js`, `./connection-error.js` and `./websocket.js`;
   `local-authentication.test.ts` from `./connection-error.js` and `./server.js`. `connection-error.ts` moves from
   `projects/open` to `projects/shared` with this increment, so `ConnectionError` comes from the shared entry.
4. Re-pointed paths: `../testing/pg.js` is now `../../testing/pg.js`; `../transactions/index.js` (`PgTransactions`,
   `WRITE_LOCK`) is now `../../storage/store/index.js`; `../transactions/behaviour-suite.js` is now
   `../../storage/store/testing/behaviour-suite.js`, the storage increment's suite rewritten from the contracts, whose
   `transactionsBehaviourSuite(label, open)` is called as the frozen file calls it; `../knowledge/index.js`
   (`vectorServerIdentity`) is now `../../knowledge/search/index.js`; the old project entry `./index.js` (`connect`,
   `ConnectionError`, `ConnectionProblem`, `Project`, `Storytree`) in `outside-writer.test.ts` and
   `server-connection.test.ts` is now `../open/index.js`.
5. Package-name imports: `@storytree/library` in `address-connection.test.ts` and `shared-server.test.ts` is now the
   rebuild's front door, `../../index.js`; `@storytree/library/reads` in `reads.test.ts` is now `./index.js`, the shared
   entry, since no earlier lane re-pointed a package-name subpath. Both resolve to the old library by name otherwise,
   which is not a dependency of the rebuild.
6. Setup re-pointed in `address-tls.test.ts` and `address-websocket.test.ts`: the TLS fixtures were read from
   `../testing/tls`; they are not copied into the rebuild (the storage ledger, item 6: `pnpm gate`'s secret check
   exempts their private keys only at `packages/library/src/testing/tls/`), so both files read them from
   `packages/library/src/testing/tls/` by the path `../../../../library/src/testing/tls`. That path also reaches the
   same folder after integration moves this file to `packages/library/src/projects/shared/`, if the fixtures stay
   there; integration may shorten it to `../../testing/tls`.
7. Setup re-pointed in `address-tls.test.ts`'s last 15.4 test, which runs the file again under Electron: its working
   folder was `../..` from the file, the old package's root; the file now sits one folder deeper, so it is `../../..`,
   the rebuild package's root (where its `tsx` and `electron` resolve).
8. Not carried here: `project/ci-health.test.ts` (28.16 twice) and `project/cloud-session.test.ts` (30.6, 30.7). They
   drive the front door's whole Library (`recordVerified`, health), decisions numbering (`Knowledge.recordDecision`
   with a floor) and the health domain, none of which is built yet. The front door increment (increment_b683392d4147)
   carries them, copied from the frozen files, as it carries `api/snapshot.test.ts` and `api/writer.test.ts`.
9. No `testing/` file was changed or copied: `testing/pg.ts` (storage's copy) already offers every helper these tests
   use (`createTestRole`, `dropTestDatabases`, `dropTestRoles`, `testRoleUrl`, `testServerUrl`, `uniqueProjectName`,
   `withTestClient`, `withTestClientAs`, `withCountedProject`).
10. The 30.4 test passes on arrival: the opening increment's project already opens with a plugin's kinds. It was not
    seen red; every other copied test was.
