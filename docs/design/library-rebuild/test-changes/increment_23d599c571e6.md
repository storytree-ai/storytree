# Test changes: storage (increment_23d599c571e6)

Changes beyond re-pointed imports, for the blind reviewer.

1. `storage/rules/data-schema.test.ts` (from `schema/data-schema.test.ts`): the tests of 3.10, 3.11, 3.12, 3.13, 3.14,
   3.19, 3.21 and 3.22 are left out here; the notes and plan increments copy them. The imports only they used
   (`parseSchedule`, `OWNER_TIME_ZONE`) are dropped, and the file's leading comment (ADR-1369). Every kept title
   and assertion is unchanged.
2. `storage/store/cancellation.test.ts` and `names.test.ts`: the separate imports from `./memory.js`, `./pg.js` and
   `./types.js` now come from the store's one entry, `./index.js`, merged into one import line each.
3. Setup re-pointed: `storage/rules/code-distance.test.ts` bundles `./errors.ts` by path, now
   `storage/rules/errors.ts`; `testing/pg.ts` imports the project-level `connect` from `../projects/open/index.js`;
   `knowledge/librarian/testing/pg.ts` imports the front door from `../../../index.js`.
4. `storage/store/testing/behaviour-suite.ts` is new test code: the old suite was library source the cold rule
   forbids. It was written from `spec/02.txt` and the declared `Transactions` types, one test per contract 2.1–2.10,
   2.12–2.20 and 2.23–2.25, titled `<number> [<backend>] <the contract's words>` (2.17–2.19 without the spec's
   trailing line break). The oracle never listed these titles: the old suite was not a test file.
5. `api/writer.test.ts` ("2.10 / 7.6") is not copied here: it drives every domain, so the front door increment
   carries it. 2.10 is covered here by the behaviour suite.
