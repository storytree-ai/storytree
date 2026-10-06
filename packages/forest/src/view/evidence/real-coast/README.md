# Roads routed to the islands' real coast, not a disc

Increment `increment_827c10e70b39`, the residue of [island-centred-chart](../island-centred-chart/README.md). The
router (`routeTrails`, `packages/forest-world/src/core/routing.ts`) saw every island as one disc reaching its farthest
coast, so a road between islands stopped on that disc and reached its dock by a straight line on the chart that it
never planned: it merged with nothing and could graze other roads.

Now a `TrailIsland` may carry its coast as an `outline` (rings), and the globe passes each island's charted coast
(`buildPlanetPathways`, `packages/forest-world/src/planet/pathways.ts`). With an outline the router blocks, softens,
docks, reads approaches and opens cave portals against the coast itself; the disc still bounds the grid and decides
every cell beyond the falloff band, and a caller with no outline routes exactly as before. A road's `unrouted` (the
world's 6.14) now counts that straight run to the dock too, so it no longer reads the chart's step while a straight
68 units remains.

Measured on the `../code-rows` seed (`page-before.json`, `page-after.json`): the longest stretch any road runs
unplanned goes from **68 units to 0.8** (the chart's own step) on every road, and the roads' longest stretches add up
to 22 units instead of 384. The page draws 30 road segments after, 27 before: docks on a real coast cluster
differently, so some roads now share a trunk for a different length.

Every route moves. These are pictures for the owner to look at; nothing here is recorded as accepted (ADR-0794).

| View | Before | After |
| --- | --- | --- |
| The globe unturned, its front facing the eye | [before-front.png](before-front.png) | [after-front.png](after-front.png) |
| The world facing the eye | [before-the-world.png](before-the-world.png) | [after-the-world.png](after-the-world.png) |
| The agent link facing the eye | [before-the-agent-link.png](before-the-agent-link.png) | [after-the-agent-link.png](after-the-agent-link.png) |
| The command line facing the eye | [before-the-command-line.png](before-the-command-line.png) | [after-the-command-line.png](after-the-command-line.png) |

Renderer: headless Chromium, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Both builds get the same
stand-in bridge, seed, survey, viewport and turns. **Before** is this branch with the one change that hands the router
the outline taken out of `pathways.ts` (so both builds measure `unrouted` the same way); **after** is this branch.

## Rerun

`node --import tsx build.mjs <checkout> before` (with the `outline:` handoff removed from that checkout's
`pathways.ts`), `node --import tsx build.mjs <this checkout> after`, then
`flock /tmp/storytree-heavy.lock node --import tsx capture.mjs before|after --retake`.
