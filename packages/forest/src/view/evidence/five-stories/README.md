# A five-story forest: every nameplate readable, in a row and in a chain

Branch `claude/increment-a040c6fb1db8-a9af14` (ADR-0855, narrowing ADR-0850 D2; contract 1.10 on Story nodes).
The first real builds (app 0.3.507) drew five-story forests whose nameplates collided or crowded the rim:
`packages/app-setup/evidence/first-build/shots/k3-forest-conduit-claude.png` (a row) and
`k2-forest-conduit-codex.png` (a chain). These are pictures for the owner to look at; nothing here is
recorded as accepted (ADR-0794).

| Forest, as the app opens it | Before | After |
| --- | --- | --- |
| Five stories depending on nothing: one row | [before-row.png](before-row.png) | [after-row.png](after-row.png) |
| The same five, each depending on the one before: a chain | [before-chain.png](before-chain.png) | [after-chain.png](after-chain.png) |
| storytree's own seed (15 stories, from ../code-rows), to show it unharmed | [before-storytree.png](before-storytree.png) | [after-storytree.png](after-storytree.png) |

Measured in the page (`measurements-*.json`: each story plate's box, whether it shows, its step down, and the
pairs of shown plates that overlap):

| Forest | Plates shown, before | after | Overlapping pairs, after |
| --- | --- | --- | --- |
| Row | 1 of 5 (four hidden by ADR-0850 D2) | 5 of 5 | 0 |
| Chain | 5 of 5, top two islands at the rim (facing 0.45, 0.10) | 5 of 5, every island facing 0.74 or more | 0 |
| storytree | 10 of 15 (opened on its bottom row, five turned away or hidden) | 14 of 15 (Keys turned away) | 0 |

What changed: a plate that would overlap steps down just below the ones it meets (the row zigzags in two
lines); a story plate wraps to 112 px; with no failing island the globe opens on its islands' middle. The seed
has no failing island, so storytree's own opening changed too, to its middle: in the live library, where an
island is failing, the opening still faces it.

Judged against: **Plain language first** and the owner's "no prose for the rows" (ADR-0839): nothing is added
but the titles, wrapped; **Observability-first**: every story's name is on screen at opening, none hidden;
the north-up arc's "nameplates below" (ADR-0839): each plate still hangs under its own island, centred on it,
stepping only down.

Renderer: headless Chromium 148, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Both builds get
the same stand-in bridge, seeds and viewport; nothing is turned by hand. **Before** is `origin/main` (8551c0aa)
built from a throwaway worktree; **after** is this branch.

## Rerun

`node --import tsx build.mjs <before checkout> before`, `node --import tsx build.mjs <this checkout> after`, then
`node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before|after`. The row and chain seeds are made in
`capture.mjs`; storytree's is ../code-rows/seed.json.gz and survey.json.

The scripts now provide seeds and views to the shared desktop capture runner.
Browser launch, bridge installation, the asset server, settling, output and cleanup
live in `apps/desktop/src/capture`. The default output is the matching folder below
`/tmp/storytree-captures`; append `--retake` to the capture command to replace these
committed pictures deliberately. Use `CAPTURE_CHROMIUM` or `CAPTURE_PLAYWRIGHT` for
an explicit browser override; no machine-specific home path is needed.
