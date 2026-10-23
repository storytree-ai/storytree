# The Sessions strip expands to fill the forest pane (forest 7.17, ADR-1002 D3)

Increment `increment_609078039c32`, arc `arc_1fc30b699332`. The real desktop page (built unmodified by `build.mjs`, headless Chromium through
Playwright on Linux) with synthetic activity; `capture.mjs` drives it at 1440x960 and 420x900 and asserts the measures below.

```sh
node packages/forest/evidence/full-strip/build.mjs
CAPTURE_PLAYWRIGHT=<playwright-core/index.mjs> CAPTURE_CHROMIUM=<chrome-headless-shell> node --import tsx packages/forest/evidence/full-strip/capture.mjs --retake
```

## Pictures

- Desktop at the usual height: [Arcs drawer closed](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/full-strip/full-desktop-usual.png), [Arcs drawer open](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/full-strip/full-desktop-usual-arcs-open.png)
- Desktop expanded: [Arcs drawer closed](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/full-strip/full-desktop-expanded.png), [Arcs drawer open over it](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/full-strip/full-desktop-expanded-arcs-open.png)
- [Desktop expanded with the story panel open and the stale-forest mark showing](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/full-strip/full-desktop-expanded-story-panel-and-stale-mark.png)
- Narrow (420px): [usual](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/full-strip/full-narrow-usual.png) and [expanded](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/full-strip/full-narrow-expanded.png)
- [Measures](measures.json)

## Measures

- At the usual height the strip is at most 40% of the pane (here 18%, its rows being few) and its header's size button reads Expand
  (`aria-pressed="false"`, labelled "Expand sessions to fill the pane").
- Pressed, the strip fills the pane: top 0, bottom 0, left 0, right 0, 864px of 864px (desktop), 804px of 804px (narrow), body `overflow-y: auto`.
  The button reads Restore (`aria-pressed="true"`); the size is kept (`localStorage`, `storytree.forest.sessions-size.v1:<project>`). History fills it too.
- Folding by the header leaves the header alone (36px desktop, 53px narrow) and no size button; after a reload it is still folded, and Enter on the
  handle opens it at the kept full size. Enter on the focused Restore button returns it to at most 40% and keeps `false`.
- With the Arcs drawer open over the expanded strip (480px of overlap), `elementFromPoint` at three points down the overlap hits the drawer each time:
  the strip now sits at z-index 4, below the drawer's 5, since the forest pane forms no stacking context. At the usual height they do not overlap.
- Expanded, the strip stops 12px short of an open story panel (right edge 936px, panel at 948px) and lifts above the stale-forest mark (bottom 905.6px).

## Judged against

The arcs drawer's own size control (Expand, then Restore), so the two surfaces read alike; the strip's existing header controls (the History range
buttons' outlined style). Expanded, the strip covers the globe and its corner controls until restored, as the expanded Arcs drawer covers the forest.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 7 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/full-strip).
