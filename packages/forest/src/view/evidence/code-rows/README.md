# Rows by the code's edges: before and after

Branch `claude/increment-45c5f0285804-944573` (ADR-0840 D2). Before, a story's row came from its capabilities'
dependsOn rolled up to stories; now, where the code survey reads a story's package.json, its row comes from
which other stories' packages its package depends on (every dependency field), so a code edge the plan never
recorded still places the island. A story with no package keeps the plan's roll-up. These are pictures for
the owner to look at; nothing here is recorded as accepted (ADR-0794).

| View | Before | After |
| --- | --- | --- |
| The globe unturned, its front facing the eye | [before-front.png](before-front.png) | [after-front.png](after-front.png) |
| The same, zoomed out (x0.7) | [before-wide.png](before-wide.png) | [after-wide.png](after-wide.png) |
| As the app opens it (turned toward a failing island) | [before-opening.png](before-opening.png) | [after-opening.png](after-opening.png) |

Every package edge between two stories (36, from `survey.json`'s `dependsOn`) and whether the dependent's
island sits north of its dependency's: **before 20 of 36, after 35 of 36**. The rows go from three to seven:
the library, the local database, the process ledger, the world and Keys at the bottom; the librarian; the
agent link; the app, the knowledge core and the app setup; the arc surface and the dev loop; the forest; the
command line and the website on top. The one edge not north is the librarian over the library: growth's
nudging pushes the librarian (row 2, about 28° S) down to 44° S beside the world, the largest island. Seven
rows also crowd the globe: the local database's and the process ledger's nameplates overlap. Both are
follow-ups on the arc, not this increment.

(`measurements-*.json`'s `rank`, `edges` and `edgesNorth` are the plan's roll-up, as the rows capture wrote
them; the numbers above are by the code's edges.)

Renderer: headless Chromium 148, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Both builds
get the same stand-in bridge, seed, survey, viewport and turns; nothing is hand-panned.

- **Seed** (`seed.json.gz`): a read-only snapshot of the real library (project `storytree`, 15 stories),
  taken by `seed.mts` on 2026-10-02.
- **Survey** (`survey.json`): `readCodeSurvey` over this branch with the seed's tree, by `survey.mjs`; the
  before build ignores its `dependsOn`.
  **Refreshed 2026-10-09** from `main` after PR #912, same seed (increment_4fe7a4568ece): every file now
  carries its declared capability and the numbered tests that reach it, and 76 of the 78 linked
  capabilities have code (was 62). The two without, The world's 3 · Props and dressing and 4 · Hit targets,
  have since been retired from the live plan; their code is credited to its current capabilities, which
  this seed predates. The package edges it reads went from 36 to 40, so the rows can differ from the
  pictures above, which were taken with the earlier survey. See ../pathway-repair/endpoint-diagnostic.json.
- **Before** is `origin/main` built from a throwaway worktree; **after** is this branch.

## Rerun

Run from this capture directory; replace `<checkout>` with the absolute path to
an installed checkout that contains the shared wrapper. The wrapper preserves the
working directory, so relative capture inputs and outputs keep their meanings.
It takes `STORYTREE_HOME/heavy-run.lock` (default `~/.storytree/0.3/heavy-run.lock`),
the same lock as `pnpm gate` and `pnpm test`. It names the holder while waiting,
forwards interruption to the child process tree, preserves command failure status,
and recovers stale holders. Pass the executable and its arguments after `--`;
the wrapper does not run them through a shell. Choose `before` or `after` below
rather than passing the `|` notation literally.

This coordinates participating commands only. Timings collected with uncontrolled
competing work are observations, not controlled benchmarks; the lock does not
establish machine isolation.

As ../rows/README.md: `tsx seed.mts`, `tsx survey.mjs`, `node --import tsx build.mjs <before checkout> before`,
`node --import tsx build.mjs <this checkout> after`, then `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before|after`.

## Nudged within the rows' bands, and crowded nameplates give way

Branch `claude/increment-5a60190bc5af-a57e8e`, the follow-up on both pictures' faults. The **after** pictures above
are its before; **nudged** is this branch, same seed, survey, viewport and turns.

| View | Before (after, above) | Nudged |
| --- | --- | --- |
| The globe unturned, its front facing the eye | [after-front.png](after-front.png) | [nudged-front.png](nudged-front.png) |
| The same, zoomed out (x0.7) | [after-wide.png](after-wide.png) | [nudged-wide.png](nudged-wide.png) |
| As the app opens it | [after-opening.png](after-opening.png) | [nudged-opening.png](nudged-opening.png) |

- Nudging now keeps each island within 0.4 of the rows' spacing of its row's latitude, so it can never be
  pushed past a row below or above; where that leaves no room, the globe grows instead. The librarian goes
  from 43.9° S (below the library, 40.6° S) to 33.6° S (the library is at 46.8° S); code edges pointing north,
  **35 of 36 before, 36 of 36 now**. The globe's radius grows from 222.4 to 226.8 ground units (two 2% steps).
- Where two story nameplates would overlap on screen, the one whose island faces the eye less is hidden until
  they clear (the selected story's never is). Unturned, the local database sits edge-on at the rim behind
  the process ledger, so its plate gives way; turned as the app opens, both show.

Rerun: `node --import tsx build.mjs <this checkout> nudged`, then `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs nudged`.

The scripts now provide seeds and views to the shared desktop capture runner.
Browser launch, bridge installation, the asset server, settling, output and cleanup
live in `apps/desktop/src/capture`. The default output is the matching folder below
`/tmp/storytree-captures`; append `--retake` to the capture command to replace these
committed pictures deliberately. Use `CAPTURE_CHROMIUM` or `CAPTURE_PLAYWRIGHT` for
an explicit browser override; no machine-specific home path is needed.
