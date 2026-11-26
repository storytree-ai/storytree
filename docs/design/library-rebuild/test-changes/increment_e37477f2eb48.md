# Test changes: health (increment_e37477f2eb48)

Changes beyond re-pointed imports, for the blind reviewer. Every title, contract number and assertion is unchanged.

1. `health/health-record.test.ts` (from `health/health-record.test.ts`, 5.1-5.36): the leading comment
   (`// Capability 5 · Health record`) is dropped (ADR-1369), and only the import block changed: `connect` from
   `../projects/open/index.js`; `MissingReferenceError` (was `../references.js`) and `NewerSchemaError`,
   `SchemaError`, `SchemaRecords`, `RecordType`, `SchemaRecord` (was `../schema/index.js`) from
   `../storage/rules/index.js`, one line where there were two; `MemoryTransactions`, `RecordEnvelope`,
   `Transactions` from `../storage/store/index.js`; the old `../work/index.js` line is two: `WorkModel` and
   `ProjectTree` from `../plan/index.js`, `WorkInFlight` from `../work/arcs/index.js`. `../testing/pg.js` and the
   health entry `./index.js` are unchanged. Everything from the `Library` interface to the end of the file is
   byte-for-byte the frozen file's, setup included: its postgres backend and the 5.29 test still read `health`
   (with `work`, `flight`, `records`, `transactions`, `pool`) off the opened project, as the declared `Project`
   does (`interface/index.d.ts`, `readonly health: HealthRecord`), so the rebuild's opened project must carry one.
2. `health/verdict-release.test.ts` (new file, restored from the arcs increment's ledger item 7,
   `increment_a2b03908794a.md`, and its commit 887fbdc4): the tests of 10.44 ("a failing verified verdict on a
   contract releases each open increment whose event wait is about it …") and 10.45 ("a failing verdict told later,
   as of its place in history, …"), copied from the frozen `work/work-in-flight.test.ts`. It sits in `health/`
   rather than `work/arcs/` because 10.44 drives `HealthRecord.recordVerified`, which this increment builds, and the
   arcs increment parked both tests for it; `WorkInFlight` is imported from `../work/arcs/index.js` and
   `HealthRecord` from `./index.js`. The file carries the frozen file's `Library` and `Backend` shapes, both
   backends, the `contract` wrapper, the `ARC` and `BARE_WORK` fixtures and the `readAt` helper, each verbatim;
   the frozen fixtures and helpers these two tests do not use (`WORK`, `TODAY`, `BARE_ARC`, `ASK`, `report`,
   `frictionOf`, `laterThan`, `createInOrder`) are left out. One difference from 887fbdc4's parked copy: its
   postgres backend built `new WorkModel(project.records)`, `new WorkInFlight(project.records, work)` and
   `new HealthRecord(...)` because the opened project then carried none of them; the rebuild's opened project now
   carries `work` and `flight` (see `increment_d4e63b0ff102.md` item 1) and carries `health` (item 1 above), so
   this copy restores the frozen line, `{ work: project.work, flight: project.flight, health: project.health, … }`,
   and the frozen setup needs no change at all.
3. No test was added beyond the frozen oracle, and none was left out.
