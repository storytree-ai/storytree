# Roads routed to the coast, on a chart centred on the islands

Increment `increment_a8aedbba7136`, the residue of [roads-on-the-glass](../roads-on-the-glass/README.md). Roads between
islands are routed on an azimuthal chart. About the globe's +z it stretched islands far round the globe sideways (3.3
times at 135°), so the router's disc for such an island reached far past its coast, the route stopped there, and the
rest of the way to the dock was filled in along the globe's surface, unplanned: on storytree's own plan, the worst road
(The librarian to The world, as roads-on-the-glass found) ran 220 units that way, mostly on the far side.

Now (`buildPlanetPathways` in `packages/forest-world/src/planet/pathways.ts`, the world's 6.14):

- **The chart's pole is the islands' own middle**: of 4000 fixed directions, the one that brings the farthest coast
  nearest. It depends only on where the islands are and how far their coasts reach, so routes are kept while no island
  moves. It weighs each island by its coast's reach, so on this seed the farthest island's middle goes from 135° off
  the pole to 113°, while the farthest coast comes as near as it can.
- **The router's last step to the coast is planned on the chart too**: from where the router ends a road on its
  island's disc, a straight line on the chart to the nearest coast, which no coast crosses, sampled at the router's own
  step. Nothing is left for the surface fill.

Measured on the `../code-rows` seed ([measurements.json](measurements.json)): the longest stretch any road runs
unplanned goes from **220.6 units to 0.8** (the chart's own step) on every one of the 27 roads. Centring the chart
shortens the straight approaches to the coast from at most 219 units (450 in all) to at most 68 (364 in all): the
longest left are The command line's and The world's, whose discs still reach past an uneven coast.

Every route moves once. These are pictures for the owner to look at; nothing here is recorded as accepted (ADR-0794).

| View | Before | After |
| --- | --- | --- |
| The globe unturned, its front facing the eye | [before-front.png](before-front.png) | [after-front.png](after-front.png) |
| The world facing the eye | [before-the-world.png](before-the-world.png) | [after-the-world.png](after-the-world.png) |
| The librarian, turned a little toward The world | [before-librarian-to-world.png](before-librarian-to-world.png) | [after-librarian-to-world.png](after-librarian-to-world.png) |

Before, The agent link's road comes straight down onto The world's tip, the surface fill; after, it is routed round
and docks on The world's near coast.

Renderer: headless Chromium 148, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Both builds get the same
stand-in bridge, seed, survey, viewport and turns. **Before** is `origin/main` at 88f01b5a built from a throwaway
worktree; **after** is this branch. The page reads 28 roads before and 27 after (`page-*.json`), as the measurement does.

## Rerun

`node --import tsx build.mjs <before checkout> before`, `node --import tsx build.mjs <this checkout> after`, then
`node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before|after --retake`. The unrouted lengths are each
cross segment's `unrouted`; for the before build, the same one line was added to a scratch copy of its `pathways.ts`.
