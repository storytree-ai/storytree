# Redone tree proposal 1: the library grown from co-change, nested domain-first

**Open [tree.svg](tree.svg)** in a browser (a PNG of it is linked from the pull request): today's tree on the left and this
proposal on the right. The tree file is [tree.json](tree.json).

This redoes proposal 1 (increment_65748d511b31, research_be14d51681a2) for increment_4df1fe91aea3, under
ADR-1403. It was made without looking at the other two redone proposals. It is a proposal only: no
capability in the plan changed and no code moved.

**What it proposes.** The library becomes 8 domains with 21 capabilities, down from 30 capabilities
(12 at the top). Each domain is one folder behind one small entry file. Things that change together sit
inside one domain. Within that, related concepts nest. The one shared schema is split: each domain holds
its own record schema (the plan's, work's, knowledge's, decisions', health's), and only the generic part
stays shared: a valid, versioned record that refers to live records.

| Domain | Inside it | Made from today's |
|---|---|---|
| **Records** | Transactions; Valid records | 2, 3, and references from 7 |
| **The plan** | (one capability: stories, capabilities, contracts, edges, anchors, the code survey) | 4 |
| **Work** | Work in flight (arcs, increments, waits, holds, pending plan changes); Owner questions (with FYIs) | 32, 10, 11, 12, part of 4, fyi from 17 |
| **Knowledge** | Notes (with the note commands); Ranked search; Decisions; The librarian › Rounds | 33, 6, 9, 14, 31, 13, 22, 35, 21, 23, 24, 26, note commands from 17 |
| **Health** | (one capability) | 5 |
| **Projects** | Opening a project; Reaching a shared library | 34, 1, 29, 15, 28, 30 |
| **Commands** | Command kit; Fixed data questions | 17, 16, 27 |
| **The library's front door** | (the package root and the Library interface) | 7 |

**How it was grown.** Every pull request since 2026-10-26 that touched the library's source (190 of
them, with sweeps over 30 files dropped and renames followed to today's paths) was read for which files
land together, by lift at support 5 or more. Each strong pair became one capability or one domain. The
domains were then named by what they are about, and the weak or absent pairs were placed by concept and
by the deletion test.

## Each move, and its evidence

Lift is how much more often two files land together than chance; support is how many pull requests
they land together in.

| Move | Evidence |
|---|---|
| **Transactions and the record shape share one domain, Records** | `schema/records.ts` with each transactions file: lift 13.6 to 15.1, support 5 to 6. They stay two nested capabilities: `records.ts` holds Data schema's validation and version contracts (3.1 to 3.9), and the store hides its own work behind a 21-line entry |
| **The shared schema splits per domain** | `schema/types.ts` lands in 40 pull requests, together with the plan's files in 11, work's in 8, health's in 7, knowledge's in 7 and decisions' in 4, at chance lift with each. That is the pattern of a file every domain edits for its own reason. ADR-1403 D2 asks for the split, and no downstream part gains from the schemas being joined: no file reads more than its own domain's kinds, apart from the front door, which composes them all anyway |
| **References move from Library API into Valid records** | `references.ts` and `creation-order.ts` are read by 12 files across every domain. They are about records, not the front door, and taking them out removes most of the "import the front door for one helper" edges |
| **Pending plan changes and plan holds join Work in flight** | An increment carries them until its branch lands, and `work-in-flight.ts` already calls them. `plan-hold.ts` reads `WorkInFlight`, so in Work model it made the Work model ↔ Work in flight cycle. `pending-changes.ts` with `plan-hold.ts`: lift 17.8, support 3 (weak); with `work-in-flight.ts`: lift 4.1, support 3 (weak). This also answers ADR-1242 D2's note that Work in flight writes plan records through pending changes: it now owns them |
| **Waits merge into Work in flight** | `waits.ts` with `work-in-flight.ts`: lift 5.4, support 7; `wait-writes.ts`: lift 4.8, support 8 |
| **The plan leaves Questions and work for the top** | With Work in flight it is at chance (lift 0.8). It imports nothing from Work, while Work imports it |
| **The note commands move into Notes** | `commands/ranked.ts` with `knowledge.ts`: lift 11.9, support 7; `commands/notes.ts`: lift 5.6, support 8; the two with each other: lift 9.6, support 6. Decisions already owns its own commands (`adr.ts`) |
| **Decision log, Decision corrections and Decisions become one capability** | `corrections.ts` with `adr.ts`: lift 13, support 6; `decision-log.ts` with `decisions/index.ts`: lift 19.8, support 5 |
| **Decisions nests in Knowledge** | `decision-log.ts` with `knowledge.ts`: lift 8.9, support 6; `decisions/index.ts` with `knowledge.ts`: lift 9.9, support 5 |
| **The librarian nests in Knowledge, and Links, Catalogue and Graduation fold into it** | Concept: the librarian tends notes and decisions. Each of the three has an entry exporting every name behind it (5 of 5, 5 of 5, 9 of 9) and under 120 lines, so it fails the deletion test. Rounds stays nested: about 330 lines behind a 5-line entry |
| **Knowledge entrances folds into Notes** | `front-covers.ts` is 19 lines: it fails the deletion test |
| **Factory and product merges into Opening a project** | `factory.ts` with `storytree.ts`: lift 12.2, support 5; `switches.ts`: lift 14.6, support 3 |
| **Connection by address, Shared server and Outside writers become one: Reaching a shared library** | They are only reached together; `outside-writer.ts` with `connection-error.ts`: lift 31.7, support 2 (weak). `server.ts` moves in from Project libraries, since Shared server's tests (28.1 to 28.15) already drive it (ADR-1242 D3) |
| **The command schema becomes Command kit, nested in Commands with Fixed data questions** | The verb shape and the helpers every command family shares (`elsewhere.ts`, `stale-edit.ts`), with no technical word left at the top level. Fixed data questions nests by concept (weak co-change) |
| **FYIs go to Owner questions** | The fyi family records what the owner should know; it lands in a pull request alone, so concept places it |

**Kept as they are.** Health (753 lines behind a 30-line entry), Ranked search, Transactions and the front
door. Every capability is a single source of truth for its siblings where several read it: Valid records
for every domain, Command kit for every command family, Ranked search for notes and decisions. ADR-1403 D1
says this dependency is good, so none of them was cut to lower coupling, and no code is duplicated.

## Scorecard: what each reading shows

Read by `storytree code-measures tree story_754e87e7d531 [--tree tree.json]` at origin/main 1192a033.
The full outputs are [scorecard-today.txt](scorecard-today.txt) and
[scorecard-proposal.txt](scorecard-proposal.txt). The scorer reads today's code, so a file the refactor
splits (`schema/types.ts`, the command registry) or an entry file it creates does not show yet. Each
reading below says where that matters.

| Reading | Today | Proposal 1, redone |
|---|---|---|
| Capabilities; at the top; deepest level | 30; 12; 2 | 21; 8; 3 |
| Sibling import edges: depth 1 / 2 / 3 | 44 / 19 / – | 26 / 8 / 0 |
| Meet depth: imports whose ends meet at the top / one domain down / two / three | 108 / 117 / 29 / – | 109 / 55 / 85 / 5 |
| Sibling imports landing on the sibling's entry | 81 of 143 (56.6%) | 69 of 124 (55.6%) |
| Common reuse, mean share over nodes | 0.32 | 0.67 |
| Split candidates (a consumer using under a quarter of a dependency) | 68 of 103 pairs | 57 of 79 pairs |
| Cycles among siblings | 3: the top (8 nodes), Project storage (3), Questions and work (2) | 3: the top (6 nodes), the top (The plan, Records), Projects (2) |
| Top-level technical names | 2: Data schema, The command schema | none |
| Boundaries with imports; type names crossing them | 103; 441 | 79; 430 |
| TurboMQ of top-level groups | 2.65 (random 95th percentile 0.94) | 2.14 (random 95th percentile 0.99) |
| Co-change inside top-level groups | 28.5% (random 95th percentile 12.8%) | 36.4% (random 95th percentile 25.4%) |

**Meet depth.** The imports that cross between domains hold steady at about 109. They are not the
tree's to remove: 56 of them go into Records (one record type and its references, which every domain
reads on purpose, ADR-1403 D1), and 11 go from Knowledge to the front door for the `Library` type.
What changes is inside the domains: 90 imports now meet two or three levels down, against 29 today. So
related code sits deeper together, which is the domain-first shape the redo asked for.

**Narrow sibling entries.** About the same as today (55.6%). The misses are mostly imports into Records
that reach `transactions/index.ts` or `references.ts` directly, because today Records has no entry of its
own beyond `schema/index.ts`. The refactor's `records/index.ts` re-exports both, which would close 34 of
the 55 misses. The entry-size reading only means something once those entry files exist. Today most
nested parts have none, so the scorer takes their main file as the entry.

**Common reuse.** Mean share doubles. The remaining split candidates are almost all consumers of Records
(7 to 11% of its 57 names) and of the front door (2 to 6% of its 190). The Records ones are what the
per-domain schema split removes: a domain's code imports `FieldsOf` and its own kinds, and those leave
the shared entry. The front door ones are the `Library` type, below.

**Cycles.** None is inside a domain any more: the cycle under Questions and work is gone. Three remain,
each resting on today's code in a way the refactor removes:
1. *The top level: front door, Knowledge, Commands, Work, Health, Projects* (8 nodes today, 6 now).
   Every command module takes the whole `Library` from the package root, and the root composes every
   domain. The refactor gives each command family the narrow interface it reads (a port its own domain
   declares, which `Library` satisfies). It also moves the holding-lines helpers (`HeldClaim`) out of the
   command registry into the kit. Any tree inherits this cycle until that is done. Today's tree has it too.
2. *The plan and Records.* One barrel edge: `schema/index.ts` re-exports `story-survey.ts`. The refactor
   re-exports it from the plan's own entry.
3. *Opening a project and Reaching a shared library.* One type: `address.ts` and `outside-writer.ts`
   import `ConnectOptions` from `storytree.ts`. The refactor moves that type to `address.ts`.

**Top-level technical names.** None: "Data schema" and "The command schema" are gone. Each domain holds
its schema part, and the command kit sits inside Commands.

**TurboMQ and co-change inside groups.** Both stay well beyond chance. Inside share rises (28.5% to
36.4%) because more of what lands together now sits in one domain. TurboMQ falls (2.65 to 2.14) because
it rewards many small clusters, and there are fewer, larger domains. Neither reading decides on its own
(ADR-1403 D3). The scorer's remaining leads: The plan with Records (lift 4.1), the barrel above; The plan
with Work (3.83), `work/index.ts` re-exporting the plan's model, which ends when the plan gets its own
entry; the front door with everything, a facade that changes with what it composes. None argues for a
merge.

## The deletion test, boundary by boundary

Imagine deleting the boundary. Does complexity vanish (a pass-through), or reappear in several callers
(it earns its keep)?

| Boundary | Verdict |
|---|---|
| Records › Transactions | Keep: about 1,800 lines (memory and Postgres twins, the behaviour suite) behind a 21-line entry; 9 domains' code would otherwise reach into pg |
| Records › Valid records | Keep: validation, versions, upgrades and references, read by every domain |
| The plan | Keep: about 1,000 lines behind one model interface; 54 contracts |
| Work › Work in flight; Owner questions | Keep both: each hides about 300 to 1,500 lines behind its interface (`WorkInFlight`, `OwnerQuestions`) |
| Knowledge › Notes; Ranked search; Decisions | Keep: notes hide about 1,400 lines; search hides the embedding model behind a few calls; decisions about 1,100 lines |
| Knowledge › The librarian | Keep, once Links, Catalogue and Graduation are inside it; each of those three alone fails |
| The librarian › Rounds | Keep: about 330 lines behind 5 |
| Knowledge entrances (today 9) | Fails: 19 lines, folded into Notes |
| Health | Keep: 753 lines behind 30 |
| Projects › Opening a project; Reaching a shared library | Keep: opening hides the cache, snapshots and the factory; reaching hides TLS, websockets and the server process behind `addressServer` and `localServer` |
| Commands › Command kit; Fixed data questions | Keep: the kit is the one shape every family uses; data questions hide the SQL |
| The library's front door | Keep: it is the story's interface (ADR-1343) |

## ADR-1242's three tests

One reason to change (D1), owns the records it writes (D2), contracts sized to a claim (D3). Unchanged
capabilities keep today's standing.

| Capability | D1 | D2 | D3 |
|---|---|---|---|
| Records (new parent) | passes: keeping records | passes | passes: holds no contracts of its own |
| Valid records (3 + references) | passes: what makes a record valid | passes | passes once domain schema contracts leave (below) |
| The plan (4 without pending changes) | passes | passes | passes |
| Work in flight (10 + 11 + pending changes and holds) | passes: what an increment carries until it lands | better: it now owns the pending changes it writes | passes |
| Owner questions (12 + fyi) | passes: what reaches the owner | passes | passes |
| Notes (6 + 9 + note commands) | passes | better: the commands that write notes sit with their owner | passes once the note-tool contracts move |
| Decisions (13 + 22 + 31) | passes | better: corrections write decisions' annotations from inside | passes |
| The librarian (35 + 21 + 23 + 24) | passes: tending the library | passes | passes |
| Opening a project (1 + 29) | judgement: what a project opens with; the switches ride along | passes | passes |
| Reaching a shared library (28 + 15 + 30 + `server.ts`) | passes: reaching a library on another server | passes | better: its contracts' code moves into it |
| Command kit (16 + helpers) | passes | passes | passes |

## Refactor cost (estimated)

| Measure | Estimate |
|---|---|
| Source files moved between folders | about 76 of 89. Nearly every domain becomes a folder with nested folders (ADR-1377 D2): `records/` (transactions, valid), `plan/`, `work/in-flight/`, `work/questions/`, `knowledge/notes/`, `knowledge/search/`, `knowledge/decisions/`, `knowledge/librarian/rounds/`, `project/open/`, `project/shared/`, `commands/kit/`, `commands/data/`. Almost all are moves with import paths rewritten; `api/` and `health/` stay |
| New files | about 17: 9 entry files for nested parts, 5 domain schema files (plan, work, knowledge, decisions, health), and about 3 port types for the command families |
| Files removed | 3 entry files (links, catalogue, graduation), their contents folded into the librarian |
| Files split | 2: `schema/types.ts` into the five domain schemas plus a generic core; `commands/index.ts` into the registry and the plan and note verbs that move to their domains |
| Test files moved | about 55 of 64, and `commands.test.ts` split with the registry |
| Public exports | 7 export paths repointed in `package.json` (`./verbs`, `./whole-words`, `./librarian`, `./pr-cutover`, `./connection-error`, `./reads`, `./outside-writer`); no other package changes an import |
| Shared types cut | 1 type moved (`ConnectOptions`). `FieldsOf` and the record-kind constants leave the shared entry for their domains. Type names crossing a boundary: 441 today, 430 on today's code, and fewer after the split. The scorer cannot count that until the split exists |
| Contracts rehomed (none retired) | about 80: 43 from the 10 merged capability records (9: 2, 11: 6, 15: 6, 21: 5, 22: 2, 23: 3, 24: 4, 29: 7, 30: 7, 31: 1); about 12 from Work model to Work in flight (4.28 to 4.36, 4.50, 4.55, 4.56: pending changes and holds); about 16 note-tool contracts and 17.10 (fyi) from The library's commands; 8 from Data schema to the domain schemas (3.11, 3.14, 3.21, 3.22 to The plan; 3.10, 3.12, 3.13, 3.19 to Notes). Confirm each when moving |
| Capability records | 10 retired by merging (9, 11, 15, 21, 22, 23, 24, 29, 30, 31), their contracts all rehomed; 1 new (Records); about 12 re-parented or renamed (2, 3, 4, 6, 13, 16, 17, 27, 28, 32, 33, 35) |

It costs more than proposal 1's first round (15 files moved, about 32 contracts). That one only merged
parts within today's layout; this one gives every domain its own folder and entry. It is still almost
all mechanical: moves, import paths and contract homes. The two real code changes are splitting
`types.ts` per domain and giving command families a narrow port in place of `Library`.

## How it was read

- File owners: `storytree map --select capability:<id> --kind file --show --json` for each of the
  library's 30 capabilities, at origin/main 1192a033. 87 owned source files; the two `testing/pg.ts`
  helpers are owned by none, today or here.
- Co-change: origin/main's first-parent merges that touch `packages/library/src` (198), source files
  only, renamed paths followed to today's, merges over 30 library source files dropped: 190 pull
  requests. Pairs ranked by lift; support at least 5 unless marked weak.
- Imports: each source file's relative imports, for the cycle and placement checks; the scorer's own
  import reading for every number in the scorecard.
- The scorer: `code-measures tree` with increment_abc46882a433's readings, on the plan and on `tree.json`.
  The node fields `was`, `why` and `schema` are notes for the reader; the scorer ignores them.
