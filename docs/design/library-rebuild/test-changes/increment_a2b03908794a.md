# Test changes: work › arcs and increments (increment_a2b03908794a)

Changes beyond re-pointed imports, for the blind reviewer. Every title, contract number and assertion is unchanged.

1. Every copied file's leading comment (`// Capability 10 · Work in flight`, `// Capability 11 · Waits`,
   `// Capability 4 · Work model` twice, `// Capability 32 · Questions and work`) is dropped (ADR-1369).
2. Imports: the old `../references.js` (`MissingReferenceError`) and `../schema/index.js` names now come from
   `../../storage/rules/index.js`, merged into one import line; `../transactions/index.js` is now
   `../../storage/store/index.js`; `../project/index.js` is `../../projects/open/index.js`; `../testing/pg.js` is
   `../../testing/pg.js`; `../knowledge/index.js` (`Knowledge`) is `../../knowledge/notes/index.js`; `WorkModel`
   comes from `../../plan/index.js`, and `WorkInFlight`, `WaitLoopError`, `LifecycleError` and `NewIncrement` from
   the work/arcs entry `./index.js`.
3. `work/arcs/work-in-flight.test.ts`, `work/arcs/waits.test.ts`, `work/arcs/pending-changes.test.ts` (from
   `work/work-in-flight.test.ts`, `work/waits.test.ts`, `work/pending-changes.test.ts`): the postgres backend's
   setup read the work model and work in flight off the opened project (`project.work`, `project.flight`). The
   rebuild's `connect` (`projects/open/index.js`) opens a project with `records`, `transactions`, `knowledge` and
   `close` and no `work` or `flight`, so the setup builds them: `new WorkModel(project.records)` and
   `new WorkInFlight(project.records, work)`. Cleanup still closes the server and drops the database. The memory
   backends are unchanged.
4. `work/arcs/work-in-flight.test.ts`: the test "7.8 · arcViews() answers every live arc's view as arcView does, in
   a bounded number of reads whatever the number of arcs" is not copied: it is contract 7.8, the front door
   increment's, which carries it. The `ArcView` type it alone used is left out of the import.
5. `work/arcs/work-in-flight.test.ts`: 10.44 and 10.45 are moved to their own file (item 7), so this file's
   `Library` drops its `health` field and the backends no longer build or read a `HealthRecord`, whose only user
   was 10.44; the `HealthRecord` import goes with it.
6. `work/arcs/work-in-flight.test.ts`, "10.8 work reads stay small as unrelated closed history grows, preserving
   blockers and the arc log": it destructured `work`, `flight`, `records` and `pool` from the project
   `withCountedProject` opens. The rebuild's project carries no `work` or `flight`, so the body takes
   `{ records, pool }` and builds `const flight = new WorkInFlight(records, new WorkModel(records))` on its first
   line (`work` was never used in the body). Everything after is unchanged.
7. `work/arcs/verdict-release.test.ts` (new file): the tests of 10.44 ("a failing verified verdict on a contract
   releases each open increment whose event wait is about it …") and 10.45 ("a failing verdict told later, as of
   its place in history, …"), copied whole from `work/work-in-flight.test.ts`. They are split out because 10.44
   drives `HealthRecord.recordVerified`, which the parallel health increment (increment_e37477f2eb48) builds; 10.45
   moves with it as the same verdict-release behaviour. The file duplicates the frozen file's `Library` and
   `Backend` shapes, both backends (the postgres one building `new HealthRecord(project.records, work, flight)` as
   item 3 builds the others; the memory one as frozen), the `contract` wrapper, the `ARC` and `BARE_WORK` fixtures
   and the `readAt` helper; the fixtures and helpers these two tests do not use (`WORK`, `TODAY`, `BARE_ARC`, `ASK`,
   `report`, `frictionOf`, `laterThan`, `createInOrder`) are left out. It imports `HealthRecord` from
   `../../health/index.js`, so it does not load until health lands on the held branch: its red run fails on that
   missing module, expected, not on this increment's code.
8. `work/arcs/plan-hold.test.ts` (from `work/plan-hold.test.ts`): the frozen file opened the front door's
   `connect` (`../index.js`) and drove its `Library` (`createArc`, `addStory`, `addCapability`, `addEdge`,
   `addContract`, `addIncrement`, `editIncrement`, `advanceIncrement`, `get`) and passed it to `editPlanRecord` and
   `refuseHeldPlanWrite`. The front door is built later, so the setup only changes: it opens the project with
   `connect` from `../../projects/open/index.js`, and each test's `const library = await storytree.openProject(project)`
   becomes `await openLibrary(storytree, project)`, a helper at the file's end that builds
   `new WorkModel(records)` and `new WorkInFlight(records, work)` and returns an object of their bound methods:
   those nine, plus the rest of `editPlanRecord`'s parameter type `PlanEditors`
   (`interface/commands.d.ts`: `editStory`, `editCapability`, `editContract`, `editEdge`, `editArc`, `pendChange`),
   which the front door's `Library` offered and `editPlanRecord` calls. Cleanup is the frozen one:
   `storytree.dropProject(project)`, then `storytree.close()`. `editPlanRecord` and `refuseHeldPlanWrite` are
   imported from `./plan-hold.js`, as frozen.
9. `work/work.test.ts` (32.1, from `work/work.test.ts`): only the comment is dropped; its imports
   (`../testing/pg.js`, `./index.js`, the work entry) already resolve in the new tree.
