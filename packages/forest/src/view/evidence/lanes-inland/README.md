# Lit lanes reach their capability along the territory borders; type-only links are dashed

Increment `increment_38704e762175` (ADR-0991 D4, D1): world 6.8 and forest 3.7. These are pictures for the owner to
look at. Nothing here is recorded as accepted (ADR-0794).

**Lanes inland (sketch B).** Before, a selected story's lane ran from dock to dock and stopped at the coast. Now it
carries on from each dock to the territory of the capability at that end. It runs along lines already drawn on the
island: the white borders between territories, and the coast between two borders where no border joins them inland.
It takes the shortest such way, with a stretch of coast costing three times its length, and its last stretch always
runs along a border of the capability's own territory, so it visibly enters that territory. It ends in the lane's mark.
Where the dock is already on the capability's territory, nothing is added. Inland, a lane is as wide as a one-link
road, a thread along the borders rather than a road. No line crosses open land.

**Type-only links (proposed look).** A type-only link is one where only the code's types join the two capabilities.
- A lit type-only lane is dashed: 2.2 ground units drawn, 1.6 left out, on the lane and its glow.
- An unlit road that carries only type-only links is dashed in the road's own colour.
- A road shared by type-only links and links by value is dashed at its full width, with a solid core as wide as its
  links by value alone would make it. The ragged margins either side of the core are its type-only share.
  On storytree's globe 54 of the 75 road segments carry a type-only link, and only 2 carry nothing else. Dashing only
  roads with no link by value would have hidden almost every type import.

| View | Before (main) | After (this branch) |
| --- | --- | --- |
| Nothing selected, The library facing | [before-unlit.png](before-unlit.png) | [after-unlit.png](after-unlit.png) |
| Nothing selected, close up | [before-unlit-close.png](before-unlit-close.png) | [after-unlit-close.png](after-unlit-close.png) |
| The library selected | [before-the-library-selected.png](before-the-library-selected.png) | [after-the-library-selected.png](after-the-library-selected.png) |
| The library selected, close up | [before-the-library-close.png](before-the-library-close.png) | [after-the-library-close.png](after-the-library-close.png) |
| The app setup selected | [before-the-app-setup-selected.png](before-the-app-setup-selected.png) | [after-the-app-setup-selected.png](after-the-app-setup-selected.png) |
| The app setup selected, close up | [before-the-app-setup-close.png](before-the-app-setup-close.png) | [after-the-app-setup-close.png](after-the-app-setup-close.png) |

- **The library selected:** the same 135 lanes. 90 of them are type-only and dashed. Their marks go from 18 to 77,
  one at each lane's end in its territory rather than one per dock. Lane length in total goes from 52,210 to 74,310
  ground units, so about 30% of a lit lane now runs inland.
- **The app setup selected:** the same 38 lanes, 5 of them type-only. Marks go from 13 to 32, and total length from
  21,835 to 26,328.

## Cost

**The pathway build is unchanged.** Inland routing was the costly part before ADR-0836 D1, and this branch adds none
of it to the build. A way inland is found only when a lane lights, as a shortest-path search over the island's border
lines. Each island's lines are built once and each way is found once. The territory cut is now made once per island and
shared by the territory drawing, the nameplates and the lanes. Timed with [measure.mts](measure.mts), median of 5
runs, each in a fresh process, on storytree's own globe (../derived-roads' seed and survey, 23 stories, 330 roads).

| | Before (main, fab4eb0f) | After |
| --- | --- | --- |
| Pathway build, cold | 4,162 ms | 4,102 ms |
| Pathway build, one-island change | 20 ms | 20 ms |
| The library's lit lanes (135), first selection | 11.7 ms | 48.3 ms |
| The app setup's lit lanes (38), first selection | 7.9 ms | 10.2 ms |

**Frame time** is the median of 25 frames drawn back to back in the capture's page (headless Chromium, SwiftShader;
software drawing, so only the before/after comparison means anything):

| | Before | After |
| --- | --- | --- |
| Nothing selected | 3.5 ms | 3.3 ms |
| The library selected | 8.9 ms | 10.0 ms |
| The app setup selected | 5.1 ms | 5.0 ms |

## Rerun

Renderer: headless Chromium, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Both builds get the same
stand-in bridge, seed, survey, viewport, turns and clicks. From this folder:
`node --import tsx build.mjs <main checkout> before`, `node --import tsx build.mjs <this checkout> after`, then
`node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before|after --retake`. From
the repository root: `tsx packages/forest/src/view/evidence/lanes-inland/measure.mts <checkout> 5`.
