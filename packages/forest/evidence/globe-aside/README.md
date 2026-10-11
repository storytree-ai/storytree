# The globe moves aside for the right-hand panel (forest 3.40)

Run `node --import tsx packages/forest/evidence/globe-aside/capture.mjs` from the checkout (`--before` takes the
`*-before.png` pictures from a build that withholds the panel's width from the globe, as main drew it before). It mounts
the public `openForestView` beside a `.story-panel` sibling, as the desktop app lays them out, on the saved code-rows
reading, opens a story's panel with the view's own `select`, and measures the drawn globe in real Chromium.

- `wide-closed.png`, `wide-open-before.png`, `wide-open.png` (1600 × 900): with the panel open the globe's centre
  sits mid-way across the free width (584.75 px, panel from 1170 px), at the same zoom and turn; closing returns it to 800 px.
- `narrow-closed.png`, `narrow-open-before.png`, `narrow-open.png` (1000 × 820): the globe would not fit the 570 px of
  free width, so it also zooms out just enough (camera zoom 1.59 → 1.25); closing restores both.
- In both, a territory's tooltip sits 12 px right of the pointer, and the mini globe ends left of the panel. Before this,
  the canvas's overlay followed the camera's side offset, so under any offset the tooltip and rim markers drew one
  offset away from where they belong (measured 215 px left of the pointer on the wide window).
