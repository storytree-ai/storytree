# Test changes: front door (increment_b683392d4147)

Changes beyond re-pointed imports, for the blind reviewer. Every title, contract number and assertion is unchanged,
and every file's tests are in their frozen order.

1. Files carried whole: `api/library-api.test.ts`, `api/own-database.test.ts`, `api/printable.test.ts`,
   `api/public-reads.test.ts`, `api/snapshot.test.ts` and `api/writer.test.ts` to the package root (`src/`), since the
   front door is `src/index.ts`; `project/ci-health.test.ts` and `project/cloud-session.test.ts` to `projects/shared/`
   (capabilities 28 and 30 live there; the shared ledger, item 8, left them to this increment). The leading comment of
   `library-api.test.ts`, `own-database.test.ts`, `printable.test.ts` (`// Capability 7 · Library API`),
   `snapshot.test.ts` (`// Capability 1 · Project libraries`), `ci-health.test.ts` (`// Capability 28 · Shared server`)
   and `cloud-session.test.ts` (`// Capability 30 · Outside writers`) is dropped (ADR-1369); `public-reads.test.ts` and
   `writer.test.ts` had none. The `// @ts-expect-error …` lines of `library-api.test.ts` are kept: they are the
   assertion that those types are not exported.
2. Package-name imports: `@storytree/library` is now `@storytree/library-rebuild` (the package's own name, which
   resolves to `src/index.ts` through its exports map), not the relative `./index.js`, in `library-api.test.ts` (its
   nine static imports and 7.3's `import("@storytree/library")`), `own-database.test.ts`, `public-reads.test.ts`,
   `writer.test.ts`, `ci-health.test.ts` and `cloud-session.test.ts`. 7.3 must import through the package to prove
   what its exports map lets out, and integration's rename back to `@storytree/library` gives back the frozen text.
   `printable.test.ts`'s `@storytree/library/printable` is now `@storytree/library-rebuild/printable`, the export key
   the builder adds (target `src/printable.ts`). `snapshot.test.ts` already imported the entry relatively
   (`../index.js`), now `./index.js`.
3. 7.3's internal paths: `LIBRARY_API`, `RUNTIME_EXPORTS` and the connection's surface list are verbatim. The paths
   it proves cannot be imported through the package keep their role but name the rebuild's package and, where the old
   file has no counterpart at the old path, the file that now plays its part, so each still names a real internal file:
   `@storytree/library/src/transactions/pg.ts` and `.js` are `@storytree/library-rebuild/src/storage/store/pg.ts` and
   `.js`; `@storytree/library/src/project/storytree.ts` is `@storytree/library-rebuild/src/projects/open/storytree.ts`;
   `@storytree/library/src/schema/records.ts` is `@storytree/library-rebuild/src/storage/rules/records.ts`;
   `src/testing/pg.ts`, `src/index.ts` and `package.json` change only the package name.
4. Re-pointed internal paths: `../testing/pg.js` is `./testing/pg.js` at the root and `../../testing/pg.js` in
   `projects/shared/`; `../project/index.js` (`connect as connectProject`) is `./projects/open/index.js`; the old project
   entry `./index.js` and `./storytree.js` (`connect`, `Project`) in `ci-health.test.ts` and `cloud-session.test.ts` are
   `../open/index.js`, merged into one line in `cloud-session.test.ts`; `../schema/index.js` (`SchemaRecords`) is
   `./storage/rules/index.js`; `../transactions/index.js` (`MemoryTransactions`, `NumberTakenError`) is
   `./storage/store/index.js` or `../../storage/store/index.js`; `../health/index.js` is `./health/index.js`;
   `../work/index.js` (`WorkInFlight`, `WorkModel`) is `./work/index.js`.
5. `Knowledge` comes from `knowledge/decisions/index.js` in `writer.test.ts`, `ci-health.test.ts` and
   `cloud-session.test.ts`: the decisions domain's `Knowledge` is the one with `composeStatement`,
   `setDecisionNumberFloor` and floor numbering, and the opened project's `knowledge` is of that type. In
   `cloud-session.test.ts` the old `import { Knowledge, PgVectors } from "../knowledge/index.js"` is split:
   `Knowledge` from `../../knowledge/decisions/index.js`, `PgVectors` from `../../knowledge/search/index.js`.
6. Setup re-pointed: `ci-health.test.ts` (twice) and `cloud-session.test.ts` read their grants SQL by
   `new URL("../../../../infra/…", import.meta.url)`; the files sit one folder deeper (`src/projects/shared/` rather
   than `src/project/`), so it is `../../../../../infra/…`, the same repository `infra/` folder. After integration moves
   them to `packages/library/src/projects/shared/` the depth is the same.
7. `work/arcs/work-in-flight.test.ts`: the test "7.8 · arcViews() answers every live arc's view as arcView does, in a
   bounded number of reads whatever the number of arcs", which the arcs lane left to this increment (its ledger,
   item 4), is put back unchanged at its frozen position, after the 10.25 test and before the 10.22 one, using the
   file's `contract` helper and both backends; `type ArcView` (used by it alone) goes back into the file's
   `./index.js` import.
8. Passing on arrival, not seen red: 7.5 (`public-reads.test.ts`, both backends: the front door's `get`, `list` and
   `history` already read through the records) and 7.8 (both backends: the arcs lane built `arcViews`). Every other
   copied test was seen red.
9. Nothing was left out: every test of the eight files and the one 7.8 test is carried. No `testing/` file was
   changed or copied.
10. `pnpm lint`'s package-boundaries check names `printable.test.ts`'s `@storytree/library-rebuild/printable` while
    the package has no `./printable` export key; the import is the frozen one re-pointed, and the key is the builder's.
