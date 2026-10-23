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

- [Opening](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/nameplates/nameplates-after-opening.png) · [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/nameplates/nameplates-before-opening.png)
- [After the drags](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/nameplates/nameplates-after-after-drags.png) · [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/nameplates/nameplates-before-after-drags.png)
- [The world selected](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/nameplates/nameplates-after-selected.png) · [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/nameplates/nameplates-before-selected.png)

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 6 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/nameplates).
