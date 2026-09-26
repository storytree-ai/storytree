# Wrapped spiral placement measurement

Throwaway evidence for `0-3-planet-spike-places`, 2026-09-27. Branch:
`spike/planet-places`. No product implementation, pull request or merge.

**Recommend a fixed R = 1,100 ground units (10 place-widths), if the owner keeps
the wrapped spiral and accepts its sparse front cluster.** For the first 100
consecutive places, all three measured island sizes stay separate. The smallest
actual shore gap is **2.792 units**; the conservative shore-envelope clearance is
**0.746 units**. Worst curvature-only rim lift is **1.215 units, 0.1105% of R**.

This is conditional evidence, not the question's unqualified “up to 100 stories
never overlap” promise. The sampled bound guarantees separation through **place
113**; the actual 19-capability fixture first overlaps at **place 157**, between
156 and 157. A project can have only two surviving stories at those places after
retiring earlier ones. Island capability counts also have no universal size cap.

The small globe that puts place 100 at 150° fails, even with one capability per
story. The measurements do **not** show that every radius fails for the first 100
consecutive places: R = 1,100 is a counterexample to that claim.

## Pictures

Each sheet shows all three radii, front and back, at equal screen size. White dots
are story centres; coloured rings are the exact radial projections of tangent
discs with the largest measured shore radius for 1, 6 and 19 capabilities. Rings
are bounds, not the irregular coast outlines used in the actual-gap calculation.

- [5 stories — PNG](results/places-005.png) / [SVG](results/places-005.svg)
- [36 stories — PNG](results/places-036.png) / [SVG](results/places-036.svg)
- [100 stories — PNG](results/places-100.png) / [SVG](results/places-100.svg)

## What was measured

The script imports the working forest functions from this worktree:

- `storyNodes` calls the private `placeOnSpiral` in
  `packages/forest/src/story-nodes/story-nodes.ts`. The spiral is **not copied**
  into the spike. Synthetic stories are in creation order; place 1 is the pole.
- `forestScene` supplies actual groves and positions; `groundInput` and
  `forestDescriptors` supply the ground. `GROUND_PER_PLACE` is imported and is
  **110**. The legacy `ForestScene.island.radius` cap is not the drawn ground size.
- `clipToCoast(cells, SHIPPED_COAST)` and `rimLoops` apply the same pure coast
  operation as the shipped canvas. This needs no WebGL. It matters: the shipped
  beach reaches farther than the descriptor cells.

There are **256 deterministic story ids**, `story_0` through `story_255`, measured
separately with 1, 6 and 19 capabilities each, in the planned state, with no
contracts. The requested gap readings use the first 5, 36 and 100. Continuing to
256 establishes the first actual large-island overlap at the recommended radius.
Envelope capacities scan up to 10,000 real spiral places, stopping at first
conflict. All pairs are considered, not only adjacent place numbers.

The sampled radius ranges, in ground units about the story's fixed anchor:

| Capabilities | `groundInput` coast radius | Descriptor cell radius | Shipped coast radius |
| ---: | ---: | ---: | ---: |
| 1 | 12.186–13.230 | 11.068–11.136 | **13.125–13.970** |
| 6 | 31.357–32.354 | 29.281–29.341 | **31.625–32.636** |
| 19 | 50.584–51.579 | 48.241–48.298 | **50.696–51.712** |

These are measured samples, not a mathematical maximum over every possible story
id or every capability count between the three sizes. The capacity guarantee
below is conditional on the stated radius bound, not simply on “19 capabilities”.

## Gaps at 5, 36 and 100 stories

**Actual coast gap** is the shortest great-circle gap between the radial
projections of the real flat plates' shores. `OVERLAP` means their filled surface
footprints intersect; the gap is then zero. The plate orientation is the shortest
rotation from the front tangent plane to its normal, with no extra twist.

| R (ground units) | Stories | 1 capability | 6 capabilities | 19 capabilities |
| ---: | ---: | ---: | ---: | ---: |
| 238.404 | 5 | 77.389 | 43.368 | 7.813 |
| 238.404 | 36 | 45.404 | 10.531 | **OVERLAP** |
| 238.404 | 100 | **OVERLAP** | **OVERLAP** | **OVERLAP** |
| 500 | 5 | 81.074 | 46.538 | 8.932 |
| 500 | 36 | 74.758 | 38.110 | **OVERLAP** |
| 500 | 100 | 57.983 | 21.400 | **OVERLAP** |
| **1,100** | **5** | **81.910** | **47.293** | **9.186** |
| **1,100** | **36** | **81.502** | **43.706** | **6.291** |
| **1,100** | **100** | **77.446** | **40.720** | **2.792** |

At R = 1,100, the tightest actual 19-capability pair is places **80 and 81**.
The centre-distance minimum at 100 is instead places 99 and 100.

For a clearance bound independent of coast orientation, put the largest sampled radius `r` of
each size at **every** place and calculate `R × angle(nA,nB) − 2r`. Negative
numbers mean these circular envelopes overlap, which alone does not prove the
irregular coasts overlap:

| R | Stories | 1-cap bound | 6-cap bound | 19-cap bound |
| ---: | ---: | ---: | ---: | ---: |
| 238.404 | 5 | 74.330 | 37.000 | −1.152 |
| 238.404 | 36 | 42.054 | 4.723 | −33.428 |
| 238.404 | 100 | −6.442 | −43.773 | −81.925 |
| 500 | 5 | 78.349 | 41.018 | 2.867 |
| 500 | 36 | 71.937 | 34.606 | −3.545 |
| 500 | 100 | 55.803 | 18.472 | −19.679 |
| 1,100 | 5 | 78.965 | 41.634 | 3.482 |
| 1,100 | 36 | 78.965 | 41.634 | 3.482 |
| **1,100** | **100** | **76.228** | **38.898** | **0.746** |

The exact angular footprint of a tangent disc is `atan(r/R)`, rather than `r/R`.
The raw data also carries the less conservative gap
`R × (angle(nA,nB) − 2 atan(r/R))`. At R = 1,100 with the largest shore it is
**0.822 units** at 100 places. At R = 238.404 and 5 places, its **+0.426** explains
why the **−1.152** arc-radius estimate must not be called actual overlap.

For comparison, the flat 100-place centre minimum is 107.065 units, giving only
3.642 units of clearance between the largest shore envelopes even before bending.
The 100-place zero-clearance threshold for that envelope is **R ≈ 1,033.671**;
1,100 is a rounded fixed candidate above it, not a project-fitted radius.

## Capacity, back pole and rim lift

Capacity here counts **consecutive historical places**, including retired ones.
For the conservative columns, every island must stay within the relevant sampled
maximum radius: 13.9705 / 32.6358 / 51.7116 units. The first circular conflict
occurs one place after each listed safe prefix.

| R | Conservative capacity: 1 / 6 / 19 caps | Actual fixture safe prefix: 1 / 6 / 19 caps | Continuous back-pole crossing | First place past back pole |
| ---: | ---: | ---: | ---: | ---: |
| 238.404 | 89 / 40 / **3** | 94 / 43 / **8** | 144.502 | 145 |
| 500 | 394 / 181 / **22** | ≥256 / 196 / **32** | 639.484 | 640 |
| **1,100** | 1,908 / 881 / **113** | ≥256 / ≥256 / **156** | 3,099.486 | 3,100 |

The exact tangent-disc capacities for 19 capabilities are 5, 23 and 114
respectively; the more conservative `r/R` model above is the recommendation's
capacity bound. Actual fixture capacity can be higher because each coast is
irregular and has a particular orientation. The first actual 19-capability
overlaps are 8/9, 32/33 and 156/157 respectively. `≥256` is a scan limit, not a
claim of unlimited capacity. The back pole is reached at `d = πR`; compression
causes conflicts well before then.

Using the biggest sampled shore, `r = 51.7115655`:

| R | Approximate rim lift `r²/(2R)` | Share of R |
| ---: | ---: | ---: |
| 238.404 | 5.6083 ground units | 2.3524% |
| 500 | 2.6741 ground units | 0.5348% |
| **1,100** | **1.2155 ground units** | **0.1105%** |

This is curvature-only lift for a plate tangent at the sea surface, excluding
terrain height, skirts and relief. Raw data also records the exact radial excess
`sqrt(R²+r²) − R` and the normal clearance `R − sqrt(R²−r²)`, so the approximation
is not mistaken for a measurement of full 3D terrain.

## FOR THE OWNER

At R = 1,100, place 100 reaches just **32.510°** from the front. All 100 centres
fit inside **7.835% of the sphere's area**, with none on the back. At 5 stories,
the last centre is only 8.011° from the front. The small sphere gives the desired
front/back spread, but cannot keep these islands separate.

Decide whether that sparse front cluster is acceptable, or whether placement
should be revisited to distribute stories over the globe. Also decide what
island-size bound and historical-place limit the proof should promise. A live
story count alone is insufficient under permanent places and retirement. Larger
capability counts need their own bound. No choice or amendment to the owner's
question is made by this spike.

## Reproduce and verify

From this worktree (dependencies are already installed):

```sh
flock /tmp/storytree-heavy.lock node --import tsx spike/planet-places/measure.mjs
flock /tmp/storytree-heavy.lock node spike/planet-places/verify.mjs
flock /tmp/storytree-heavy.lock python3 spike/planet-places/render.py
```

The plot uses system Python `cairo`; no added package, browser, WebGL or GPU.
`measure.mjs` calls the actual functions, records source SHA-256 hashes, and
writes [all numbers and coastline coordinates](results/measurements.json).
Source files were read from the worktree based on commit `3f1f3fc`.

Checks passed: an independent `acos` all-pair centre scan agrees for all 27
combinations; tangent frames are orthonormal; every exact coast gap respects its
enclosing-disc lower bound. Independent dense point sampling gives **2.793924**
versus the exact **2.791845** for the recommended radius's tightest large-island
pair, and **10.530592** versus **10.530590** for the small globe's tight 6-cap pair.
Analytic arc-gap and containment checks also pass. The three PNGs were inspected.

The actual-gap calculation detects polygon intersections and containment in a
shared gnomonic chart, then minimizes spherical point-to-edge distance in both
directions. It measures surface footprints, not tree crowns, 3D mesh collisions,
labels or whether two separate objects overlap in a camera image.
