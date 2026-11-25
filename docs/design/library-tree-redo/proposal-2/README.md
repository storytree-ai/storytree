# Redone tree proposal 2: the library's capabilities by dependency layers, nested domain-first

One of three redone tree proposals for the library story (story_754e87e7d531), on arc_c465ed702824, made blind to the other two (ADR-1403 D3). This is increment_14a13d90ff17; its predecessor is research_262752601788. It is a proposal only: no capability in the plan changed and no code moved.

**Open `tree.svg`** in a browser (a PNG of it is on the pull request): today's tree on the left, this proposal on the right. Boxes nest as the tree nests; each column is ordered by level among top-level parts, lowest at the bottom; grey arrows point down a level and red ones point up or across, which only an import cycle makes.

## In short

The library becomes nine domains, each holding its own record schema and its own layers inside, stacked so that every import points down: Records and Command words at the bottom, then Decisions, Knowledge, Owner's voice, Plan and work, Health, Projects, and the Library doors on top. No sibling cycle stands at any level once the refactor's imports are in (today: three cycle sets, 21 of 44 top-level arrows pointing up). Nine in ten imports between siblings go through the sibling's entry file (today 57%). The old shared schema is cut into six domain schemas plus a small record kernel that holds no domain's fields.

The cost is about 32 source files moved (mostly whole-folder moves), 4 files split, 15 small new files, and 29 contracts rehomed, none retired. TurboMQ falls from 2.65 to 2.32, which is still far beyond chance; co-change inside groups rises from 28.5% to 34.4%.

## The rule set

- Start from the domains: similar concepts and things that change together form one capability, with capabilities nested inside it (ADR-1403 D2). A technical piece sits in the domain it serves, so each domain holds its own record schema.
- Levelize inside each domain by its imports, and keep the domains themselves levelized: no cycle among siblings at any level (ADR-1399 D4), dependencies pointing toward stable parts. Dependency between parts is fine, and a single source of truth that several parts read is good (ADR-1403 D1). No code is duplicated to decouple.
- Where a domain needs the whole library only to reach a few of its methods, it declares the few it calls as a narrow interface (a "shelf") that the Library already satisfies. That is what removes today's cycles, rather than moving code apart.
- Make each part a deep module with a small entry file (principle "Deep modules", ADR-1343), and run the deletion test on each boundary (below).
- Nesting stands where the refactor gives a folder with its own entry file (ADR-1377 D2). The refactor makes those folders: `records/`, `voice/` and `doors/` are new.

## The tree, bottom layer first

| level | domain | holds (nested capabilities, lowest first) | its own schema |
|---|---|---|---|
| 1 | 36 · Records | 2 · Library transactions; 3 · Record rules (validation, versions and upgrades, plugin kinds, references between records, creation order) | the record kernel: the envelope, `RecordType` and `FieldsOf`, but no domain's fields |
| 1 | 16 · Command words | the verb shape every door is declared in (`Verb`, inputs, refusals, door words) and the activity line's shape | none |
| 2 | 31 · Decisions | 13 · Decision log; 22 · Decision edits (supersede, correct, annotate); 37 · Decision commands (the `adr` family) | decision, decision numbering |
| 3 | 33 · Knowledge | 14 · Ranked search; 6 · Knowledge artifacts (absorbs 9 · Knowledge entrances, and the process schedule); 35 · The librarian {21 · Links, 23 · Catalogue, 24 · Graduation; 26 · Rounds} | definition and the fourteen knowledge kinds |
| 4 | 38 · Owner's voice | 12 · Owner questions; 39 · Feedback and FYIs (with the `fyi` family) | question, prediction, feedback, FYI |
| 5 | 32 · Plan and work | 4 · Work model, 11 · Waits (gains the wait writes); 10 · Work in flight (gains plan holds) | story, capability, contract, edge, anchor, pin, cut-over; arc, increment |
| 6 | 5 · Health record | (none nested) | health |
| 7 | 34 · Projects | 28 · Shared server (gains names and the seed connection); 15 · Connection by address, 29 · Factory and product; 1 · Project libraries, 30 · Outside writers | assembles every domain's kinds into the library's schema |
| 8 | 40 · Library doors | 27 · Fixed data questions; 7 · Library API; 17 · The library's commands | none |

That is 9 top-level and 25 nested capabilities (today 12 and 18), up to three deep. New: 36, 37, 38, 39 and 40. Merged away: 9 (into 6). Retitled: 3 (Record rules), 16 (Command words), 22 (Decision edits), 32 (Plan and work), 33 (Knowledge), 34 (Projects).

`tree.json` holds this tree in the scorer's format with today's file paths, so it grades on main.

## Readings

The scorer is `storytree code-measures tree` with increment_abc46882a433's readings, run on origin/main 1192a033. Three columns:

- **today**: the plan's tree as it stands.
- **on today's code**: this tree laid over today's files and imports. Co-change is read here, because it comes from main's history.
- **after the refactor**: this tree read on a scratch copy of the library with the refactor's imports applied: the schema split, the shelves, the moved command context and the moved connection options. The copy was never committed and is deleted. Its schema files are stubs that carry the right imports and exported names, so the structural readings are faithful, but it was not compiled.

| reading | today | on today's code | after the refactor |
|---|---|---|---|
| cycles among siblings, at any level | fail: 3 sets | fail: 2 sets | **pass: none** |
| top-level arrows pointing up or across | 21 of 44 | (cycles remain) | **0 of 26** |
| imports by where their ends meet (depth 0 / 1 / 2 / 3; deeper is better) | 108 / 117 / 29 / 0 | 105 / 68 / 73 / 8 | 92 / 96 / 88 / 8 |
| share meeting below the top | 57% | 59% | 68% |
| imports between siblings through the sibling's entry | 56.6% (81 of 143) | 63.2% (91 of 144) | **89.6% (121 of 135)** |
| top-level technical names | 2 (3 · Data schema, 16 · The command schema) | none | none |
| nodes per depth (sibling edges) | 12 (44), 18 (19) | 9 (32), 21 (18), 4 (3) | 9 (26), 21 (17), 4 (3) |
| split candidates (a consumer using under a quarter of a dependency) | 68 | 70 | 68 |
| type names crossing boundaries between parts that are not parent and child | 315 | 346 | 337 |
| type names re-exported through a parent's entry | 124 | 132 | 187 |
| TurboMQ (random mean / p95) | 2.65 (0.76 / 0.94) | 2.32 (0.83 / 0.98) | (2.31: same history) |
| co-change inside groups (random mean / p95) | 28.5% (9.9% / 12.8%) | 34.4% (16.3% / 20.3%) | (34.0%) |
| co-change pairs at lift 2 or more inside one top-level part | 4 of 11 | 7 of 14 | |

What each reading shows:

- **Cycles.** Today's three cycle sets come from domains importing the whole `Library` facade (which imports them back), from the shared schema, and from connection options declared in the wrong file. The shelves, the schema split and moving `ConnectOptions` to `project/address.ts` remove all of them. Laid over today's imports, the tree still shows the top-level cycle, which is exactly what the import changes remove.
- **Meet depth and entries.** More imports now meet inside a domain, and almost every import between siblings goes through an entry, so each domain reads as one module from outside. The 14 imports that still skip an entry are 8 inside 34 · Projects (into `connection-error.ts`, `names.ts`, `switches.ts`), 3 inside Plan and work (into `pending-changes.ts`, `wait-writes.ts`), 2 inside Knowledge (into the search's `embedding-model.ts`, `whole-words.ts`) and 1 into the data commands: each could be closed by re-exporting from the sibling's entry, and none makes a cycle.
- **Technical names.** None at the top. "Records" and "Command words" are concepts the library's users meet (a record's history and revert; the words a command is declared in), not layers.
- **Common reuse.** Split candidates stay at 68. Most now point at 36 · Records (20), the kernel every domain reads a little of. That is a single source of truth read in part by design (ADR-1403 D1), not a lead to split.
- **Types crossing.** Across unrelated parts the count is about level (315 against 337, on fewer edges: 75 against 82). What grows is the names a parent's entry re-exports from its children (124 to 187): that is the price of each domain having one entry. The widest entry is 32 · Plan and work's (104 names against 150 behind it).
- **TurboMQ and co-change.** Both stay well beyond chance. TurboMQ falls because nine bigger top-level groups raise the chance level (its random p95 rises from 0.94 to 0.98) and because the Library doors are a group of their own; the share of co-change inside groups rises. Half of the strong pairs now sit inside one domain (7 of 14, against 4 of 11). The ones still crossing are the Library API with whatever feature is changing, and Knowledge artifacts with the Decision log (below).

## Guidance (judgements, not readings)

- **Knowledge and Decisions change together** (lift 6.99). The cause is in the code: `knowledge.ts` forwards fourteen decision methods to the decision log one for one, so a decision feature edits both. The refactor deletes those forwarders (the deletion test: they hide nothing) and gives the project a `decisions` part that the Library API reads directly. Knowledge still depends on Decisions for editing decision notes, which is fine.
- **The Library API crosses every domain.** It is the facade every feature is published through, so it changes with each one. That is its job, and the readings name it as a pair, not a fault.
- **A tall stack.** Eight levels at the top is what the imports say once the cycles are gone. Dependency between domains is fine (ADR-1403 D1); what the stack shows is that each domain depends only on those below it.
- **Two shared bases kept whole**, each passing ADR-1403 D2's test of a downstream part that gains from them joined:
  - 36 · Records holds no domain's fields now; what stays joined is one validator, one history and one revert for every kind, which `library history`, `revert` and `undo` read across all kinds (contracts 2.14 to 2.19, 17.8 and 17.9). Split per domain, each domain would carry its own copy. A domain's schema going red now stays in that domain.
  - 16 · Command words is the one verb shape that the command line, the MCP server and the app read every family by, across more than ten stories (116 imports of `@storytree/library/verbs`).
- **The alternative not taken.** Putting every door (the `adr` and `fyi` families too) in Library doors would fold Command words in there and leave no shared base beside Records. It was not taken, because co-change says the `adr` family changes with the decision log and edits (lift 14.76), so it sits in Decisions.
- **"Owner's voice".** The voice door's notes are a plugin's records, outside this story. This part holds the library's own records of what passes between the owner and the agents: questions, predictions, feedback and FYIs. If "voice" meant something else, 38 is the part to rename.
- **Deletion test on each new boundary.**
  - 36 · Records: keep. It hides transactions behind one entry; delete it and validation and upgrades reappear in six domains.
  - 40 · Library doors: keep. Its entry is the package's own public interface.
  - 38 · Owner's voice: keep. Plan and work reaches questions only through its entry.
  - The shelves: keep. Delete one and its domain imports the whole Library again, and the cycle returns.
  - 37 · Decision commands: weak. It is one file whose callers are the command line's families. It is kept apart from the log for ADR-1242 D1: door words change for other reasons than the log.
  - 39 · Feedback and FYIs: weak. Without it, its code returns to the Library API, which is today's shape. It is kept for ADR-1242 D2, because it owns the feedback and FYI records, which the facade writes today.

## ADR-1242's three tests, for each capability this proposal changes

Capabilities it only re-parents (2, 12, 13, 14, 15, 21, 23, 24, 26, 27, 28, 29, 30, 35) keep their present standing.

| capability | D1 one reason to change | D2 owns its records | D3 claim-sized contracts |
|---|---|---|---|
| 36 · Records | what a record is, whatever its kind | owns no domain's records | holds no contracts of its own; 2 and 3 keep theirs |
| 3 · Record rules | validating, versioning and linking any record | owns none | 3.10, 3.12, 3.13 go to 6 and 3.11, 3.14, 3.21, 3.22 go to 4, with the schemas they test |
| 16 · Command words | how a door's verb is declared | owns none | 16.3, 16.4 (where a write goes) go to 17 with the command context |
| 31 · Decisions | how decisions are recorded, related and edited | passes: its schema, log and edits are all inside | passes |
| 22 · Decision edits | changing accepted decisions | passes: supersede joins correct and annotate, so one part writes those edits | 13.12, 13.13 move in with `supersede.ts` |
| 37 · Decision commands | the `adr` family's words | owns none | 13.10, 13.16, 13.17, 13.25, 13.27, 13.28 move in. Still to check: 13.16 and 13.17 may need the log's code, and the shelf names every method they call |
| 33 · Knowledge / 6 · Knowledge artifacts | notes, their kinds and front covers | passes: absorbs front covers (9) and the process schedule | 9.1, 9.3 and 3.10, 3.12, 3.13 move in |
| 38 · Owner's voice | what passes between the owner and agents | passes: owns question, prediction, feedback and FYI records | holds none itself |
| 39 · Feedback and FYIs | feedback and FYIs | passes, and fixes today's case of the facade writing them | 7.18, 7.19, 7.23 and 17.10 move in |
| 32 · Plan and work / 4 · Work model | the plan's parts and pins | passes: owns pins, which the facade writes today | 3.11, 3.14, 3.21, 3.22 and 7.28 move in; 4.36 moves out with plan holds |
| 11 · Waits | waits and their writes | passes: the wait reader and writer become one | 10.32, 10.36, 10.37 move in. Still to check: 10.33's clearing runs from work in flight and stays on 10 |
| 10 · Work in flight | arcs, increments and held plan edits | passes | 4.36 moves in |
| 28 · Shared server | reaching and naming a server's databases | owns none | 1.5 moves in with `names.ts` |
| 34 · Projects | opening a project and assembling its kinds | owns none | passes |
| 40 · Library doors / 17 · The library's commands | how other stories, agents and people reach the library | owns none | 16.3, 16.4 move into 17; 17.10 moves out to 39 |

## Refactor cost

- **Files moved: about 32 source files, with their tests.** Most are whole folders:
  - `transactions/`, the kernel part of `schema/`, `references.ts` and `creation-order.ts` go under `records/` (15 files);
  - `api/`, `data/` and `commands/` go under `doors/` (12 files);
  - `work/owner-questions.ts` and `commands/fyi.ts` go to `voice/`;
  - `schema/schedule.ts` goes to `knowledge/`, `schema/story-survey.ts` to `work/` and `schema/activity-line.ts` to `verbs/`.
  - Two files change capability in place: `work/wait-writes.ts` (to 11) and `project/seed-connection.ts` (to 28).
- **Files split: 4.**
  - `schema/types.ts` (836 lines) becomes the kernel plus six domain schema files, and `schema/upgrades.ts` dissolves into them.
  - The Library API's `library.ts` hands feedback and FYIs to `voice/feedback.ts` and pins to `work/pins.ts`.
  - `verbs/verb.ts` hands the library-bound command context (`VerbContext`, where a write goes) to `doors/commands/context.ts`.
  - `knowledge.ts` loses its fourteen decision forwarders.
- **New files: about 15.** These are the six domain schemas, `project/record-kinds.ts`, three shelves (`decisions/shelf.ts`, `librarian/shelf.ts`, the FYI shelf in `voice/feedback.ts`), and the entries `records/index.ts`, `voice/index.ts`, `doors/index.ts` and `verbs/index.ts`.
- **Shared types cut.**
  - The record-type registry becomes an interface that each domain's schema extends (TypeScript declaration merging), so `RecordType`, `FieldsOf` and `SchemaRecord` keep their names and meaning, and the kernel never imports a domain.
  - `ConnectOptions` moves to `project/address.ts`.
  - The shelves `DecisionShelf`, `DecisionCommandShelf`, `LibrarianShelf` and `FyiShelf` are added; each holds only the methods its domain calls, and `Library` already satisfies each one.
  - Data commands type their library as the data questions they ask.
  - No data shape is copied.
- **Package exports.**
  - Every export name stays.
  - `./verbs` retargets to `verbs/index.ts`, which re-exports the kernel with the library's command context as its default. Its 116 importers in other stories change nothing.
  - `./commands` and `./printable` follow their folders into `doors/`.
- **Contracts.** 29 are rehomed and none is retired:
  - 3.10, 3.12, 3.13, 9.1 and 9.3 to 6;
  - 3.11, 3.14, 3.21, 3.22 and 7.28 to 4;
  - 7.18, 7.19, 7.23 and 17.10 to 39;
  - 16.3 and 16.4 to 17;
  - 13.10, 13.16, 13.17, 13.25, 13.27 and 13.28 to 37;
  - 13.12 and 13.13 to 22;
  - 10.32, 10.36 and 10.37 to 11;
  - 4.36 to 10;
  - 1.5 to 28.
- **Plan.** Five capabilities are added (36 to 40), one is merged away (9, its record kept and its contracts moved), six are retitled, and 2, 3, 12, 35, 27, 7 and 17 are re-parented. Each new parent has its own folder and entry file (ADR-1377 D2).
- **Risk.** The shelves and schema entries are new source files, and ADR-0838 D5 asks a numbered test to reach each one. The domain schemas are reached by today's schema tests through validation. A shelf that holds only types may need its importer's test named in the package's coverage map.

## Regrade

- On main: `storytree code-measures tree story_754e87e7d531 --tree docs/design/library-tree-redo/proposal-2/tree.json`.
- The "after the refactor" column needs the refactor's imports. The refactor increment reads it on its own branch with this same tree file, its paths updated to the moved folders.
