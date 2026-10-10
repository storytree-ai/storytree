# Full-width arc bar — increment_fa17cbd8b666

One full-width bar replaces the small centred tab. Its “Arcs” and project label use the
forest controls’ existing palette. Both ends toggle the same read-only drawer, with the
app’s gear left in its existing corner. The arc mount reserves a 60 px top strip so the
forest’s view controls and story panels remain reachable below it. Drawer contents,
reading rules and local preferences are retained; the bar label is static, so closing the
drawer still stops its reading. All implementation is in `packages/arc-surface`.

## Owner review: one treatment, two states

These are unedited **Electron `pnpm desktop:smoke` window captures**, at 1120 × 860,
with dark colour-scheme emulation and the same default camera. The restored snapshot is
`2026-09-28T07-26-00-491Z.json`: 1,628 records, 10 stories, 71 capabilities, and its real arcs.
No fixture arcs, questions or claims were added. **The owner has not accepted the look.**

- **A · Closed bar at rest:** [bar-closed.png](bar-closed.png).
- **A · Bar with drawer open:** [bar-open.png](bar-open.png).
- [Native window state and drawing readings](electron-capture.json).
- [Browser geometry and interaction measurements](capture.json).

Under **Legible at the resting view**, the bar uses 14 px text with a separate project label
that truncates safely on narrow windows. Under **The resting view is designed, not fitted**,
the native bar is 1,060 × 60 px, occupying 6.6% of the frame, with a 12 px gutter before the
36 px gear. The browser proof additionally checks a 1,380 px bar at 1,440 px and a 300 px bar
at 360 px; the forest controls start below the strip. (Since the two top bars landed, the
browser proof reads the later layout: see *Re-take* below.) Under **Meaning outranks appearance**,
the bar remains a native button with an explicit open/close name, expanded state, visible
keyboard focus and a direction caret. Its label makes no stale claim about current work.
These are review observations, not visual acceptance.

## Verification

- [Red unit proof](red.txt): the new accessible bar renderer is absent.
- [Red geometry proof](geometry-red.txt): the old tab starts at x=682 instead of x=0.
- [Green focused test](green-unit.txt), [typecheck](typecheck.txt), [affected tests](green.txt),
  [gate](gate.txt), and [test-ratio](test-ratio.txt).
- Browser assertions: full width up to the gear at wide/narrow sizes; forest view controls
  below the bar; toggle clicks at opposite ends; keyboard and Escape focus; forest pointer
  input immediately below the closed bar and below the open drawer; gear access; saved
  open/scope and closed state; unchanged library history; forest census; zero page errors.
- [Closed Electron smoke](bar-closed-smoke.txt) and [open Electron smoke](bar-open-smoke.txt):
  both exit 0 after the all-scope arc smoke and the forest census.
- Guidance is NOT RUN: no role or supporting guidance note changed. The live Cloud SQL
  tests in the affected suite remain skipped unless their owner-supplied credentials exist.

The native smoke reads its diagnostic text before the capture driver sets the resting
closed state; `electron-capture.json` records the actual state used for each image.
Headless geometry capture writes these same image paths; run Electron capture last.

## Reproduce

Reuse the installed Playwright/Chromium through `STORYTREE_PLAYWRIGHT` and
`STORYTREE_CHROMIUM` when their default local paths differ:

```sh
flock /tmp/storytree-heavy.lock node apps/desktop/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/arc-surface/evidence/arc-bar/capture.mjs <snapshot.json>
```

For native captures, restore into an empty throwaway home and supply a working X display:

```sh
export STORYTREE_HOME=$(mktemp -d)
flock /tmp/storytree-heavy.lock node --import tsx scripts/restore-library.mjs \
  /home/mickh/storytree-lanes/snapshots/2026-09-28T07-26-00-491Z.json --project storytree
DISPLAY=:98 STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock \
  node packages/arc-surface/evidence/arc-bar/electron-capture.mjs
```

On Mint, this used the gear lane’s extracted Xvfb at `/tmp/gear-xvfb/root`, with its library
path set, and temporarily linked the installed Linux Postgres binaries into desktop’s
ignored node_modules. Browsers, servers and Postgres are stopped by the scripts; the outer
wrapper stops Xvfb. No live library, claim, decision or question was written.

[Library patch and supervisor checklist](library-update/README.md) carry the story updates.
The supervisor records ADR-0660’s narrowed handle clause and closes the increment.

## Re-take, 2026-10-10 (increment_357069f477a3)

The two top bars (commit 4cac4f1f, `packages/app/evidence/top-bars`) moved the gear into the
app's own 48 px bar along the top edge and put the arc bar directly below it. The capture's
geometry now asserts that layout: the app bar at (0, 0) across 1,440 px with the gear inside it;
the arc bar at x=0, y=48, the full 1,440 px wide and 48 px tall; the drawer opening at the arc
bar's bottom edge; and, at 360 px, a 360 px arc bar with the gear above it. Every other
assertion is unchanged. [bar-closed.png](bar-closed.png), [bar-open.png](bar-open.png) and
[capture.json](capture.json) are now this browser capture's re-take (1,440 × 960, snapshot
`2026-09-28T07-26-00-491Z.json`); the Electron readings above are the earlier native take.
