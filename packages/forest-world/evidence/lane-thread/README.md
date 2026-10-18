# Lit lanes are a thread on the road, not paint over it

Increment `increment_c2a9c1eea763`, world 6.8. These are pictures for the owner to look at. Nothing here is recorded
as accepted (ADR-0794).

**Before.** A lit lane filled its road's whole width at 95% opacity, under a glow 2.6 times the road's width at 45%.
Each lit link drew its own lane and its own glow, so a trunk shared by twenty links carried twenty glows on top of each
other and read as a solid band about twice the road's width. The owner, 2026-10-12: "the fill on pathways looks larger
then the pathway its self. looks crude like a toddler has taken a texter and drawn over the line."

**After.** A lit lane is a thread of one width, two thirds of a one-link road (1 ground unit), down the middle of its
road and on inland along the territory borders. The road keeps its own colour and width either side of it. Lanes of one
colour sharing a stretch lay one glow on it between them: the glow of the lane that leads the stretch, the same leader
the moving head already uses. Where both colours share a road, each thread keeps its own side.

| View | Before (main, 920c7ea4) | After (this branch) |
| --- | --- | --- |
| The library selected (135 lit links) | [before-the-library-selected.png](before-the-library-selected.png) | [after-the-library-selected.png](after-the-library-selected.png) |
| The library selected, close up | [before-the-library-close.png](before-the-library-close.png) | [after-the-library-close.png](after-the-library-close.png) |
| The app setup selected (38 lit links, both colours) | [before-the-app-setup-selected.png](before-the-app-setup-selected.png) | [after-the-app-setup-selected.png](after-the-app-setup-selected.png) |

Frame time in the capture's page (median of 25 frames, software drawing, so only the comparison means anything): The
library selected 9.5 ms before and 9.1 ms after; The app setup selected 5.0 ms before and 8.4 ms after, from one run
each. The runs were not repeated, and an earlier run of this branch with only the glow change read 5.3 ms for The app
setup, so the 8.4 is not established as a slowdown.

## Rerun

Taken with the forest's lanes-inland instrument (`packages/forest/src/view/evidence/lanes-inland`), which builds the real
desktop page from a checkout and selects each story on storytree's own globe: headless Chromium, ANGLE / SwiftShader,
1440 x 960, dark theme, device scale 1. From that folder: `node --import tsx build.mjs <main checkout> before`,
`node --import tsx build.mjs <this checkout> after`, then
`node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before|after`. Its pictures land
in the scratch folder it names; the six here are copies of `*-the-library-selected.png`, `*-the-library-close.png` and
`*-the-app-setup-selected.png`.
