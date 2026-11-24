# Tree proposal 1: the library grown from co-change

The first of three blind proposals on arc_c465ed702824 (ADR-1395 D3), increment_65748d511b31. Rule set:
code that lands in the same pull requests goes together (Common Closure), and the hubs (Library API,
Data schema, Library transactions) stay apart unless lift, not raw count, says otherwise. A proposal
only: no capability in the plan changed and no code moved.

**What it finds.** The 2026-11-21 regroup already captured most of the library's change families.
Co-change adds eight local edits: four merges, three re-nests and two cuts. They take the library from
30 capabilities (12 at the top) to 26 (11 at the top). On the scorer as it stands the grouping reads
*worse* than the baseline (TurboMQ 0.98 against 1.31). That comes mostly from two blind spots in the
scorer, measured below; with renames followed and read file by file, the proposal reads a little
better than the baseline. Neither reading shows a big win: co-change is a good tool for small merges,
not for reshaping a tree.

- Picture: [tree.svg](tree.svg) (a PNG of it is linked from the pull request), with the baseline on the left and the proposal on the right.
- Tree file: [tree.json](tree.json). Grade it with `storytree code-measures tree story_754e87e7d531 --tree docs/design/library-tree/proposal-1-co-change/tree.json`.
  Each node lists its files and also carries `was` (the capability numbers it came from), `change` and `why`; the scorer ignores those three fields.

## The tree, as changes to the baseline

| # | Change | Evidence (pull requests since 2026-10-26, renames followed, sweeps over 30 files dropped) |
|---|---|---|
| 1 | **22 Decision corrections merges into 13 Decision log**, and 31 Decisions, left with one child, becomes that one capability (13's record kept) | 13 with 22: support 8, lift 15.4 |
| 2 | **Decisions nests under Notes and search** (renamed "Notes, decisions and search"): `decisions/` moves to `knowledge/decisions/`, keeping its entry file | 13 with 6: support 5, lift 4.5; `decision-log.ts` with `knowledge.ts`: lift 8.8 |
| 3 | **11 Waits merges into 10 Work in flight** | support 7, lift 5.1; `waits.ts` with `wait-writes.ts`: lift 8.8 |
| 4 | **4 Work model leaves Questions and work** and goes to the top level, in a new `plan/` folder with its own entry file | with 10: lift 0.9 (chance). Its one pull to the `work/` entry file comes from that file re-exporting it |
| 5 | **The note commands (`commands/notes.ts`, `ranked.ts`) move into 6 Knowledge artifacts**; the commands' shared helpers (`elsewhere.ts`, `stale-edit.ts`, the holding-lines helpers in `commands/index.ts`) move to 16 The command schema | `ranked.ts` with `knowledge.ts`: lift 12.3 (support 7); `notes.ts` with `knowledge.ts`: lift 5.8 (support 8). ADR-1242 D2: notes' owner owns the commands that write them, as Decisions already owns `adr.ts` |
| 6 | **27 Fixed data questions nests under 17 The library's commands**: `data/` moves to `commands/data/` with a new entry file | weak: support 3, lift 3.0 (research_8e072046897e: confidence 0.80) |
| 7 | **29 Factory and product merges into 1 Project libraries** | support 6, lift 9.3; `factory.ts` with `storytree.ts`: lift 11.9 |
| 8 | **`project/server.ts` moves from 1 to 28 Shared server, and the `ConnectOptions` type from `storytree.ts` to `address.ts`** | not co-change. It breaks the 1–15 cycle (ADR-1399 D4), and 28's tests (28.1–28.15) already drive `server.ts`, so 28's contracts are made true today in 1's code (ADR-1242 D3) |

**Kept, with a reason.** `schema/records.ts` pulls hard toward Library transactions: lift 14 to 15
with every transactions file, and 6 of its 7 pull requests. It stays in Data schema because it holds
that capability's validation contracts (3.1–3.9). Moving it would split them (ADR-1242 D3), and both
ends are hubs this rule set keeps apart. Library API's leads (with 32 at lift 3.2, with 2 at 2.4, with
26 at 2.6) come from a facade changing with whatever it re-exports, so it stays apart too. Owner
questions and Work in flight reach lift 3.4 at support 4, below the support of 5 this rule set needs:
they stay siblings.

**No package split.** The library stays one package; every change is a module move inside it.

## Scorecard

### Measured by the scorer (`code-measures tree`, contracts 5.1–5.9)

| Reading | Baseline (the plan) | Proposal 1 |
|---|---|---|
| TurboMQ of top-level groups | 1.31 (random mean 0.52, 95th percentile 0.70) | 0.98 (random mean 0.50, 95th percentile 0.71) |
| Co-change inside groups | 17.1% (random 95th percentile 14.9%) | 11.8% (random 95th percentile 17.6%): **not beyond chance** |
| Cycles among siblings | 3: top level (8), under Project storage (3), under Questions and work (2) | 2: top level (8), under Project storage (2: Connection by address, Project libraries) |
| Nodes, sibling import edges: depth 1 / depth 2 | 12, 44 / 18, 19 | 11, 39 / 15, 14 |
| Highest level among siblings | 4 | 4 |
| Boundaries with import edges; type names crossing them | 103; 441 | 94; 420 |
| Guidance leads (merge or nest) | 4 | 5 |

The scorer reads today's code, so a refactor step that moves a type (change 8, the helpers in
change 5) does not show in it. The Project storage cycle it still prints rests on one type,
`ConnectOptions` (`address.ts` imports it from `storytree.ts`), and change 8 moves that type. The
eight-node cycle at the top runs through Library API: every part imports `Library` from the package
root, and the root re-exports every part. The baseline has the same cycle, co-change cannot see it,
and any tree inherits it until the refactor gives the parts a narrower interface than `Library`.

### Measured by this proposal's own reading (renames followed, file by file)

The same merges, but every pull request's files are traced through later renames to their paths
today, and co-change is counted between files rather than between capabilities.

| Reading | Baseline | Proposal 1 |
|---|---|---|
| File-level TurboMQ of top-level groups | 2.67 (random 95th percentile 0.93) | 2.48 (random 95th percentile 0.96) |
| Co-change inside a top-level group | 27.9% (random 95th percentile 12.8%) | 29.9% (random 95th percentile 14.8%) |
| Co-change inside one capability | 16.3% | 19.2% |
| File imports newly cut by the tree / healed | – | 6 cut (7 type names) / 13 healed (28 type names) |

### Why the two readings disagree (measured)

1. **The scorer does not follow renames.** Each merge lists its files at their paths of that day, and the
   2026-11-21 regroup moved most of the library. Without renames followed, 13 with 22 has support 3,
   below the threshold; with them, 8. The scorer cannot see change 1's evidence at all.
2. **The scorer counts co-change between capabilities, so merging two deletes the pair that argued for
   it.** Applied one at a time to the baseline, each change moves the scorer's TurboMQ / inside share
   from 1.31 / 17.1% to: Waits merge 1.23 / 15.1%; Decisions (changes 1 and 2) 1.21 / 18.2%; Factory
   merge 1.29 / 16.1%; Work model out 1.23 / 13.9%; note commands 1.27 / 16.7%; data nest 1.37 / 17.7%;
   `server.ts` 1.32 / 17.2%. Every merge lowers it.
3. The Work model move lowers it for a third reason: `work/index.ts` re-exports Work model, so a
   barrel file and the thing it re-exports change together (research_1b2288db278d warned of this).
   After the move that barrel no longer re-exports it.

The one co-change a move really cuts: `commands/index.ts` changes with `notes.ts` in 15 pull requests
(lift 3.8), because the registry and the shared helpers sit there. Change 5 moves the helpers too, but
whether the registry still changes with every new note command is something only the refactor can show.

## Judgements (agent guidance, not readings)

**ADR-1242's three tests, for each capability the proposal changes.** Unchanged capabilities keep the
baseline's standing.

| Capability | D1 one reason to change | D2 owns its records | D3 claim-sized contracts |
|---|---|---|---|
| 13 Decisions (13 + 22 + 31) | passes: the decision log and its corrections change together | better: corrections write decisions' annotations, now from inside | passes |
| 10 Work in flight (10 + 11) | passes | better: waits and wait writes were split across 10 and 11 | passes |
| 4 Work model (top level) | passes | unchanged: ADR-1242 records that Work in flight writes plan records when a branch lands (through pending changes); this proposal does not fix that | passes |
| 6 Knowledge artifacts (+ note commands) | passes: note commands change with the note model | better: the commands that write notes move to the notes' owner | passes, once the 16 note-tool contracts move with them |
| 16 The command schema (+ helpers) | passes: the shared kit every command family uses | passes | passes |
| 17 The library's commands (− note commands, + 27 nested) | passes | passes | passes |
| 1 Project libraries (1 + 29) | judgement: opening a project and finding its factory change for one reason (what a project opens with); switches ride along | passes | passes |
| 28 Shared server (+ `server.ts`) | passes | passes | better: its contracts' code moves into it |
| 15 Connection by address (+ `ConnectOptions`) | passes | passes | passes |

**Leads the scorer still prints, weighed.** Work model with Questions and work (lift 4.16) is the
barrel effect above; keep them apart. Library API with Questions and work, Rounds and Library
transactions: the hub, apart. Knowledge artifacts with The library's commands (lift 2.83): the
registry. Watch it after the refactor; do not merge.

## Refactor cost (estimated)

| Measure | Estimate |
|---|---|
| Source files moved between folders | 15: four into `plan/`; `notes.ts` and `ranked.ts` into `knowledge/`; `elsewhere.ts` and `stale-edit.ts` into `verbs/`; five from `decisions/` into `knowledge/decisions/`; two from `data/` into `commands/data/` |
| New files | 3: entry files for `plan/` and `commands/data/`, and one for the helpers split out of `commands/index.ts` |
| Test files moved | 10, plus the note-tool tests split out of `commands/commands.test.ts` |
| Files whose relative imports change | about 22 source files, plus 2 tests |
| Public exports | `@storytree/library/pr-cutover` repointed in `package.json`; `@storytree/library/commands` keeps re-exporting `NOTE_TOOLS` so other packages change nothing |
| Shared types cut | 1 type moved (`ConnectOptions`). The new file-level cuts carry 7 type names (`ServerAccess`, `WaitBounds`, the note tools' `Found`, `NoteRead`, `NoteToolContext`, `Presenter`, and `HeldClaim`, which moves with the helpers); 28 type names stop crossing a boundary |
| Contracts rehomed (none retired) | about 32: 6 from 11, 2 from 22, 1 from 31, 7 from 29, and about 16 from 17 (17.2, 17.4, 17.7, 17.17, 17.21, 17.23–17.26, 17.28, 17.30–17.33, 17.35: the tests that drive a note tool; confirm each when moving) |
| Capability records | 4 retired by merging (11, 22, 31, 29), their contracts all rehomed; 3 re-parented (4, 13, 27); 1 renamed (33) |

## How it was read

- File owners: `storytree map --select capability:<id> --kind file --show --json` for each of the
  library's 30 capabilities, 87 source files, at origin/main 05551726.
- Co-change: main's first-parent merges in this clone (history before 2026-10-26 is only in the
  unpushed bundle). Source files only, merges over 30 source files dropped, paths traced through later
  renames: 185 pull requests touch the library. Ranked by lift, support at least 5 unless marked weak.
- The scorer: `code-measures tree` as above, on the plan and on `tree.json`.
