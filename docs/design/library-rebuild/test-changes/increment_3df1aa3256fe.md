# Test changes: opening a project (increment_3df1aa3256fe)

Changes beyond re-pointed imports, for the blind reviewer.

1. `projects/open/project-libraries.test.ts` (from `project/project-libraries.test.ts`): the test of 30.4 ("30.4 a project
   opened with a plugin's kinds writes and reads them, ...") is left out here; capability 30 belongs to the shared
   increment (increment_216cfd6f4f7e), which copies it. Every helper and import it used (`withStorytree`, `databaseOf`,
   `uniqueProjectName`, `FieldsOf`, `RecordType`) is still used by a kept test, so none is dropped. The other 28 titles
   and every assertion are unchanged, and in the same order.
2. Merged import lines: `project-libraries.test.ts` imported from `./index.js`, `./factory.js` and `./schema.js`; those
   names (`ConnectionError`, `FactoryCircle`, `PROJECT_SCHEMA`, `ProjectGoneError`, `connect`, `InheritedRecords`, `Project`,
   `Storytree`) now come from the domain's one entry, `./index.js`, in one line. `record-cache.test.ts` imported `Project`
   from `./index.js` and `connect` from `./storytree.js`; both now come from `./index.js` in one line, so the entry's
   `connect` is the one that takes the second (seams) argument, as `project-libraries.test.ts`'s already was.
   `schema-merged.test.ts`'s `./schema-merged.js` is now `./index.js`.
3. Re-pointed paths: `../schema/index.js` is now `../../storage/rules/index.js`; `../testing/pg.js` is now
   `../../testing/pg.js`. No setup named an old internal path otherwise.
4. The leading `// Capability N` comment of `project-libraries.test.ts`, `project.test.ts` and `schema-merged.test.ts` is
   dropped (ADR-1369). `record-cache.test.ts` had none.
5. No fixture or `testing/` file was copied: `testing/pg.ts` (storage's copy) already offers every helper these tests
   use. Every other test of the four files is carried; none was left out for want of support.
6. `api/snapshot.test.ts` is not carried here. Its tests (1.6, 1.7 twice, 1.8, 1.30) drive the front door's whole
   Library: `addStory`, `addCapability` and `addContract` from the plan, `defineTerm` and `editNote` from notes,
   `recordDecision`, `search`, `projectTree`, and `attachMedia`, `media` and `mediaFile`, which domains not yet built
   own. The front door increment (increment_b683392d4147), which composes every domain, carries it, copied from the
   frozen `packages/library/src/api/snapshot.test.ts`, as the storage increment left `api/writer.test.ts` to it. This
   increment still builds snapshot and restore at the project level: the first 34.1 test of `project.test.ts` restores a
   project's snapshot into an empty project through the project entry and reads the same records back.
