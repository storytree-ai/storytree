# Sessions panel: a wide bottom strip that hides and expands like the arcs bar (forest 7.17)

Increment `increment_bbdde606e996`, arc `arc_895e232031b0`. The real desktop page (built unmodified by `build.mjs`, headless Chromium through
Playwright on Windows) with synthetic activity; `capture.mjs` drives it at 1440x960 and 420x900 and asserts the measures below.

```sh
node packages/forest/evidence/bottom-panel/build.mjs
PLANET_PLAYWRIGHT=<playwright-core/index.mjs> PLANET_CHROMIUM=<chrome-headless-shell> node packages/forest/evidence/bottom-panel/capture.mjs
```

## Pictures

- [Desktop, expanded](bottom-desktop-expanded.png) and [collapsed](bottom-desktop-collapsed.png)
- [Narrow (420px), expanded](bottom-narrow-expanded.png) and [collapsed](bottom-narrow-collapsed.png)
- [Desktop with the story panel open at the right and the stale-forest mark showing](bottom-desktop-story-panel-and-stale-mark.png)
- [Measures](measures.json)

## Measures

- The strip spans the pane (left 0, right 0) and sits on its bottom (0). Expanded it is 40.0% of the pane (346px of 864px) and scrolls vertically inside
  (content 348px in a 309px body); `overflow-x: hidden`, scrollWidth = clientWidth (1440 and 420 wide).
- Starts expanded: the handle is `aria-expanded="true"` and the caret points down. Clicking the header collapses it to the header strip alone (36px;
  handle `aria-expanded="false"`, caret up, no rows drawn); the choice is kept per project (`localStorage`, `storytree.forest.sessions-open.v1:<project>`,
  as the arcs bar keeps its own) and a reload comes back collapsed; Enter on the focused handle expands it again.
- Rows stay one line (29px each) across the wide panel; the context bar and total sit at the right edge. Backdrop `rgba(18, 24, 27, 0.62)` with `blur(3px)`.
- No collision: with the story panel open the strip stops 12px short of it (right edge 936px, panel at 948px); with the stale-forest mark showing the strip
  lifts above it.

## Judged against

- Legible at the resting view: rows, labels and run times read at both widths, nothing clipped or scrolled sideways.
- The resting view is designed, not fitted: the detail's Worktrees / Running / Files sit side by side as three fixed columns at desktop width
  (one column under 900px), so a session's facts read across rather than down.
- Matches the arcs bar: a full-width header with a label and a caret, `aria-expanded` / `aria-controls`, the state kept per project.
  Judgements: side margins are 0 (the arcs bar is flush); Escape does not collapse it (the arcs bar's drawer does; a list that is also a place to
  read while working should not vanish on a stray Escape); the header's legend stays on the strip when collapsed.
  Concern: expanded, the strip covers the lower 40% of the globe (seen through it, blurred).
