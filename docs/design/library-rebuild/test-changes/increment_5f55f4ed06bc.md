# Test changes: search (increment_5f55f4ed06bc)

Changes beyond re-pointed imports, for the blind reviewer. Every title, contract number and assertion in the six
copied files is unchanged.

1. Copied into `knowledge/search/`: `knowledge/ranked-search.test.ts`, `knowledge/phrase-search.test.ts`,
   `knowledge/embedding.test.ts`, `knowledge/embedding-model.test.ts`, `knowledge/embeddings.test.ts` and
   `project/embedding-isolation.test.ts` (the last moved from the project folder into search, since its tests are
   14.10's; its one test titled "1.4, 14.10" comes with it, unchanged).
2. The leading `// Capability 14 · Ranked search` line is dropped from `ranked-search`, `phrase-search`, `embedding`
   and `embedding-model` (ADR-1369, no comments). `embeddings` and `embedding-isolation` had none.
3. The search domain has one entry, `knowledge/search/index.ts`, so imports that named `./embedding.js`,
   `./embedding-model.js`, `./embeddings.js` or `../knowledge/index.js` now name `./index.js`. Where an old import
   line mixed the knowledge class with search exports, it is split: `Knowledge` now comes from the notes domain's
   entry, `../notes/index.js`, and the search names from `./index.js` (`ranked-search`, `embeddings`). Where two old
   lines now name the same entry they are merged into one: `embeddings` (`PgVectors` with `type Embedder`) and
   `embedding-isolation` (`chunksOf, renderNote` with `PgVectors, vectorServerIdentity`).
4. Setup re-pointed: `embeddings.test.ts`'s child-process script imports `PgVectors` from
   `new URL("./embeddings.ts", import.meta.url)`, now `new URL("./index.ts", import.meta.url)`, in both places.
5. `embedding-isolation.test.ts` imported `connect` and `type Storytree` from `./storytree.js` in the project folder;
   both now come from `../../projects/open/index.js`, the opening domain's entry.
6. Not copied here: `commands/commands.test.ts`'s one 14.19 test ("14.19 · library search --kind arc|increment and
   search_notes kinds arc|increment rank only that kind, ...") drives the command kit and the note tools, which this
   increment does not build; the commands increment (increment_53ff8e067dfa) carries it. 14.19 is covered here by
   `ranked-search.test.ts`'s four 14.19 tests.
7. No test helper was added: `testing/pg.ts` (copied by storage) already has every helper these files use.
