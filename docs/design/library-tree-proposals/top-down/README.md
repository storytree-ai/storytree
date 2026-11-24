# Tree proposal 3: the library cut top-down from story intent

This is one of three independent tree proposals for the library story (story_754e87e7d531) on arc_c465ed702824 (ADR-1395 D3). It is increment_8a4a692551d6. It is a proposal only: no capability in the plan changed, and no code moved.

- `tree.json` is the proposed tree, in the scorer's format. Grade it again with `storytree code-measures tree story_754e87e7d531 --tree docs/design/library-tree-proposals/top-down/tree.json`.
- `tree.png` (and `tree.html`, the same page) shows the baseline and this proposal side by side.
- `scorecard.txt` is the scorer's full output for this tree: every pair, node and boundary with the types crossing it.
- `moves.txt` lists every file the refactor would move.

## The rule set

The tree is cut top-down from the story's own sentence: "Where one project's records live, how they are stored and how they are kept honest: the plan of work, how healthy each piece is, and what the project has learned."

- **Top level.** Each top-level capability is one reason a person or agent comes to the library.
- **Below that.** Each child holds one design decision that is likely to change (Parnas). The cut uses the capabilities' contract titles and their files' exported names.
- **Not read first.** The cut did not use co-change or the import graph. The scorer read both only after the tree was written.
- **Disclosure.** Before cutting, I read the baseline note (research_6109d50f1846), which quotes the baseline's own co-change pairs. I made no change to the tree after seeing its score.

## The tree (27 capabilities: 9 at the top, 18 nested)

| Top level: why someone comes | Children (the design decision each hides) | From today's plan |
|---|---|---|
| **Storage**: keep a project's records safe and reachable | Project libraries (opening, naming, snapshots, media) · Connections (reaching a server: address, TLS and websocket, pool slots, byte counts) · Transactions (the write path and its two engines) · Record schema (record shapes and how old ones upgrade) · Factory circle (which library a project reads through its factory) · Plugin kinds (a plugin's own record kinds and their fenced writers) | 34 › 1, 15 + 28, 2, 3, 29, 30 |
| **The plan**: say what will be built | Plan structure (stories, capabilities, contracts, edges, the anchor, imported and plugin plans) · Branch plan changes (plan edits held for a branch, applied when it lands) | 4, split in two |
| **Work**: track what is being built and what holds it | Arcs and increments · Waits (and the commands that write them) · Owner exchange (questions to the owner, FYIs and feedback from him) | 32 › 10, 11, 12 |
| **Health record**: say how healthy each part is | (none) | 5 |
| **Knowledge**: keep and find what the project learned | Notes (knowledge kinds and the note tools) · Ranked search (embedding and word ranking) · Decisions (the decision log, corrections, front covers) | 33 › 6, 14; 31 + 13 + 22 + 9 |
| **The librarian**: keep the library honest | Links · Catalogue · Graduation · Rounds | 35 › 21, 23, 24, 26 (unchanged) |
| **Library API**: program against the library | (none) | 7, less its record-kind writes |
| **Library commands**: drive the library from a command line or tool | (none) | 17 + 27 |
| **Command schema**: declare any storytree command once, for every door | (none) | 16 |

Every parent stands on a folder with its own entry file once the code moves (ADR-1377 D2): `storage/`, `plan/`, `work/`, `knowledge/`, `librarian/`. Every child also gets its own folder.

### The three boundary tests (ADR-1242), per capability: judgements

| Capability | D1: one reason to change | D2: owns its records | D3: claim-sized contracts |
|---|---|---|---|
| Storage (parent) | Its entry file's promises only | Writes nothing itself | Its 1 contract is about the entry file |
| Project libraries | How a project's database is made, opened, copied and restored. Media is grown in, because a snapshot carries media. | The project's database and media rows | Pass |
| Connections | How a server is reached. 15 and 28 change together for transport. | None, since connections are not records | Pass. 28's 16 contracts move in whole. |
| Transactions | The write path | History and the record envelope | Pass |
| Record schema | Record shapes and how old ones upgrade | None of its own | Doubtful: a new kind's field touches the schema and its owner. Today's plan has the same doubt. |
| Factory circle | How a product reads through its factory. `elsewhere.ts` (libraries reached by name, 29.7) moves in. | A product's own copies of system records | Pass |
| Plugin kinds | A plugin's own kinds. 7.21, 7.22 and 7.24 (plugin records) move in from the API. | Plugin-kind records | Pass |
| The plan (parent, new) | Its entry file's promises only | None | Needs one new contract for its entry file. This is not a rehome. |
| Plan structure | The plan's shape and its rules | Story, capability, contract, edge and anchor records | Pass. Imported stories and plugin plans stay inside; splitting them out is a later call. |
| Branch plan changes | How plan edits wait for a branch | Pending-change records. It applies them through Plan structure's own editors (4.30), so it is not a second writer. | Pass |
| Work (parent) | Its entry file's promises only | None | Pass (32.1) |
| Arcs and increments | The lifecycle of arcs and increments | Arc and increment records, except the wait fields | Pass |
| Waits | Wait rules. `wait-writes.ts` moves in, so the commands that write a wait sit with the wait's reader. | The wait and hold fields | Pass. 10.32–10.34 and 10.36–10.38 move in. |
| Owner exchange | How storytree and the owner talk | Question, FYI and feedback records | This merge is the weakest D1 call in the tree, because questions, FYIs and feedback could change apart. |
| Health record | Health semantics | Health entries | Pass |
| Knowledge (parent) | Its entry file's promises only | None | Pass (33.1) |
| Notes | Knowledge kinds and the note tools | Note records | Pass. 17.2 moves in. |
| Ranked search | How search ranks | Vector caches | Pass |
| Decisions | The decision register: numbering, supersession, corrections, front covers | Decision records | Pass. 9.3 (artifacts link only to artifacts) goes to Links instead. |
| The librarian and its 4 children | Unchanged | Unchanged | Unchanged |
| Library API | Generic reads and the public surface: get, list, history, the change feed, naming and linking | None after the move. Its feedback, FYI, plugin-record and media writes move to their owners. | Pass after 7 contracts are rehomed |
| Library commands | The library's own command family | None. It writes through the API. | Pass |
| Command schema | How any verb is declared | None | Pass |

## Measured readings, beside the baseline

All readings come from `storytree code-measures tree` at origin/main 05551726. They are report only (ADR-1367).

| Reading | Baseline | Proposal 3 |
|---|---|---|
| Capabilities: total, top level, nested | 30, 12, 18 | 27, 9, 18 |
| TurboMQ (random mean / 95th percentile) | **1.31** (0.52 / 0.70) | **1.18** (0.60 / 0.77) |
| TurboMQ over the random 95th percentile | 1.87× | 1.54× |
| Co-change inside groups (random 95th percentile) | **17.1%** (14.9%) | **20.0%** (20.2%) |
| Pairs at support 5 or more; how many have lift 2 or more | 24; 7 | 27; 10 |
| Sibling cycles: members of each | 8 at the top, 3 under Project storage, 2 under Questions and work (13 in all) | 8 at the top, 5 under Storage (13 in all) |
| Depth 1: nodes, sibling edges | 12, 44 | 9, 34 |
| Depth 2: nodes, sibling edges | 18, 19 | 18, 21 |
| Boundaries; type crossings; distinct types cut | 103; 441; 213 | 112; 449; 215 |
| Guidance leads | 4 | 7 |

What the numbers say:
- **Common Closure is weaker than the plan's own.** The grouping still beats chance on TurboMQ, but by less than the baseline does. The share of co-change inside groups sits at chance.
- **The top level is less tangled.** Depth 1 has 3 fewer nodes and 10 fewer sibling edges, about 3.8 edges per node against 3.7, so the density is about the same.
- **The cycles do not move.** The top-level 8-node cycle is there in both trees, because Library API is the facade every part imports and that imports every part. Re-cutting the tree from intent cannot remove that cycle.
- **Two cycle members come from one move.** Moving `schema/plugin-kinds.ts` into Plugin kinds makes Record schema and Plugin kinds import each other. Leaving that file in Record schema scores 3 cycle members under Storage instead of 5.

## Guidance: judgements, not readings

The scorer's leads (lift 2 or more across top-level groups), each with how this proposal reads it:
- **Plan structure with Work (lift 4.72).** Mostly the scorer's artifact. `work/index.ts` re-exports `work-model.ts` today, and the scorer can give a file to only one node. After the refactor, `plan/index.ts` takes those exports, so this pair largely dissolves. The rest is real: landing an increment applies plan changes.
- **Library API with Work (3.17), Transactions (2.38) and Rounds (2.55).** These run through the facade hub. research_8e072046897e section 3 warns that hub leads are weaker than they look.
- **Library commands with Notes (2.88) and with Ranked search (3.01).** Commands that read notes change with notes. Strict top-down would dissolve Library commands into its owners, which costs more but would remove these leads. It is left as the refactor session's option.
- **Owner exchange with Record schema (2.13).** New question fields land in the schema. This is the same doubt Record schema raises under D2.

## Refactor cost estimate

All counts are measured except the contract moves, which are a judgement.

- **Files moved.** 110 of the library's 152 files move: 62 of 87 source files and 48 of 65 tests (full list in `moves.txt`). The `project/`, `data/` and `decisions/` folders empty out, and `schema/` and `transactions/` move whole under `storage/`.
- **New entry files.** 12 new entry files: `plan/` and `plan/structure/`, `plan/branch-changes/`, `storage/{projects, connections, factory-circle, plugin-kinds}/`, `work/{increments, waits, owner-exchange}/`, and `knowledge/{notes, search}/`.
- **Other packages.** No importer outside the library changes. Five targets in the package's exports map move (whole-words, pr-cutover, connection-error, reads, outside-writer), but their specifiers stay the same.
- **Code to split.** Two files must be cut in two: `work/index.ts`, between the Plan and Work entries, and `api/library.ts`, whose feedback, FYI, plugin-record and media methods move behind their owners while the facade keeps calling them.
- **Shared types newly cut: 15, on 7 boundaries.**
  - Branch plan changes → Plan structure: CapabilityNode, EdgeNode, ProjectTree, StoryNode.
  - Library commands ↔ Notes: Found, NoteRead, NoteToolContext, Presenter, HeldClaim.
  - Record schema ↔ Plugin kinds: PluginRecordKind, PluginUpgradeStep, LibrarySchema, UpgradeStep.
  - Plan structure → Arcs and increments: PrCutover.
  - Arcs and increments → Waits: WaitWrite.
- **Shared types no longer cut: 20, on 3 boundaries.** 16 between Decisions' entry and the decision log, and 2 between corrections and decisions, both because the three merge. 2 between Work in flight and Waits.
- **Contracts rehomed: 54 of 415. None is retired.**
  - 28's 16 → Connections.
  - 27's 6 → Library commands.
  - 22's 2, 31's 1 and 9.1 → Decisions; 9.3 → Links.
  - 4.28–4.36 (9) → Branch plan changes.
  - 7.18, 7.19, 7.23, 17.10, 10.39 and 10.40 → Owner exchange.
  - 7.21, 7.22 and 7.24 → Plugin kinds.
  - 7.26 and 17.18 → Project libraries.
  - 17.2 → Notes.
  - 10.32–10.34 and 10.36–10.38 → Waits.
- **Contracts to write.** One new contract for The plan's entry file.
- **Capabilities.** 5 are folded into others (28, 27, 22, 9, 31) and 2 are new (The plan, Branch plan changes). The rest keep their ids, about half of them under a new title. Each file's capability header changes wherever its capability does.
