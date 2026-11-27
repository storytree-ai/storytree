# The library, rebuilt cold: the build brief

This is the cold rebuild arm of the library rebuild pilot (arc_16222b0d3ba6, ADR-1404; increment_51b5a7285aa4).
The library (story_754e87e7d531) is rebuilt from its contracts, its frozen tests and its upstream stories'
declared interfaces alone, never its old source (principle_f72b66ffa0cd "Cold rebuild"), into the tree the
owner adopted on question_6bc911dd9cd9: proposal 1 with his renames. Every lane that builds a piece of it starts
here. The branch is held: it never merges until the verdict increment (increment_7cf2aff82558) decides.

- **Held branch:** `claude/increment-51b5a7285aa4-549d15`, cut from `538759d3` (the snapshot `01600d97` plus
  increment_0d5bb4a1bd6e's two 14.10 pins, which is what the frozen oracle lists). Its draft pull request carries
  the `hold` label.
- **Where the rebuild goes:** `packages/library-rebuild` (package `@storytree/library-rebuild`). The old library
  stays in `packages/library` until the last step, because the repository's own hooks, command line and test
  runner import `@storytree/library`, and a worktree without it loses its test guard. The integration step
  (increment_51b5a7285aa4 itself, last) swaps the rebuild into `packages/library` under the old name.

## The cold rule

Never read the library's old source. That means, in any checkout, branch or commit (the held branch, main, other
worktrees, `git show`, `git log -p`, `git diff`, `grep`, `cat`, the Read tool, a subagent's reads):

- any file under `packages/library/src` that is not test code. Test code is a `*.test.ts` file or anything in a
  `testing/` or `fixtures/` folder: those are the frozen oracle and may be read and copied;
- `packages/library/survey-coverage.json`;
- the library's code on main, refactored or not (increment_a146993396d0 refactors it live, from the old source);
- the map or code survey of the library's files (`storytree map`, the `focus` tool, `code-measures`) and the
  other proposals' and scorecards' readings of it (`docs/design/library-tree-redo/*/scorecard-*.txt`,
  `docs/design/library-tree*/proposal-2`, `proposal-3`, and the research records behind them);
- the pilot's pre-registration and experiment records (research_af3a3e466cef, experiment_eba4d756a7f5) and
  anything under `~/storytree-experiments`: reading them taints this arm's change trials.

A search across the repository must leave the old source out: `git grep … -- ':!packages/library/src'`, then
add back only test files (`'packages/library/src/**/*.test.ts'`). Transcripts are audited for reads of that path.
If a read happens by mistake, say so in your increment's close note, naming the file.

## What a lane may read

- `spec/NN.txt`: every contract of today's capability `NN` with its statement and test criterion, the
  capability's about text and founding decisions, as at 2026-11-26 (418 contracts). Decisions and notes the
  spec names may be read in the library: they are the spec too.
- `interface/*.d.ts`: the declared types of each export path at the snapshot, one bundle per path, generated
  mechanically by dts-bundle-generator from the snapshot (no implementation in them; `testing-pg.d.ts` inlines
  upstream `@storytree/local-postgres` code, which is an upstream story's). The rebuild's exports must offer
  these names with compatible types, because 18 packages import them.
- `oracle-01600d97.json`: the frozen oracle, 501 tests in 62 files, 404 contract numbers (sha256 315baf91…, the
  same file the pre-registration froze). The rebuild passes when every title and contract number in it is present
  in `packages/library` after the swap and passes (`node packages/repo-checks/src/library-pilot.mjs compare`).
- The frozen tests themselves (`packages/library/src/**/*.test.ts`, `testing/`), the tree
  (`docs/design/library-tree-redo/proposal-1/tree.json` and its `README.md`), the upstream packages
  (`@storytree/keys`, `@storytree/local-postgres`, `@storytree/test-waits`) and npm dependencies, and the
  code of packages that import `@storytree/library` (to see how the exports are used).

## The tree, its folders and who builds what

Proposal 1 with the owner's names (increment_a146993396d0 lists them). Each domain is one folder behind one small
entry file (`index.ts`), nested parts in nested folders; each domain holds its own record kinds' schemas, and
only a generic core (a valid, versioned record that refers to live records) is shared from Storage.

| Node (owner's name) | Folder in `packages/library-rebuild/src` | Today's capabilities | Increment |
|---|---|---|---|
| Front door | `index.ts` (the package root, the `Library` interface) | 7 | front door |
| Storage › The store | `storage/store/` | 2 | storage (increment_23d599c571e6) |
| Storage › Record rules | `storage/rules/` | 3 (but 3.10–3.14, 3.19, 3.21, 3.22), references | storage (increment_23d599c571e6) |
| The plan | `plan/` | 4 (but its pending-change and hold contracts), 3.11, 3.14, 3.21, 3.22 | plan (increment_b87e6a0f2d97) |
| Work › Arcs and increments | `work/arcs/` | 10, 11, 32, 4's pending changes and holds (4.28–4.36, 4.50, 4.55, 4.56) | arcs (increment_a2b03908794a) |
| Work › Owner's inbox | `work/inbox/` | 12 (and the fyi family's code, 17.10's, which commands builds) | inbox (increment_d4e63b0ff102) |
| Knowledge › Search | `knowledge/search/` | 14 | search (increment_5f55f4ed06bc) |
| Knowledge › Notes | `knowledge/notes/` | 6, 9, 33, 3.10, 3.12, 3.13, 3.19 | notes (increment_db0d57307978) |
| Knowledge › Decisions | `knowledge/decisions/` | 31, 13, 22 | decisions (increment_46e203ea6642) |
| Knowledge › The librarian › Rounds | `knowledge/librarian/`, `knowledge/librarian/rounds/` | 35, 21, 23, 24, 26 | librarian (increment_e78e1099730d) |
| Health | `health/` | 5 | health (increment_e37477f2eb48) |
| Projects › Opening a project | `projects/open/` | 1, 29, 34 | opening (increment_3df1aa3256fe) |
| Projects › Shared library | `projects/shared/` | 15, 28, 30 | shared (increment_216cfd6f4f7e) |
| Commands › Command kit, Saved queries | `commands/kit/`, `commands/queries/` | 16, 17, 27 (note commands placed in `knowledge/notes/`, the fyi family in `work/inbox/`) | commands (increment_53ff8e067dfa) |

A contract belongs to the increment its number's capability is listed under; a frozen test belongs to its
contract's increment, and an unnumbered one to the increment that owns the most numbered tests in its file. A
test file whose tests span increments is split, test by test.

Order (each increment waits on those it names, recorded as waits in the plan): storage first; then opening, shared, plan, search and health
in parallel; arcs after plan; inbox after arcs; notes after search; decisions after notes; librarian after
decisions and inbox; front door after every domain; commands after the front door; integration last.

## How a lane builds its increment

1. **Start on the held branch.** The runner cut your worktree from origin/main: before anything else,
   `git fetch origin && git reset --hard origin/claude/increment-51b5a7285aa4-549d15 && pnpm install --frozen-lockfile`
   (drop `--frozen-lockfile` only if your increment changes the rebuild package's dependencies). Keep your own
   branch name: the review finds your change by it.
2. **Tests: the test writer copies, never invents.** It copies each frozen test of the increment from
   `packages/library/src` into the rebuild's folder for it, with every title and contract number verbatim and
   every assertion unchanged, re-pointing only imports (and setup that named an old internal path). Shared test
   code (`testing/pg.ts`, `librarian/testing/pg.ts`, the TLS fixtures) is copied once, by storage. A test that
   imported old source that was test support (the store's behaviour suite) gets that support rewritten from the
   contracts as test code under a `testing/` folder. Any change beyond imports (a reworded title, a changed
   assertion, a test that could not be carried) is listed, with why, in `test-changes/<increment>.md` for the
   blind reviewer: the oracle counts a reworded title as a miss unless the reviewer judges it equivalent. The
   test writer sees each copied test red against the rebuild, as usual.
3. **Code: the builder writes the least code that turns them green**, from the spec, the interface bundles and
   the tests, in the tree's folders, each domain behind its `index.ts`. No comments (ADR-1369). Every source file
   must be reached by a numbered test. Exports: add to `packages/library-rebuild/package.json` the export keys
   of `packages/library/package.json` your increment's entry files serve, same keys, targets in the new tree.
4. **Review** as usual: commit, then the `code-reviewer` and the `test-reviewer`, each its slice, through
   `storytree quality brief|take`. The brief's diff is against main, so it holds the whole held branch so far:
   answer only your increment's contracts and the files your increment changed.
5. **Test and gate.** `pnpm test packages/library-rebuild` (or the files you changed) must be green. Run
   `pnpm gate` and record its table in your close note; a check that fails only because the held branch is not
   main's shape (two packages for one story, a capability list naming the old files) is named, not fixed.
6. **Land on the held branch, never on main.** `git fetch origin && git merge --no-ff origin/claude/increment-51b5a7285aa4-549d15`,
   test again, then `git push origin HEAD:claude/increment-51b5a7285aa4-549d15`. Never force-push; a refused
   push means another lane pushed first: fetch, merge, test, push again. No pull request of your own and no
   watcher hand-over: the held branch's one draft pull request carries the arm.
7. **Close your increment yourself**, `--disposition landed --pr <the held draft pull request>`, its note giving
   the held branch's commit, the engine and model, wall time from your lane's start to the push, review rounds
   per slice, the gate table's line, and any cold-rule slip. Then release your claims. `storytree measures`
   reads each closed increment's tokens; integration sums them as the arm's cost.

Run every `storytree` command from the main checkout or through the MCP tools,
never from the held worktree after integration has swapped the library.

## Integration (increment_51b5a7285aa4, last)

Swap: `git rm` the old library's non-test source and its test files, move `packages/library-rebuild/src` into
`packages/library/src`, give it back the name `@storytree/library` with the old manifest's `storytree` block,
remove `packages/library-rebuild`, `pnpm install`. Then: `library-pilot.mjs compare` against
`oracle-01600d97.json` (every title and contract number present), `pnpm run test --full` green across the
repository, `pnpm typecheck` green, the `test-changes/` ledger gathered for the blind reviewer, and the arm's
cost (tokens and dollars from `storytree measures` for every increment of this arm, lanes, wall time, review
rounds) written onto increment_51b5a7285aa4 and the draft pull request. The pull request stays draft with
`hold`; increment_7cf2aff82558 decides.
