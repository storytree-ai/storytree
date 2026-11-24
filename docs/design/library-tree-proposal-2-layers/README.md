# Tree proposal 2: the library's capabilities cut by dependency layers

One of three independent tree proposals for the library story (story_754e87e7d531), on arc_c465ed702824 (ADR-1395 D3). This is increment_f46b74b5fc26. It is a proposal only: no capability in the plan changed and no code moved.

- `tree.png` (or `tree.svg`): the baseline on the left, this proposal on the right. Each column is ordered by level, with the lowest part at the bottom. The arcs are imports between top-level parts. A red arc points up, against the layering, and every red arc is part of an import cycle.
- `tree.json`: the proposed tree, in the scorer's format, with today's file paths. Grade it with `storytree code-measures tree story_754e87e7d531 --tree docs/design/library-tree-proposal-2-layers/tree.json`.

## In short

This proposal removes every import cycle among sibling capabilities, which ADR-1399 D4 makes the one hard rule. It costs 5 file moves, 4 type moves, 1 new interface and 25 rehomed contracts, with none retired. The price is Common Closure. A layered tree cuts features horizontally, so a change that adds one field touches the work model, the Library API and a command together. TurboMQ falls from 1.31 to 1.07, which is still well beyond chance. The share of co-change inside groups is no longer beyond chance.

## The rule set

- Levelize the modules from the import graph (Lakos).
- Keep siblings acyclic (ADP), with dependencies pointing toward stable parts (SDP).
- Nest only where a layer has its own entry point. Today `knowledge/`, `work/`, `project/` and `librarian/` each have an `index.ts` that their importers enter by. ADR-1377 D2 asks for that folder behind the parent, not behind each child, so no new folders are needed.

## The tree, bottom layer first

| level | capability | holds | contracts |
|---|---|---|---|
| 1 | 2 · Library transactions | transactions/ | 26 |
| 2 | 3 · Data schema | schema/, plus references.ts and creation-order.ts (moved down from 7) | 22 |
| 3 | 13 · Decisions | decisions/ without the adr command (absorbs 22 · Decision corrections and 31 · Decisions) | 19 |
| 4 | 33 · Notes and search | knowledge/: 14 · Ranked search (level 1), 6 · Knowledge artifacts (level 2, absorbs 9 · Knowledge entrances) | 1 + 18 + 26 |
| 5 | 32 · Questions and work | work/: 4 · Work model, 12 · Owner questions (level 1), 10 · Work in flight (level 2, absorbs 11 · Waits and plan-hold.ts) | 1 + 52 + 18 + 42 |
| 6 | 5 · Health record | health/ | 36 |
| 7 | 34 · Project storage | project/: 28 · Shared server (level 1, gains names.ts, server.ts, seed-connection.ts), 15 · Connection by address and 29 · Factory and product (level 2), 1 · Project libraries and 30 · Outside writers (level 3) | 1 + 17 + 6 + 7 + 18 + 7 |
| 8 | 7 · Library API | api/ and index.ts, plus the fixed data questions' queries | 22 |
| 9 | 16 · The command schema | verbs/ | 4 |
| 9 | 35 · The librarian | librarian/: 21 · Links, 23 · Catalogue, 24 · Graduation (level 1), 26 · Rounds (level 2) | 1 + 5 + 3 + 4 + 11 |
| 10 | 17 · The library's commands | commands/, plus the adr and data command families | 48 |

That makes 11 top-level capabilities and 14 nested ones, against 12 and 18 today. Five capabilities are merged away: 9, 11, 22, 27 and 31. All 415 contracts stay; 25 of them are rehomed.

## Scorecard: measured readings

The scorer is `storytree code-measures tree` (increment_78898d1748b3), run on origin/main 05551726 over 1,137 first-parent merges. The proposal column is read with the refactor's import retargets applied in a scratch copy, because the scorer reads imports as the code has them. The same tree read on today's unrefactored imports gives the identical grouping numbers. It still shows two cycle sets: one across 8 top-level parts, and 1 with 15 under 34. Those are exactly what the retargets remove.

| reading | baseline (plan today) | proposal 2 |
|---|---|---|
| TurboMQ (random mean / p95) | 1.31 (0.52 / 0.70) | 1.07 (0.50 / 0.67) |
| co-change inside groups (random mean / p95) | 17.1% (10.0% / 14.9%) | 15.5% (11.0% / 17.8%) |
| cycles among siblings | 3 sets: 8 top-level parts; 29, 15, 1; 10, 4 | none |
| top-level arcs pointing up a level | 12 of 44 | 0 of 35 |
| depth 1: nodes, sibling import edges | 12, 44 | 11, 35 |
| depth 2: nodes, sibling import edges | 18, 19 | 14, 13 |
| deepest Lakos level among siblings | 4 | 10 |
| boundaries between nodes / type names crossing them | 103 / 441 | 78 / 400 |
| nodes with half or more of their importers using only part | 11 of 28 | 8 of 23 |
| sibling imports against SDP (into a less stable part) | 9 | 1 |

Instability runs from 0 at 2 · Library transactions up to 1 at 17 · The library's commands and 35 · The librarian. Among siblings, 1 import runs from a more stable part to a less stable one, against SDP: 7 · Library API (0.50) into 34 · Project storage (0.71). The baseline has 9 such imports, 6 of them out of 7 · Library API.

## Guidance (judgements, not readings)

- **The closure trade.** The co-change pairs that now cross boundaries are features cutting vertically: Library API with Questions and work (lift 3.17), The library's commands with Decisions (3.16) and with Knowledge artifacts (2.71), and Library API with Rounds (2.55). A layered tree cannot merge these without a cycle. This is the honest cost of the rule set, and it is why inside-group co-change falls below chance.
- **A tall stack.** Ten levels at the top is what the imports say the library is. The baseline's four levels come from cycles that flatten whole groups onto one level. This tree also has fewer nodes and fewer edges per level.
- **Decisions stays one capability.** Notes call the decision log on every note write, so the decision log has to sit below notes. Today the decision edits (supersede, correct, annotate) reach the whole `Library` type through the root entry, which sits above notes, and that closes the 8-part cycle. Under this proposal the edits declare the four Library methods they call as a `DecisionWrites` interface, which Library already satisfies. That puts Decisions at level 3, whole, as ADR-1377 D4's example asks. Only the `adr` command family moves up to commands, because it is a door's words.
- **Library API stays a hub.** Library API has 85.7% partial importers, and Decisions has 80%. A facade is reused in part by design, so this is not a lead to split it.
- **No package split.** The layers suggest one seam: commands, the command schema and the librarian are clients of the Library API, already entered by their own package exports (`./commands`, `./verbs`, `./librarian`). A package of their own would be a new story under ADR-0649, so it is noted here, not proposed.

## ADR-1242's three tests, for each capability this proposal changes

The capabilities this proposal leaves as they are keep their present standing.

| capability | D1 one reason to change | D2 owns its records | D3 claim-sized contracts |
|---|---|---|---|
| 13 · Decisions | how decisions are recorded, related and edited | passes, and fixes a split: today 13 and 22 both write the decision record | passes; 22.2 and 22.3 now sit with the code they need |
| 6 · Knowledge artifacts (with front covers) | artifact kinds and their writes | passes; front covers are read by the artifacts' own write path | passes |
| 10 · Work in flight (with waits and plan-hold) | arcs, increments, their waits and held plan edits | passes; the wait writer and the wait reader become one | 4.36 moves with plan-hold.ts; still to check: pending changes stay written through 4 |
| 28 · Shared server (with names, server, seed connection) | reaching and naming a server's databases | owns no records | 1.5 moves with names.ts |
| 7 · Library API (with the data queries) | the facade and its fixed questions | owns no records | passes |
| 17 · The library's commands (with adr and data) | the library's door words | owns no records | risk: 13.16 and 13.17 (`adr move-narrows`, `adr pairs`) may need Decisions' code to hold. If so, they stay on 13 |

## Refactor cost

- **Files moved (5 source, 2 test):** `references.ts` and `creation-order.ts` to `schema/`; `decisions/adr.ts` to `commands/`; `data/data-questions.ts` to `api/`; `data/commands.ts` to `commands/`; `adr.test.ts` and `data-questions.test.ts` to `commands/`. The `data/` folder goes. 13 of 87 source files change capability; 8 of them stay where they are.
- **Shared types cut:** `ConnectOptions` moves from `project/storytree.ts` to `project/address.ts`, which breaks the cycle among 1, 15 and 30. `Note`, `NoteEdit` and `NoteType` move to `schema/`. One interface is added, `DecisionWrites`, with no copied data shapes. Imports are retargeted in 12 files for references and creation order, and in 8 files for the rest. No package export changes.
- **Contracts:** 25 are rehomed and none is retired. They are 9.1 and 9.3; 11.1, 11.2, 11.4, 11.5, 11.6 and 11.12; 22.2 and 22.3; 31.1; 13.10, 13.16, 13.17, 13.24, 13.25 and 13.27; 27.1 to 27.6; 4.36; and 1.5.
- **Plan:** five capabilities are merged away (their records kept, their contracts moved). 13 is retitled Decisions. 4.53 already allows each nest, because every parent has its own entry file.
