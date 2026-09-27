# Places on the globe: radius measurement

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
