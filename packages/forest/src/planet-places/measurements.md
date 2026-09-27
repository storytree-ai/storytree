# Packed places on the globe (ADR-0648)

The current book uses **radius 160 and 36 frozen places**, using
`spike/globe-land`'s spiral and measurement, corrected before first landing. The measurement walked a spiral
from +z with pitch 72, selecting successive parameters against the actual clipped shores
at a target gap of four units. The runtime reads only the place number. Neither a new story,
a retirement, a different id nor an island's growth can change these directions.

The old W2 algorithm is retired. The page calls `placeOnPackedGlobe`; the existing forest
barrel's `placeOnGlobe` name is a compatibility alias to that same packed rule. Places outside
1–36, fractions and non-finite numbers are refused. Retirement does not reclaim capacity.

## Bounded coast proof

The look-only table passed its original input but failed the fresh seed: places 1 and 2
overlapped because new story ids changed their shapes. A second committed red test reproduces
that incident. Before first landing, the same pitch-72 spiral was measured against both seeds
and the 36-story sample together. Those corrected directions are now frozen; calibration is
never part of runtime. The first seven centres stay within 42.45° of the pole, the last at 109.06°.

The continuing test builds both seven-story seeds (counts 8, 4, 5, 10, 7, 6, 13)
and all 36 synthetic shores (that count sequence repeated), with their exact story ids.
It uses `forestScene`, `forestDescriptors`, `clipToCoast(SHIPPED_COAST)`, the complete rim loops
and the actual `plateTransform`. The beaches are included. Every pair is checked, not just
consecutive places. Disjoint spherical caps clear distant pairs; nearby pairs use a gnomonic
projection, which keeps radial projections of straight plate edges straight, and check every
edge for intersection or touching, plus polygon containment. Concave bays remain bays.

All three sets pass at every place. The corrected table's nearest coast-vertex arc gaps are:

| Input | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| Original seven-story seed | 4.46 | 5.05 | 10.79 |
| Fresh seven-story seed | 4.22 | 4.44 | 10.84 |
| 36-story sample | 4.09 | 4.53 | 14.64 |

These are sampled vertex gaps; the continuing test additionally checks whole edges and
containment, without claiming the vertex minimum is an exact edge distance. The raw
[spacing record](../../../../apps/desktop/src/forest/evidence/packed/spacing.json) preserves
place parameters, ids, sizes and measured gaps.

This table was calibrated to those shapes, **not every possible island with up to 13 or 19
capabilities**. Story ids affect shape, and adding capabilities can crowd neighbours. The
old 100-place/19-capability promise below belongs to the retired W2 book. This proof does not
cover tree crowns or vertical relief. A later book must decide growth and additional capacity;
this landing neither resizes islands nor moves them to make room.

```sh
flock /tmp/storytree-heavy.lock pnpm test -- packages/forest/src/planet-places/planet-places.test.ts packages/forest-world/src/planet/packed-coasts.test.ts
```

## Historical measurement: retired W2 book

Measured on 2026-09-27 for ADR-0646 W2, before implementing the placement book. The fixed
Fibonacci sphere has 128 candidates, with `z = 1 - 2(i + 0.5)/128` and longitude
`i × π(3 - √5)`. Starting near +z, each next candidate maximises its angular distance from
the nearest already chosen candidate. The resulting deal is stored permanently: recomputing
it can let rounding choose differently between symmetric candidates and move old stories.

The measurement adapted the [placement spike's script and shore geometry](https://github.com/storytree-ai/storytree/tree/spike/planet-places/spike/planet-places),
using its saved 256-story shore samples at 1, 6 and 19 capabilities. Radii 380, 390 and 400 all
kept those shores separate at 5, 36, 100 and 128 places. **390 ground units** retains the
owner's estimate with more clearance than 380. It never fits itself to a project's live count.

At radius 390, the spike's actual polygon-footprint gaps were:

| Historical places | 1 capability | 6 capabilities | 19 capabilities |
| --- | ---: | ---: | ---: |
| 5 | 566.414 | 535.761 | 492.640 |
| 36 | 118.335 | 81.330 | 44.744 |
| 100 | 89.014 | 51.290 | 14.656 |
| 128 | 80.827 | 45.213 | 9.978 |

These are great-circle distances between the real shores projected radially from tangent
plates, not distances between centres. The spike's maximum sampled shore radius was 51.711566.

The globe builds each plate at zero. A further scan therefore generated **1,900 centred
islands**, `story_0` through `story_99` at every capability count from 1 through 19, using
`forestScene`, `forestDescriptors`, `clipToCoast(SHIPPED_COAST)` and `islandReach`. The largest
shore radius was **51.754921**. Including the beach matters: the descriptor mesh alone is smaller.

Using that largest centred shore for *every* island gives this more conservative clearance:

| Historical places | Closest centre chord | Chord minus two shore radii |
| --- | ---: | ---: |
| 5 | 536.732118 | 433.222275 |
| 36 | 143.677680 | 40.167837 |
| 100 | 115.204936 | 11.695093 |
| 128 | 106.541748 | 3.031906 |

Disjoint enclosing balls imply disjoint flat plates whatever their rotation about the normal.
The largest curvature-only radial rim lift is `hypot(390, 51.754921) - 390 = 3.419079` ground
units, 0.877% of the globe radius. This excludes the renderer's clearance above the sea.

The continuing contract test builds 100 real 19-capability shores and 100 smaller shores,
including the empty story's seedling, then checks every pair of the first 100 places. Run it with:

```sh
pnpm test -- packages/forest/src/planet-places/planet-places.test.ts
```

On the shared Mint box, prefix that command with `flock /tmp/storytree-heavy.lock`.
These are measured, deterministic geometry samples, not an exhaustive proof over every story id
or a collision test for tree crowns and vertical relief. The approved promise remains the first
100 **historical** places and islands of up to 19 capabilities; retiring a story never reclaims
its place. The API has 128 distinct spots and refuses later place numbers. Their treatment is a
later book, as the owner decided.
