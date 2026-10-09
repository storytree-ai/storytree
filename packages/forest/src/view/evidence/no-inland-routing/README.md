# No routing inside islands

ADR-0951 D3, increment_da791c78d847. Now that selection lanes run only dock to dock (world 6.8), nothing draws the
routes inside an island, so the pathway build (`buildPlanetPathways`, packages/forest-world/src/planet/pathways.ts)
stops making them. It routes only the roads between islands. Each link between two islands has one chain, made of
those roads from dock to dock. A link within one island has no route. The inland destinations the forest supplied for
those routes (`Island.pathwayDestinations`, `territoryDestinations`) are gone. So is each plate's `paths`, which
nothing read. The coast, the docks and the plates' ground stay.

## Time saved

The time `planetPathwayDrawing` takes, as the desktop page lays each scene out. It is the median of 7 runs, each in
a fresh process, so "cold" starts with every routing cache empty. "One-island change" is the next build after one
capability on the first story changes status, with every other island handed on as the object already on show.
Measured with [measure.mts](measure.mts) on the Mint box. **Before** is `main` at 547ccd0a; **after** is this branch.

| Scene | Links | Routed links (before → after) | Segments (before → after) | Cold, ms (before → after) | One-island change, ms (before → after) |
| --- | --- | --- | --- | --- | --- |
| The saved desktop fixture (../code-rows: 15 stories, with its code survey) | 131 | 131 → 37 | 402 → 26 | 1816 → 1668 | 63 → 6 |
| storytree's own plan, 2026-10-09 (../lanes-at-the-coast: 20 stories) | 145 | 145 → 44 | 431 → 37 | 2102 → 1966 | 51 → 10 |

A change on one island no longer routes anything: before, it re-routed that island's inland routes. The cold build
saves about 7%. Most of its time goes to the roads between islands and to laying out each island's ground, and both
remain.

## Nothing on screen changed

The desktop page in headless Chromium, 1440 x 960, reduced motion (every lane is drawn at once), seeded with
storytree's own plan, the globe turned to face The library, The map and Keys, then The library clicked. The seed,
turn and click are the same for both builds.

| | Before | After |
| --- | --- | --- |
| The library selected | [before-library-selected.png](before-library-selected.png) | [after-library-selected.png](after-library-selected.png) |

The two pictures are identical pixel for pixel. Both builds draw the same 37 roads between islands and the same 18
lanes; the JSON beside each picture lists them.

## Reproduce

From the repository root, under the machine's heavy-run lock:

```sh
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/no-inland-routing/capture.mjs before <main checkout> --retake
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/no-inland-routing/capture.mjs after --retake
cd packages/forest && npx tsx src/view/evidence/no-inland-routing/measure.mts 7
```
