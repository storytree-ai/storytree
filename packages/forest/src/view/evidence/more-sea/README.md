# More sea between the islands, and bigger land, on the same globe

Increment `increment_10b2c42d72b2` on the arc "A calmer globe map"; the decision is ADR-0910
(`decision_7eae146bd770`), narrowing ADR-0655 D3's room between islands and ADR-0804 D3's land per line.
The owner, 2026-10-05, looking at storytree's own globe: "space the islands out more and draw the land bigger to
take up more space on the globe, our globe as plenty of space so we should use it", then "I think we need more
sea between and bigger land." These are pictures to look at; nothing here is recorded as accepted (ADR-0794).

What changed (values in `island-growth.ts` and `planet-places.ts`):

| | Before | After |
| --- | --- | --- |
| Land per line of code (surveyed story) | 0.75 units² | 1.5 |
| Least land of any island, and each capability of an unsurveyed story | 318 units² | 800 |
| Open sea kept between two islands' reaches (`SEA_GAP`) | 12 units | 36 |
| Farthest an island may be nudged from its row anchor (`MAX_NUDGE`) | 0.3 rad | 1.2 rad |
| Rows' latitude, south to north | 42° | 46° |
| A pair the rows' bands stop from parting north and south | stuck, so the globe grew | parts east and west |

## The three forests, before and after

Each at the globe's own front (latitude 0, longitude 0 facing the viewer) and after a quarter turn about its poles.

| Forest | View | Before | After |
| --- | --- | --- | --- |
| storytree's own, 15 stories with their code (the seed of `../code-rows`) | front | [before-storytree-front.png](before-storytree-front.png) | [after-storytree-front.png](after-storytree-front.png) |
| | quarter turn | [before-storytree-quarter.png](before-storytree-quarter.png) | [after-storytree-quarter.png](after-storytree-quarter.png) |
| Five stories depending on nothing: a row | front | [before-row-front.png](before-row-front.png) | [after-row-front.png](after-row-front.png) |
| | quarter turn | [before-row-quarter.png](before-row-quarter.png) | [after-row-quarter.png](after-row-quarter.png) |
| The same five, each on the one before: a chain | front | [before-chain-front.png](before-chain-front.png) | [after-chain-front.png](after-chain-front.png) |
| | quarter turn | [before-chain-quarter.png](before-chain-quarter.png) | [after-chain-quarter.png](after-chain-quarter.png) |

## Measured before anyone looked

In the page (`measurements-before.json`, `measurements-after.json`). Land is the ground the page draws (every
island's ground triangles); the share of the face is that land's projection on the globe's disc at the view; a
gap is the straight line between each island's nearest drawn coast point and any other island's.

| Forest | | Before | After |
| --- | --- | --- | --- |
| storytree | Globe radius | 226.8 (it was already growing) | 218 |
| | Land drawn | 55,254 units² | 109,135 units² |
| | Land's share of the globe's surface | 8.6% | 18.3% |
| | Land's share of the face, at the front | 21.1% | 24.8% |
| | Nearest coast to each island: least / median | 13.5 / 21.8 | 38.4 / 45.1 |
| | Names shown at the front | 13 of 15 | 11 of 15 |
| Row of five | Land's share of the surface | 0.41% | 0.88% |
| | Nearest coasts | 14.8 | 39.4 |
| | Names shown at the front | 5 of 5 | 5 of 5 |
| Chain of five | Nearest coasts | 55.5 | 51.9 |
| | Names shown at the front | 5 of 5 | 5 of 5 |

Overlapping pairs of shown names: 0 in every view after; before, storytree's quarter turn read 0 or 1 between
re-takes (the page's own name stepping settles a frame differently on a re-load, so the measurement waits for two
reads 250 ms apart to agree).

## Judged against

- **Legible at the resting view** (every name on screen, land readable): the row's and the chain's five names all
  show, none overlapping, and the row and chain use far more of the globe than before. Concern, not fixed here:
  storytree's front shows 11 of 15 names, not 13, because its islands now run round the globe instead of
  clustering at the front. Stepping names back onto the face (ADR-0855) and opening on the islands' middle belong to
  the next increment on this arc.
- **The resting view is designed, not fitted**: land is 2.1 times the share of the surface and the nearest coasts
  twice as far apart at the same radius, so the sea reads as sea. Concern: at the front's right limb The agent link and
  The world, the two biggest islands, read as one landmass because the limb foreshortens the 38 units of sea
  between them (the measured nearest coast is 38.4 or more apart).
- **A connector that does not connect is a defect**: the trails between islands still run from coast to coast in the
  pictures, only longer; docking was not measured here (the planet-pathways tests hold it).
- The chain's sea is set by the rows' spacing, which is why its gap went 55.5 to 51.9 and not up: 42° rows left it
  at 44; 46° recovers most of it without costing storytree's own globe its radius (more than about 50° does).

The website draws saved snapshots of the globe (their places and sizes are written by its refresh), so it looks as
it did until a refresh; it was not captured.

## Renderer

Headless Chromium (see `browser` in the measurements), ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1,
the same stand-in bridge, seeds and viewport for both builds. **Before** is `origin/main` (6bd8265a) built from
this branch's tree before the change; **after** is this branch.

## Rerun

`node --import tsx build.mjs <checkout> before` (a checkout of `origin/main`) and `... after`, then
`node --import tsx capture.mjs before|after [row|chain|storytree] [--retake]`; without `--retake` the pictures go to
the scratch folder the run names. The row and chain seeds are made in `capture.mjs`; storytree's is
`../code-rows/seed.json.gz` and `survey.json`.
