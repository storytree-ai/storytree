# Redone tree proposal 3: the library cut top-down from story intent, nested domain-first

This is one of three redone tree proposals for the library story (story_754e87e7d531) on arc_c465ed702824. It is increment_631ee296b2fa, ordered by ADR-1403. It follows the direction in ADR-1403 D1 and D2: domain-first nesting, deep modules, no cycle among siblings at any level, and the shared schema split per domain. It is a proposal only. No capability in the plan changed, and no code moved.

**To review it on the laptop, open `tree.svg` in a browser.** It shows today's tree on the left, coloured by the domain each capability goes to, and this proposal on the right, with what each part is made from today.

The other files:
- `tree.json` is the proposed tree in the scorer's format. Grade it with `storytree code-measures tree story_754e87e7d531 --tree docs/design/library-tree-redo/proposal-3/tree.json`.
- `scorecard.txt` is the scorer's full output for this tree on today's code. `baseline-scorecard.txt` is the same for today's tree.
- `scorecard-after-edits.txt` is the scorer's output for this tree after `import-edits.sh` runs on a throwaway checkout. The script changes the import and export lines the refactor would change (see "The edits the refactor makes").
- `moves.txt` lists every file the refactor would move.

## The rule set

- **Top level.** Each top-level capability is one reason a person or program comes to the library. They are cut from the story's sentence: "Where one project's records live, how they are stored and how they are kept honest: the plan of work, how healthy each piece is, and what the project has learned."
- **Inside a domain.** Each child holds one design decision likely to change. A technical piece sits in the domain it serves: each kind's record shape, each domain's tools and helpers.
- **Dependency is fine inside a domain** (ADR-1403 D1). A single source of truth that several parts read stays one part. Nothing is duplicated to decouple.
- **No sibling cycle at any level** (ADR-1399 D4). Where today's imports make one, the cut names the code change that removes it, and the scorer checks the result.
- **Nesting** stands where the refactor gives a folder with its own entry file (ADR-1377 D2).
- **Disclosure.** Before cutting, I read my predecessor's report (research_564908f6269d) and its folder (`docs/design/library-tree-proposals/top-down/`), as the brief allowed, and today's tree and code. I did not read the other two redo increments, their branches or their results. I read the scorer's numbers after cutting. I made one change after scoring: I moved decision corrections and supersession from Decisions up to Knowledge, because they edit notes and decisions together and the gate showed the cycle that caused. I did not tune the tree to a number after that. The leads below stay as the scorer gave them.

## The tree (31 capabilities: 8 at the top, 23 nested)

The top level reads as a stack. Each domain imports only the domains above it in this table, once the edits below are made. The scorer's levels confirm it: Records 1, The plan and Knowledge 2, Work 3, Health record 4, Library API 5, Library commands and The librarian 6.

| Domain: why someone comes | Children (the design decision each hides) | Folder after the refactor | From today's plan |
|---|---|---|---|
| **Records**: keep a project's records whole and reachable | Record kinds (the record envelope, versions and upgrades, reference checks, plugin kinds) · Transactions (the write path, two engines) · Project libraries (tables, naming, snapshots, the record cache) · Connections (reaching a server: address, TLS and websocket, server access, reads) · Factory circle (which library a project reads through its factory) · Outside writers (fenced roles for a plugin's writers) | `records/{kinds, transactions, libraries, connections, factory-circle, outside-writers}/` | 34 › 3, 2, 1, 15 + 28, 29, 30 |
| **The plan**: say what will be built | Plan structure (stories, capabilities, contracts, edges, the anchor, plugin plans, PR cut-over, the code survey's shapes) · Branch plan changes (plan edits held for a branch, applied when it lands) | `plan/{structure, branch-changes}/` | new › 4, split in two |
| **Knowledge**: keep and find what the project learned and decided | Notes (the note kinds, front covers, memory upgrade, a process's schedule) · Ranked search (embeddings, likeness, whole words) · Decisions (the decision log) · and, on Knowledge's own entry, decision corrections and supersession, which edit notes and decisions together | `knowledge/{notes, search, decisions}/` | 33 › 6 + 9, 14, 31 + 13; 22 |
| **Work**: track what is being built and what holds it | Arcs and increments (with plan hold) · Waits (with wait writes) · Owner exchange (questions to the owner) | `work/{increments, waits, owner-exchange}/` | 32 › 10, 11, 12 |
| **Health record**: say how healthy each part is | (none) | `health/` | 5 |
| **Library API**: program against one project's library | Opening a project (opening and wiring a project's domains) · Data questions (counts, recent changes, title hits) | `api/{opening, data-questions}/` | 7 › new from 1, 27 |
| **Library commands**: drive the library from a command line or tool | Command declarations (any storytree command, declared once for every door) · Knowledge commands (notes, ranked, stale edits, elsewhere, `adr`) · Record and owner commands (media, FYI, data questions) | `commands/{declarations, knowledge, records}/` | 17 › 16, new, new |
| **The librarian**: keep the library honest | Links · Catalogue · Graduation · Rounds (unchanged) | `librarian/…` (unchanged) | 35 › 21, 23, 24, 26 |

### The schema, split per domain (ADR-1403 D2)

Today one file, `schema/types.ts` (836 lines), holds every kind's shape. In this proposal each domain owns its kinds' shapes, versions and upgrade steps in its own `schema.ts`:
- The plan: anchor, story, capability, edge, contract, pin, PR cut-over (about 76 lines).
- Work: arc, increment, question, prediction, feedback, FYI (about 195 lines).
- Health record: health (18).
- Knowledge › Notes: definition, principle, guardrail, pattern, process, agent, friction, resteer, techstack, check, research, experiment, escape, drill, measure (about 258).
- Knowledge › Decisions: decision, decision numbering (about 65).

The upgrade steps go with them: arc, capability, decision, friction, and increment's two.

Record kinds keeps what every kind shares: the envelope, version checks, the upgrade machinery, plugin kinds, and the `RecordKinds` type each domain adds its kinds to (TypeScript declaration merging, so the type arrow points from each domain to Records). Opening a project puts the parts together into the registry the library is opened with, as it already does with plugin kinds.

No downstream part gains from the kinds being joined. No package outside the library reads `RECORD_SCHEMAS`, `SCHEMA_VERSIONS` or `LIBRARY_SCHEMA`. Inside it, only three things read the whole registry: the opening, which builds it; the API's `naming`, which lists every kind; and memory upgrade, which reads only its own knowledge kinds.

### Deep modules: the entries and the deletion test

Each node is a folder whose entry file is its interface. The deletion test asks, for each boundary: if this part were deleted, would its complexity vanish, or would it reappear in every caller?
- **Records** passes the test. Its entry offers 19 names against 182 behind it, the deepest entry in the tree. Deleting it would scatter connection, transaction and snapshot handling into every domain.
- **Record kinds** passes. 40 names against 57; every domain stands on it, and it is the single source of truth this proposal keeps whole on purpose.
- **Transactions** passes. 30 against 52; two engines behind one interface.
- **Connections** passes. It joins 15 and 28, because how a server is reached (address, TLS, websocket, pool waits, byte counts) is one decision. Split, each half re-imports the other.
- **The plan** passes, but narrowly. It is a new parent whose entry must say its promises: one new contract. Without it, Plan structure and Branch plan changes would be top-level siblings, and a reader would lose that both are "the plan".
- **Knowledge** passes. 42 against 101; its entry is the one door to notes, search and decisions. Corrections and supersession sit on the entry because they edit across two children.
- **Work** is shallower: 88 names against 102. Today its entry also re-exports the plan, and the refactor moves those 30-odd names to `plan/index.ts`.
- **Library API is the one wide interface: 187 names against 29.** It is a facade, wide by design, because programs reach every domain through it. Its depth is in its two children. A facade fails the deletion test by nature: delete it, and each program imports the domains directly. That is the trade the library already chose.
- **Library commands** is a door, not a domain. It sits above the API because every command takes the whole library through `VerbContext`. Putting a domain's commands inside that domain would make each domain import the API, which imports the domain: the cycle ADR-1399 D4 forbids. Inside the door, the commands are nested by the domain they serve.
- **Single-file children are deep or dropped.** Outside writers keeps its own capability: it holds 7 contracts and a security boundary. Owner exchange holds 18 contracts. Every child with one file guards a decision worth its own contracts.

### The three boundary tests (ADR-1242), per capability: judgements

| Capability | D1: one reason to change | D2: owns its records | D3: claim-sized contracts |
|---|---|---|---|
| Records (parent) | Its entry's promises | Writes nothing itself | 1 contract (34.1) |
| Record kinds | How a record is shaped, versioned and upgraded | None of its own once the shapes are split | Passes: 22 less the 7 that go with their kinds |
| Transactions | The write path | History and the envelope | Passes (26) |
| Project libraries | How a project's database is made, copied and cached | The project's tables and media | Passes: 19 less the 8 opening contracts |
| Connections | How a server is reached | None (connections are not records) | Passes: 6 + 16 |
| Factory circle | How a product reads through its factory | A product's copies of system records | Passes (7) |
| Outside writers | Who may write from outside | Fenced roles | Passes (7) |
| The plan (parent, new) | Its entry's promises | None | 1 new contract |
| Plan structure | The plan's shape and its editors | Stories, capabilities, contracts, edges, anchor, pins | Passes: 54 less 12 |
| Branch plan changes | Edits held for a branch | Pending changes | Passes (9) |
| Knowledge (parent) | Its entry, plus correcting and superseding decisions | Corrections' annotations | 1 + 2 + 2 |
| Notes | The note kinds and their writes | Every knowledge kind | Passes: 24 less 2, plus 9's 2 |
| Ranked search | How notes are ranked | Embeddings | Passes: 18 + 2 |
| Decisions | The decision log | Decisions, numbering | Passes: 1 + 15 from 13 |
| Work (parent) | Its entry's promises | None | 1 (32.1) |
| Arcs and increments | Increments' lifecycle | Arcs, increments | Passes: 34 less 6, plus 3 from 4 |
| Waits | What holds work | Waits on increments | Passes: 6 + 6 |
| Owner exchange | What the owner is asked | Questions | Passes (18) |
| Health record | Reported and verified health | Health | Passes (36) |
| Library API (parent) | The facade's surface | None | Passes (22) |
| Opening a project | How a project is opened and its domains wired | None | 8 from 1 |
| Data questions | The fixed questions over every kind | None | 6 (27) |
| Library commands (parent) | The library family's verbs | None | About 20 of 17's 36 |
| Command declarations | How any command is declared | None | 4 (16) |
| Knowledge commands | The note, search and `adr` verbs | None | About 14 from 17, 6 from 13 |
| Record and owner commands | The media, FYI and data verbs | None | 2 from 17 |
| The librarian, Links, Catalogue, Graduation, Rounds | Unchanged | Unchanged | Unchanged |

The weakest call is **Library commands**. Strictly top-down, each domain would hold its own commands; the cycle rule holds them in one door instead. The scorer's leads below show what that costs.

## The edits the refactor makes (and that the scorer was run on)

The cut alone leaves one cycle, at the top level, through 7 domains. It comes from five places where code below imports code above. The refactor fixes each one, and `import-edits.sh` changes those same import and export lines in 12 files:
1. **Records' entry stops re-exporting the opening** (`connect` and its option types). Connections takes `ConnectOptions` from its own `server.ts`, not from the opening.
2. **The schema split** (above). Record kinds no longer imports a process's schedule or the plan's survey shapes.
3. **The record cache stops naming Knowledge's `VectorDomain`.** It keys on a plain identity string.
4. **Decision corrections and supersession take their own port** (the four library methods they use), not the whole `Library`. They move up to Knowledge's entry.
5. **`adr` leaves the Decisions entry** for Knowledge commands.

With those edits, the gate passes at every level. The same edits on today's tree leave it failing at all three levels (13 members), and on my predecessor's tree they leave it failing at three. So the cut and the edits do the work together.

## Graded on the scorecard

Read on origin/main 1192a033, with increment_abc46882a433's readings. Co-change comes from main's merges, so it does not change with the edits.

| Reading | Today | Proposal 3, as cut | Proposal 3, after the edits | Today, after the same edits |
|---|---|---|---|---|
| Cycle gate | fails at 3 levels (13 members) | fails at the top only (7) | **passes** | fails at 3 levels (13) |
| Meet depth (imports meeting at depth 0 / 1 / 2) | 108 / 117 / 29 | 113 / 84 / 57 | 104 / 87 / 57 | 111 / 108 / 29 |
| Sibling imports landing on the sibling's entry | 81 of 143 (56.6%) | 49 of 149 (32.9%) | 46 of 140 (32.9%) | 79 of 144 (54.9%) |
| Depth 1: nodes, sibling edges | 12, 44 | 8, 22 | 8, 17 | 12, 45 |
| Depth 2: nodes, sibling edges | 18, 19 | 23, 18 | 23, 18 | 18, 19 |
| Split candidates (a consumer importing under a quarter of a dependency's names) | 67 | 69 | 60 | 71 |
| Top-level technical names | 2 ("Data schema", "The command schema") | none | none | 2 |
| Boundaries; type crossings | 103; 441 | 105; 464 | 97; 421 | 106; 412 |
| TurboMQ (random 95th percentile) | 2.65 (0.94) | 2.00 (0.99) | 2.00 | 2.63 |
| Co-change inside groups (random 95th percentile) | 28.5% (12.8%) | 33.3% (26.3%) | 33.3% | 28.4% |

What each reading shows:
- **Cycles.** Of the trees graded here (today's, my predecessor's and this one), this is the only one that passes the gate. It passes once 12 files' import and export lines change, and no code is duplicated.
- **Meet depth.** Twice as many imports meet two levels down: 57 against 29. More of the coupling is between siblings inside a domain, where ADR-1403 D1 says it is fine. Fewer imports cross at the top: depth 1 holds 84 to 87 against 117.
- **Entries.** This reading is worse today, and that is expected. Most of the new child folders have no entry file yet, because the refactor writes them (the scorer lists 8 imported siblings with none), so imports land on a file behind each one. After the refactor every nested folder has an entry, and this share should rise. It is the reading to re-measure.
- **Top level.** Eight domains with 17 sibling edges, against 12 with 44. Nothing at the top is named for a technical layer.
- **Common reuse.** The split candidates drop from 67 to 60 after the edits. Most of those left are a part taking a handful of names from Record kinds or the Library API's facade, which is what a single source of truth and a facade look like.
- **Shared types.** This tree cuts more types than today's on today's code (464 against 441). After the edits it cuts 421, against 412 for today's tree with the same edits: about 9 more. Most of those are the types the schema split will carry (FieldsOf, SchemaRecord, WriteOptions), and the split puts each kind's types inside its own domain. The scorer cannot see a split file, so this is a judgement.
- **Co-change.** Both trees group far above chance. TurboMQ is lower here (2.00 against 2.65). The share of co-change inside groups is higher (33.3% against 28.5%), but so is its random baseline, because the groups are bigger. The leads say which pairs still change together across a boundary.

## Guidance: the scorer's leads, with how I read them

- **Factory circle with Opening a project (lift 12.9, support 5).** This is the strongest pair. Opening a project is where the factory circle is wired, so the two change together. The refactor session may nest Factory circle under Opening a project. That would also need Records' entry to stop re-exporting the factory's types. I did not move it to chase the number.
- **Knowledge commands with Decisions (5.8), Knowledge (5.4) and Notes (4.1).** This is the cost of the commands door: a note's verb changes with the note. It is the strongest argument for commands living in their domains. That needs `VerbContext` to hand each verb its domain's own service instead of the whole library. `VerbContext` is used by every command family in the repository, so that is a cross-story change, not this refactor.
- **Plan structure with Work (3.8).** This is mostly the scorer's artifact. `work/index.ts` re-exports the plan today, and the refactor moves that to `plan/index.ts`. The rest is real: landing an increment applies its plan changes.
- **Library API with Work (3.0), Rounds (2.7), Transactions (2.5), Decisions (2.3) and Knowledge (2.2).** These run through the facade, which changes whenever any domain's surface does. research_8e072046897e section 3 warns that hub leads are weaker than they look.

## Refactor cost estimate

File counts are measured; contract moves are a judgement from the contracts' titles.

- **Files moved: 107 of 150.** That is 59 of 87 source files and 48 of 63 tests, listed in `moves.txt`. The `project/`, `schema/`, `transactions/`, `decisions/`, `data/` and `verbs/` folders empty out.
- **New entry files: 18.** One each for `plan/`, `plan/{structure, branch-changes}/`, `records/{kinds, transactions, libraries, connections, factory-circle, outside-writers}/` (kinds and transactions reuse today's `index.ts`), `work/{increments, waits, owner-exchange}/`, `knowledge/{notes, search}/`, `api/{opening, data-questions}/` and `commands/{declarations, knowledge, records}/`.
- **New schema files: 5,** one per domain's kinds. `schema/types.ts` and `schema/upgrades.ts` are cut into them.
- **Other packages.** No importer outside the library changes. Six targets in the package's exports map move (`verbs`, `whole-words`, `pr-cutover`, `connection-error`, `reads`, `outside-writer`), but their specifiers stay the same.
- **Code to split: 4 files.**
  - `schema/types.ts` and `schema/upgrades.ts` go per domain.
  - `work/index.ts` is shared between the Work and Plan entries.
  - `project/index.ts` gives its opening exports to the API.
- **Code to change: 4 changes.**
  - Corrections and supersession take a port of four methods.
  - The record cache keys on an identity string.
  - `ConnectOptions` moves to Connections.
  - Records gains the `RecordKinds` type the domains extend.
- **Shared types.** On today's code, the edits leave 421 type crossings on 97 boundaries, against 441 on 103 today. The schema split then moves each kind's FieldsOf use inside its own domain. The new cuts that remain are:
  - Branch plan changes → Plan structure (CapabilityNode, EdgeNode, ProjectTree, StoryNode);
  - Arcs and increments → Branch plan changes (the pending-change types) and → Waits (WaitWrite and the hold types);
  - Health record → Plan structure (the plan tree's node types).
- **Contracts rehomed: about 94 of 416. None is retired.**
  - 3's 7 kind contracts: 3.11, 3.14, 3.21 and 3.22 → Plan structure; 3.10, 3.12 and 3.13 → Notes.
  - 4's 12: 4.28–4.35 and 4.50 → Branch plan changes; 4.36, 4.55 and 4.56 → Arcs and increments.
  - 6.10 and 6.11 → Ranked search. 9's 2 → Notes.
  - 10.32–10.34 and 10.36–10.38 → Waits.
  - 13's 23 → Decisions (15), Knowledge (13.12, 13.13) and Knowledge commands (13.10, 13.16, 13.17, 13.25, 13.27, 13.28).
  - 22's 2 → Knowledge. 28's 16 → Connections.
  - About 8 of 1's (opening, listing, dropping and closing: 1.1–1.4 and 1.10–1.13) → Opening a project.
  - About 16 of 17's 36 → Knowledge commands (about 14) and Record and owner commands (17.10, 17.18).
- **Contracts to write: 1,** for The plan's entry file.
- **Capabilities.**
  - 4 are folded: 28 into 15, 9 into 6, 13 into 31, and 22 into 33.
  - 5 are new: The plan, Branch plan changes, Opening a project, Knowledge commands, and Record and owner commands.
  - The rest keep their ids, some under a new title or parent: 34 Records, 3 Record kinds, 15 Connections, 29 Factory circle, 6 Notes, 33 Knowledge, 32 Work, 12 Owner exchange, 27 Data questions, 16 Command declarations (now under 17).
  - Each moved file's capability header changes.
