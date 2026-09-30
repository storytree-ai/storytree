# Sessions panel: full height, expanded, facts as labels (forest 7.9, 7.15-7.17)

Increment `increment_08349f1f5d59`, arc `arc_895e232031b0`. The real desktop page (built unmodified by `build.mjs`, headless Chromium
through Playwright on Windows) with synthetic activity; `capture.mjs` drives it at 1440x960 and 420x900 and asserts the measures below.

```sh
node packages/forest/evidence/full-panel/build.mjs
PLANET_PLAYWRIGHT=<playwright-core/index.mjs> PLANET_CHROMIUM=<chrome-headless-shell> node packages/forest/evidence/full-panel/capture.mjs
```

## Pictures

- [Desktop, every row expanded by default](panel-desktop.png): three working or waiting sessions, each worktree labelled, a Running
  block per session, the four quiet sessions folded into "4 idle", closed.
- [Desktop, idle fold opened, scrolled to the end](panel-desktop-scrolled-idle-open.png)
- [Narrow (420px)](panel-narrow.png) and [narrow, idle fold opened and scrolled](panel-narrow-scrolled-idle-open.png)
- [Measures](measures.json)

## Measures (quoted before the look is judged)

- Rows drawn 4 of 4 expanded at rest (`aria-expanded="true"`); the "4 idle" fold `aria-expanded="false"`.
- Panel: left 16px, bottom 16px (8px and 8px at 420px); top 68px, which clears the Forest/Library switcher (its bottom is at 55px in the pane).
  Height 780px of the 864px pane at 1440x960.
- Horizontal overflow: `overflow-x: hidden`, scrollWidth 523 = clientWidth 523 (and 402 = 402 at 420px). `overflow-y: auto`; the list scrolls inside.
- Backdrop: `rgba(18, 24, 27, 0.62)` with `blur(3px)`, where it was `rgba(18, 24, 27, 0.93)`.
- Text drawn about a session's need of the owner: none (no "needs you", no "Holding unmerged work", no close-out why).
- Worktree labels drawn: unmerged, merged, unmerged, merged (the main-line folder carries none). Running entries: 3 (two commands in a turn, one
  background dev server a turn left).

## Judged against

- Legible at the resting view: the rows, labels and run times read at 1440x960 and at 420px with nothing clipped or scrolled sideways.
  The globe behind the panel stays visible to the right of and through it (concern: at 420px the panel covers the whole globe, which shows only
  as a blur through it).
- The resting view is designed, not fitted: expanded by default, the fold closed; the panel runs the pane's height like the arcs surface.
- Meaning outranks appearance: each fact is a label against the thing it is about (unmerged/merged on a worktree, the run time on a command).

A reversible judgement: the panel's top is 68px, not the pane's 16px margin, so it does not sit under the Forest/Library switcher (the first capture at
16px put that switcher over the panel's header). Narrow width: the same 68px, for the same switcher.

`sessions-list/capture.mjs` (earlier evidence) still asserts the old collapsed-by-default look and the "needs you" chip; it is a historical
instrument and is not run by the gate.
