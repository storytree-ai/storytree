# Nameplates below each island

Each story's nameplate now hangs from just below its island's coast, as the screen sees it: on the line
through the island's middle that runs straight down the screen, just past the coast's lowest point. It is
placed every frame, so it stays below the island through any spin or tilt, and it hides once the island
turns away. Selecting a story (clicking its island) puts a smaller nameplate on each of its capabilities'
territories, at a point inside that territory, and dims the other stories' plates. No plate takes a pointer
from the land. No row lines or row labels are drawn.

Captured on the actual desktop page with the rows capture's build, seed and survey
(`node ../rows/build.mjs <checkout> nameplates-after|nameplates-before`, then `node --import tsx capture.mjs <label>`),
1440 × 960, headless Chromium on SwiftShader. Before is origin/main with north-up and rows landed.
The drags are real pointer drags: 110 px right; 60 down; 60 left and 90 up. Then 240 left (bringing the
land clear of the story panel) and a click on the island with the most capabilities left of the middle.

| | before | after |
|---|---|---|
| plates on show hanging below and under their island, opening | 0 of 6 | 5 of 5 |
| after the drags | 1 of 5 | 3 of 4 (the miss, The dev loop, is edge-on at the rim: below its land, its middle off the sliver still in view) |
| capability plates when The world is selected | 0 | 6, one per territory |

"Below" is measured against every point of the island's drawn land on the near side, so a plate over its
own coast counts as a miss (`measurements-*.json`).

- [Opening](nameplates-after-opening.png) · [before](nameplates-before-opening.png)
- [After the drags](nameplates-after-after-drags.png) · [before](nameplates-before-after-drags.png)
- [The world selected](nameplates-after-selected.png) · [before](nameplates-before-selected.png)
